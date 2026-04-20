import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { hasPlatformAccess } from "@/lib/auth/permissions";
import {
  countMatchingDatasetTargets,
  emptyDatasetEntitlements,
  normalizeDatasetEntitlementValue
} from "@/lib/platform/dataset-entitlements";
import { resolveOrganizationFeatures } from "@/lib/platform/features";
import type {
  PlatformDatasetItem,
  PlatformDatasetsResponse,
  SharedDatasetAccessListItem
} from "@/types/api";
import type { AuthSessionContext } from "@/types/auth";

function assertPlatformAccess(context: AuthSessionContext) {
  if (!hasPlatformAccess(context)) {
    throw new Error("Platform access required.");
  }
}

async function loadGrantLookups(grants: Record<string, unknown>[]) {
  const supabase = createServerSupabaseClient();
  const grantedOrganizationIds = [...new Set(grants.map((row) => row.organization_id as string))];
  const teamIds = [...new Set(grants.map((row) => row.assigned_team_id as string | null).filter(Boolean))] as string[];
  const userIds = [...new Set(grants.map((row) => row.assigned_user_id as string | null).filter(Boolean))] as string[];

  const [{ data: grantedOrgs }, { data: teams }, { data: users }] = await Promise.all([
    grantedOrganizationIds.length
      ? supabase.from("organizations").select("id,name").in("id", grantedOrganizationIds)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length
      ? supabase.from("teams").select("id,name").in("id", teamIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? supabase.from("app_users").select("id,full_name,email").in("id", userIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  return {
    grantedOrgMap: new Map((grantedOrgs ?? []).map((row) => [row.id as string, (row.name as string | null) ?? "Unknown org"])),
    teamMap: new Map((teams ?? []).map((row) => [row.id as string, (row.name as string | null) ?? "Unnamed team"])),
    userMap: new Map(
      (users ?? []).map((row) => [
        row.id as string,
        ((row.full_name as string | null) ?? (row.email as string | null) ?? "Unknown user")
      ])
    )
  };
}

export async function getPlatformDatasets(
  context: AuthSessionContext
): Promise<PlatformDatasetsResponse["items"]> {
  assertPlatformAccess(context);
  const supabase = createServerSupabaseClient();

  const [{ data: datasets, error: datasetsError }, { data: grants, error: grantsError }, { data: counts, error: countsError }] =
    await Promise.all([
      supabase
        .from("platform_datasets")
        .select("id,name,description,source_batch_id,source_organization_id,list_type,status,created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("organization_dataset_access")
        .select("platform_dataset_id,organization_id,status,visibility_scope,assigned_team_id,assigned_user_id,granted_at")
        .order("granted_at", { ascending: false }),
      supabase
        .from("platform_dataset_records")
        .select("platform_dataset_id,city,postal_code")
    ]);

  if (datasetsError) throw datasetsError;
  if (grantsError) throw grantsError;
  if (countsError) throw countsError;

  const sourceOrganizationIds = [...new Set((datasets ?? []).map((row) => row.source_organization_id as string))];
  const { data: organizations, error: organizationsError } =
    await supabase.from("organizations").select("id,name,billing_plan");
  if (organizationsError) throw organizationsError;

  const { data: entitlementRows, error: entitlementRowsError } = await supabase
    .from("organization_dataset_entitlements")
    .select("organization_id,dataset_type,geography_type,geography_value_normalized")
    .eq("status", "active");
  if (entitlementRowsError) throw entitlementRowsError;

  const sourceOrgs = (organizations ?? []).filter((row) => sourceOrganizationIds.includes(row.id as string));
  const organizationEntitlements = new Map<string, ReturnType<typeof emptyDatasetEntitlements>>();
  for (const row of entitlementRows ?? []) {
    const organizationId = row.organization_id as string | null;
    const datasetType = row.dataset_type as keyof ReturnType<typeof emptyDatasetEntitlements> | null;
    const geographyType = row.geography_type as "city" | "zip" | null;
    const value = row.geography_value_normalized as string | null;
    if (!organizationId || !datasetType || !geographyType || !value) continue;
    const current = organizationEntitlements.get(organizationId) ?? emptyDatasetEntitlements();
    const bucket = geographyType === "zip" ? current[datasetType].zips : current[datasetType].cities;
    const normalized = normalizeDatasetEntitlementValue(geographyType, value);
    if (normalized && !bucket.includes(normalized)) bucket.push(normalized);
    organizationEntitlements.set(organizationId, current);
  }

  const { grantedOrgMap, teamMap, userMap } = await loadGrantLookups((grants ?? []) as Record<string, unknown>[]);
  const sourceOrgMap = new Map((sourceOrgs ?? []).map((row) => [row.id as string, (row.name as string | null) ?? "Unknown org"]));
  const rowCountMap = new Map<string, number>();
  const coverageMap = new Map<string, { cities: Set<string>; zips: Set<string> }>();
  const recordMap = new Map<string, Array<{ city: string | null; zip: string | null }>>();
  for (const row of counts ?? []) {
    const datasetId = row.platform_dataset_id as string;
    rowCountMap.set(datasetId, (rowCountMap.get(datasetId) ?? 0) + 1);
    const coverage = coverageMap.get(datasetId) ?? { cities: new Set<string>(), zips: new Set<string>() };
    const city = (row.city as string | null | undefined)?.trim();
    const postalCode = (row.postal_code as string | null | undefined)?.trim();
    if (city) coverage.cities.add(city);
    if (postalCode) coverage.zips.add(postalCode);
    coverageMap.set(datasetId, coverage);
    const records = recordMap.get(datasetId) ?? [];
    records.push({ city: city ?? null, zip: postalCode ?? null });
    recordMap.set(datasetId, records);
  }

  const grantsByDataset = new Map<string, PlatformDatasetItem["grants"]>();
  for (const grant of grants ?? []) {
    const datasetId = grant.platform_dataset_id as string;
    const current = grantsByDataset.get(datasetId) ?? [];
    current.push({
      organizationId: grant.organization_id as string,
      organizationName: grantedOrgMap.get(grant.organization_id as string) ?? "Unknown org",
      status: (grant.status as string | null) ?? "active",
      visibilityScope: (grant.visibility_scope as PlatformDatasetItem["grants"][number]["visibilityScope"]) ?? "organization",
      assignedTeamName: grant.assigned_team_id ? teamMap.get(grant.assigned_team_id as string) ?? null : null,
      assignedUserName: grant.assigned_user_id ? userMap.get(grant.assigned_user_id as string) ?? null : null,
      grantedAt: grant.granted_at as string
    });
    grantsByDataset.set(datasetId, current);
  }

  return (datasets ?? []).map((dataset) => {
    const datasetId = dataset.id as string;
    const rowCount = rowCountMap.get(datasetId) ?? 0;
    const organizationStatuses = (organizations ?? []).map((organization) => {
      const organizationId = organization.id as string;
      const organizationName = (organization.name as string | null) ?? "Unknown org";
      if (organizationId === (dataset.source_organization_id as string)) {
        return {
          organizationId,
          organizationName,
          label: "Platform Source" as const,
          matchingTargetCount: rowCount
        };
      }

      const featureResolution = resolveOrganizationFeatures({
        billingPlan: (organization.billing_plan as string | null | undefined) ?? null
      });

      if (featureResolution.billingPlan === "intelligence") {
        return {
          organizationId,
          organizationName,
          label: "Included by Intelligence" as const,
          matchingTargetCount: rowCount
        };
      }

      if (!featureResolution.effective.datasetMarketplaceEnabled) {
        return {
          organizationId,
          organizationName,
          label: "No Access" as const,
          matchingTargetCount: 0
        };
      }

      if (!["sold_properties", "solar_permits", "roofing_permits"].includes((dataset.list_type as string | null) ?? "")) {
        return {
          organizationId,
          organizationName,
          label: "Marketplace Eligible" as const,
          matchingTargetCount: rowCount
        };
      }

      const matchingTargetCount = countMatchingDatasetTargets(
        (dataset.list_type as string | null) ?? "",
        recordMap.get(datasetId) ?? [],
        organizationEntitlements.get(organizationId) ?? emptyDatasetEntitlements()
      );

      return {
        organizationId,
        organizationName,
        label: matchingTargetCount > 0 ? ("Marketplace Eligible" as const) : ("No Access" as const),
        matchingTargetCount
      };
    });

    return {
      datasetId: dataset.id as string,
      name: dataset.name as string,
      description: (dataset.description as string | null) ?? null,
      sourceBatchId: dataset.source_batch_id as string,
      sourceOrganizationId: dataset.source_organization_id as string,
      sourceOrganizationName: sourceOrgMap.get(dataset.source_organization_id as string) ?? "Unknown org",
      listType: (dataset.list_type as PlatformDatasetItem["listType"]) ?? "general_canvass_list",
      rowCount,
      coverage: {
        cities: Array.from(coverageMap.get(datasetId)?.cities ?? []).sort((a, b) => a.localeCompare(b)),
        zips: Array.from(coverageMap.get(datasetId)?.zips ?? []).sort((a, b) => a.localeCompare(b))
      },
      organizationStatuses,
      status: (dataset.status as PlatformDatasetItem["status"]) ?? "active",
      createdAt: dataset.created_at as string,
      grants: grantsByDataset.get(dataset.id as string) ?? []
    };
  });
}

export async function getOrganizationSharedDatasetAccess(
  context: AuthSessionContext
): Promise<SharedDatasetAccessListItem[]> {
  if (!context.organizationId) return [];
  const supabase = createServerSupabaseClient();

  const { data: grants, error: grantsError } = await supabase
    .from("organization_dataset_access")
    .select("platform_dataset_id,status,visibility_scope,assigned_team_id,assigned_user_id,granted_at")
    .eq("organization_id", context.organizationId)
    .eq("status", "active")
    .order("granted_at", { ascending: false });
  if (grantsError) throw grantsError;

  const datasetIds = [...new Set((grants ?? []).map((row) => row.platform_dataset_id as string))];
  const [{ data: sourceDatasets, error: sourceDatasetsError }, { data: datasets, error: datasetsError }, { data: counts, error: countsError }] = await Promise.all([
    supabase
      .from("platform_datasets")
      .select("id,name,description,source_organization_id,list_type,status,created_at")
      .eq("source_organization_id", context.organizationId)
      .eq("status", "active"),
    supabase
      .from("platform_datasets")
      .select("id,name,description,source_organization_id,list_type,status,created_at")
      .in("id", datasetIds.length ? datasetIds : ["00000000-0000-0000-0000-000000000000"])
      .eq("status", "active"),
    supabase
      .from("platform_dataset_records")
      .select("platform_dataset_id")
  ]);
  if (sourceDatasetsError) throw sourceDatasetsError;
  if (datasetsError) throw datasetsError;
  if (countsError) throw countsError;

  const combinedDatasets = [...(datasets ?? []), ...(sourceDatasets ?? [])];
  if (!combinedDatasets.length) return [];

  const sourceOrgIds = [...new Set(combinedDatasets.map((row) => row.source_organization_id as string))];
  const { data: sourceOrgs } = sourceOrgIds.length
    ? await supabase.from("organizations").select("id,name").in("id", sourceOrgIds)
    : { data: [] };
  const { grantedOrgMap: sourceOrgMap, teamMap, userMap } = await loadGrantLookups((grants ?? []) as Record<string, unknown>[]);
  if (sourceOrgs?.length) {
    for (const row of sourceOrgs) sourceOrgMap.set(row.id as string, (row.name as string | null) ?? "Unknown org");
  }

  const datasetMap = new Map(combinedDatasets.map((row) => [row.id as string, row]));
  const rowCountMap = new Map<string, number>();
  for (const row of counts ?? []) {
    const datasetId = row.platform_dataset_id as string;
    rowCountMap.set(datasetId, (rowCountMap.get(datasetId) ?? 0) + 1);
  }

  const grantItems = (grants ?? [])
    .map((grant) => {
      const dataset = datasetMap.get(grant.platform_dataset_id as string);
      if (!dataset) return null;
      if ((dataset.source_organization_id as string | null | undefined) === context.organizationId) return null;
      return {
        datasetId: dataset.id as string,
        name: dataset.name as string,
        description: (dataset.description as string | null) ?? null,
        sourceOrganizationName: sourceOrgMap.get(dataset.source_organization_id as string) ?? "Unknown org",
        listType: (dataset.list_type as SharedDatasetAccessListItem["listType"]) ?? "general_canvass_list",
        rowCount: rowCountMap.get(dataset.id as string) ?? 0,
        visibilityScope: (grant.visibility_scope as SharedDatasetAccessListItem["visibilityScope"]) ?? "organization",
        assignedTeamName: grant.assigned_team_id ? teamMap.get(grant.assigned_team_id as string) ?? null : null,
        assignedUserName: grant.assigned_user_id ? userMap.get(grant.assigned_user_id as string) ?? null : null,
        grantedAt: grant.granted_at as string,
        status: (grant.status as SharedDatasetAccessListItem["status"]) ?? "active"
      } satisfies SharedDatasetAccessListItem;
    })
    .filter((item): item is SharedDatasetAccessListItem => Boolean(item));

  const grantedIds = new Set(grantItems.map((item) => item.datasetId));
  const sourceItems = (sourceDatasets ?? [])
    .filter((dataset) => !grantedIds.has(dataset.id as string))
    .map((dataset) => ({
      datasetId: dataset.id as string,
      name: dataset.name as string,
      description: (dataset.description as string | null) ?? null,
      sourceOrganizationName: sourceOrgMap.get(dataset.source_organization_id as string) ?? "Unknown org",
      listType: (dataset.list_type as SharedDatasetAccessListItem["listType"]) ?? "general_canvass_list",
      rowCount: rowCountMap.get(dataset.id as string) ?? 0,
      visibilityScope: "organization" as const,
      assignedTeamName: null,
      assignedUserName: null,
      grantedAt: (dataset.created_at as string | null) ?? new Date(0).toISOString(),
      status: "active" as const
    }));

  return [...sourceItems, ...grantItems].sort(
    (left, right) => new Date(right.grantedAt).getTime() - new Date(left.grantedAt).getTime()
  );
}
