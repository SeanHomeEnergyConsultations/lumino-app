import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { hasPlatformAccess } from "@/lib/auth/permissions";
import type { PlatformDatasetItem, PlatformDatasetsResponse } from "@/types/api";
import type { AuthSessionContext } from "@/types/auth";

function assertPlatformAccess(context: AuthSessionContext) {
  if (!hasPlatformAccess(context)) {
    throw new Error("Platform access required.");
  }
}

export async function getPlatformDatasets(
  context: AuthSessionContext
): Promise<PlatformDatasetsResponse["items"]> {
  assertPlatformAccess(context);
  const supabase = createServerSupabaseClient();

  const [{ data: datasets, error: datasetsError }, { data: grants, error: grantsError }] = await Promise.all([
    supabase
      .from("platform_datasets")
      .select("id,name,description,source_batch_id,source_organization_id,list_type,status,created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("organization_dataset_access")
      .select("platform_dataset_id,organization_id,status,visibility_scope,assigned_team_id,assigned_user_id,last_released_batch_id,granted_at")
      .order("granted_at", { ascending: false })
  ]);

  if (datasetsError) throw datasetsError;
  if (grantsError) throw grantsError;

  const sourceOrganizationIds = [...new Set((datasets ?? []).map((row) => row.source_organization_id as string))];
  const grantedOrganizationIds = [...new Set((grants ?? []).map((row) => row.organization_id as string))];
  const teamIds = [...new Set((grants ?? []).map((row) => row.assigned_team_id as string | null).filter(Boolean))] as string[];
  const userIds = [...new Set((grants ?? []).map((row) => row.assigned_user_id as string | null).filter(Boolean))] as string[];
  const batchIds = [...new Set((datasets ?? []).map((row) => row.source_batch_id as string))];

  const [
    { data: sourceOrgs, error: sourceOrgsError },
    { data: grantedOrgs, error: grantedOrgsError },
    { data: teams, error: teamsError },
    { data: users, error: usersError },
    { data: batches, error: batchesError }
  ] = await Promise.all([
    sourceOrganizationIds.length
      ? supabase.from("organizations").select("id,name").in("id", sourceOrganizationIds)
      : Promise.resolve({ data: [], error: null }),
    grantedOrganizationIds.length
      ? supabase.from("organizations").select("id,name").in("id", grantedOrganizationIds)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length
      ? supabase.from("teams").select("id,name").in("id", teamIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? supabase.from("app_users").select("id,full_name,email").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
    batchIds.length
      ? supabase.from("import_batches").select("id,total_rows").in("id", batchIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (sourceOrgsError) throw sourceOrgsError;
  if (grantedOrgsError) throw grantedOrgsError;
  if (teamsError) throw teamsError;
  if (usersError) throw usersError;
  if (batchesError) throw batchesError;

  const sourceOrgMap = new Map((sourceOrgs ?? []).map((row) => [row.id as string, (row.name as string | null) ?? "Unknown org"]));
  const grantedOrgMap = new Map((grantedOrgs ?? []).map((row) => [row.id as string, (row.name as string | null) ?? "Unknown org"]));
  const teamMap = new Map((teams ?? []).map((row) => [row.id as string, (row.name as string | null) ?? "Unnamed team"]));
  const userMap = new Map(
    (users ?? []).map((row) => [
      row.id as string,
      ((row.full_name as string | null) ?? (row.email as string | null) ?? "Unknown user")
    ])
  );
  const batchMap = new Map((batches ?? []).map((row) => [row.id as string, Number(row.total_rows ?? 0)]));

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
      lastReleasedBatchId: (grant.last_released_batch_id as string | null) ?? null,
      grantedAt: grant.granted_at as string
    });
    grantsByDataset.set(datasetId, current);
  }

  return (datasets ?? []).map((dataset) => ({
    datasetId: dataset.id as string,
    name: dataset.name as string,
    description: (dataset.description as string | null) ?? null,
    sourceBatchId: dataset.source_batch_id as string,
    sourceOrganizationId: dataset.source_organization_id as string,
    sourceOrganizationName: sourceOrgMap.get(dataset.source_organization_id as string) ?? "Unknown org",
    listType: (dataset.list_type as PlatformDatasetItem["listType"]) ?? "general_canvass_list",
    rowCount: batchMap.get(dataset.source_batch_id as string) ?? 0,
    status: (dataset.status as PlatformDatasetItem["status"]) ?? "active",
    createdAt: dataset.created_at as string,
    grants: grantsByDataset.get(dataset.id as string) ?? []
  }));
}
