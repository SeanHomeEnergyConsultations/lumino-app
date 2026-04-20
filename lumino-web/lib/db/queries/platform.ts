import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { hasPlatformAccess } from "@/lib/auth/permissions";
import {
  displayDatasetEntitlementValue,
  emptyDatasetEntitlements,
  normalizeDatasetEntitlementValue
} from "@/lib/platform/dataset-entitlements";
import { resolveOrganizationFeatures } from "@/lib/platform/features";
import type {
  PlatformOverviewResponse,
  PlatformSecurityEventItem,
  PlatformSecurityEventsResponse
} from "@/types/api";
import type { AuthSessionContext } from "@/types/auth";

type OrganizationRow = {
  id: string;
  name: string | null;
  slug: string | null;
  status: string | null;
  billing_plan: string | null;
  is_platform_source?: boolean | null;
  brand_name?: string | null;
  created_at: string;
};

function assertPlatformAccess(context: AuthSessionContext) {
  if (!hasPlatformAccess(context)) {
    throw new Error("Platform access required.");
  }
}

function parseFeatureOverrideRow(row: Record<string, unknown> | undefined) {
  return {
    enrichmentEnabled: (row?.enrichment_enabled as boolean | null | undefined) ?? null,
    priorityScoringEnabled: (row?.priority_scoring_enabled as boolean | null | undefined) ?? null,
    advancedImportsEnabled: (row?.advanced_imports_enabled as boolean | null | undefined) ?? null,
    securityConsoleEnabled: (row?.security_console_enabled as boolean | null | undefined) ?? null
  };
}

function resolveOrganizationBillingPlanForAccess(organization: {
  billing_plan?: string | null;
  is_platform_source?: boolean | null;
} | null | undefined) {
  if (organization?.is_platform_source) {
    return "intelligence";
  }
  return (organization?.billing_plan as string | null | undefined) ?? null;
}

export async function getOrganizationFeatureAccess(organizationId: string) {
  const supabase = createServerSupabaseClient();

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("billing_plan,is_platform_source")
    .eq("id", organizationId)
    .maybeSingle();

  if (organizationError) throw organizationError;

  const { data: featureRow, error: featureError } = await supabase
    .from("organization_features")
    .select(
      "enrichment_enabled,priority_scoring_enabled,advanced_imports_enabled,security_console_enabled"
    )
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (featureError) throw featureError;

  return resolveOrganizationFeatures({
    billingPlan: resolveOrganizationBillingPlanForAccess(organization),
    overrides: parseFeatureOverrideRow(featureRow as Record<string, unknown> | undefined)
  });
}

export async function getPlatformOrganizationOverview(
  context: AuthSessionContext
): Promise<PlatformOverviewResponse["items"]> {
  assertPlatformAccess(context);
  const supabase = createServerSupabaseClient();

  const [
    { data: organizations, error: organizationsError },
    { data: memberships, error: membershipsError },
    { data: imports, error: importsError },
    { data: territories, error: territoriesError },
    { data: securityEvents, error: securityEventsError },
    { data: featureRows, error: featureRowsError },
    { data: entitlementRows, error: entitlementRowsError }
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select("id,name,slug,status,billing_plan,is_platform_source,brand_name,created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("organization_members")
      .select("organization_id,user_id,role,is_active"),
    supabase
      .from("import_batches")
      .select("organization_id,status,created_at,completed_at"),
    supabase
      .from("territories")
      .select("organization_id,id"),
    supabase
      .from("security_events")
      .select("organization_id,created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("organization_features")
      .select(
        "organization_id,enrichment_enabled,priority_scoring_enabled,advanced_imports_enabled,security_console_enabled"
      ),
    supabase
      .from("organization_dataset_entitlements")
      .select("organization_id,dataset_type,geography_type,geography_value_normalized,status")
      .eq("status", "active")
  ]);

  if (organizationsError) throw organizationsError;
  if (membershipsError) throw membershipsError;
  if (importsError) throw importsError;
  if (territoriesError) throw territoriesError;
  if (securityEventsError) throw securityEventsError;
  if (featureRowsError) throw featureRowsError;
  if (entitlementRowsError) throw entitlementRowsError;

  const membershipsByOrg = new Map<
    string,
    {
      teamMemberCount: number;
      activeTeamMemberCount: number;
      adminCount: number;
    }
  >();

  for (const membership of memberships ?? []) {
    const organizationId = membership.organization_id as string | null;
    if (!organizationId) continue;
    const current = membershipsByOrg.get(organizationId) ?? {
      teamMemberCount: 0,
      activeTeamMemberCount: 0,
      adminCount: 0
    };
    current.teamMemberCount += 1;
    if (membership.is_active) current.activeTeamMemberCount += 1;
    if (membership.is_active && ["owner", "admin"].includes((membership.role as string) ?? "")) {
      current.adminCount += 1;
    }
    membershipsByOrg.set(organizationId, current);
  }

  const importsByOrg = new Map<
    string,
    {
      importBatchCount: number;
      completedImportCount: number;
      lastImportAt: string | null;
    }
  >();

  for (const row of imports ?? []) {
    const organizationId = row.organization_id as string | null;
    if (!organizationId) continue;
    const current = importsByOrg.get(organizationId) ?? {
      importBatchCount: 0,
      completedImportCount: 0,
      lastImportAt: null
    };
    current.importBatchCount += 1;
    if (["completed", "completed_with_errors"].includes((row.status as string | null) ?? "")) {
      current.completedImportCount += 1;
    }
    const candidate = (row.completed_at as string | null) ?? (row.created_at as string | null) ?? null;
    if (candidate && (!current.lastImportAt || candidate > current.lastImportAt)) {
      current.lastImportAt = candidate;
    }
    importsByOrg.set(organizationId, current);
  }

  const territoryCounts = new Map<string, number>();
  for (const territory of territories ?? []) {
    const organizationId = territory.organization_id as string | null;
    if (!organizationId) continue;
    territoryCounts.set(organizationId, (territoryCounts.get(organizationId) ?? 0) + 1);
  }

  const lastSecurityEventByOrg = new Map<string, string>();
  for (const event of securityEvents ?? []) {
    const organizationId = event.organization_id as string | null;
    const createdAt = event.created_at as string | null;
    if (!organizationId || !createdAt || lastSecurityEventByOrg.has(organizationId)) continue;
    lastSecurityEventByOrg.set(organizationId, createdAt);
  }

  const featureRowByOrg = new Map(
    (featureRows ?? []).map((row) => [row.organization_id as string, row as Record<string, unknown>])
  );
  const entitlementsByOrg = new Map<string, ReturnType<typeof emptyDatasetEntitlements>>();

  for (const row of entitlementRows ?? []) {
    const organizationId = row.organization_id as string | null;
    const datasetType = row.dataset_type as keyof ReturnType<typeof emptyDatasetEntitlements> | null;
    const geographyType = row.geography_type as "city" | "zip" | null;
    const value = row.geography_value_normalized as string | null;
    if (!organizationId || !datasetType || !geographyType || !value) continue;
    const current = entitlementsByOrg.get(organizationId) ?? emptyDatasetEntitlements();
    const bucket = current[datasetType][geographyType === "zip" ? "zips" : "cities"];
    const displayValue = displayDatasetEntitlementValue(
      geographyType,
      normalizeDatasetEntitlementValue(geographyType, value)
    );
    if (!bucket.includes(displayValue)) bucket.push(displayValue);
    entitlementsByOrg.set(organizationId, current);
  }

  const organizationRows = ((organizations as OrganizationRow[] | null) ?? []);

  return organizationRows.map((organization) => {
    const membershipStats = membershipsByOrg.get(organization.id) ?? {
      teamMemberCount: 0,
      activeTeamMemberCount: 0,
      adminCount: 0
    };
    const importStats = importsByOrg.get(organization.id) ?? {
      importBatchCount: 0,
      completedImportCount: 0,
      lastImportAt: null
    };
    const overrides = parseFeatureOverrideRow(featureRowByOrg.get(organization.id));
    const featureResolution = resolveOrganizationFeatures({
      billingPlan: resolveOrganizationBillingPlanForAccess(organization),
      overrides
    });
    const lastSecurityEventAt = lastSecurityEventByOrg.get(organization.id) ?? null;
    const lastActivityAt =
      [lastSecurityEventAt, importStats.lastImportAt, organization.created_at]
        .filter(Boolean)
        .sort()
        .at(-1) ?? organization.created_at;

    return {
      organizationId: organization.id,
      name: organization.name ?? "Untitled Organization",
      appName: organization.brand_name ?? organization.name ?? "Lumino",
      slug: organization.slug ?? null,
      status: organization.status ?? "active",
      billingPlan: featureResolution.billingPlan,
      isPlatformSource: Boolean(organization.is_platform_source),
      createdAt: organization.created_at,
      teamMemberCount: membershipStats.teamMemberCount,
      activeTeamMemberCount: membershipStats.activeTeamMemberCount,
      adminCount: membershipStats.adminCount,
      importBatchCount: importStats.importBatchCount,
      completedImportCount: importStats.completedImportCount,
      territoryCount: territoryCounts.get(organization.id) ?? 0,
      lastImportAt: importStats.lastImportAt,
      lastSecurityEventAt,
      lastActivityAt,
      featureOverrides: featureResolution.overrides,
      effectiveFeatures: featureResolution.effective,
      datasetEntitlements: entitlementsByOrg.get(organization.id) ?? emptyDatasetEntitlements(),
      checklist: {
        firstAdminInvited: membershipStats.adminCount > 0,
        brandingConfigured: Boolean(organization.brand_name),
        firstImportCompleted: importStats.completedImportCount > 0,
        firstTerritoryCreated: (territoryCounts.get(organization.id) ?? 0) > 0
      }
    };
  });
}

export async function getPlatformSecurityEvents(
  context: AuthSessionContext,
  filters?: {
    organizationId?: string | null;
    severity?: string | null;
    eventType?: string | null;
    limit?: number;
  }
): Promise<PlatformSecurityEventsResponse["items"]> {
  assertPlatformAccess(context);
  const supabase = createServerSupabaseClient();
  const limit = Math.min(200, Math.max(20, filters?.limit ?? 80));

  let query = supabase
    .from("security_events")
    .select("id,organization_id,actor_user_id,target_user_id,event_type,severity,ip_address,user_agent,metadata,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filters?.organizationId) query = query.eq("organization_id", filters.organizationId);
  if (filters?.severity) query = query.eq("severity", filters.severity);
  if (filters?.eventType) query = query.eq("event_type", filters.eventType);

  const { data: rows, error } = await query;
  if (error) throw error;

  const organizationIds = [...new Set((rows ?? []).map((row) => row.organization_id as string | null).filter(Boolean))] as string[];
  const userIds = [
    ...new Set(
      (rows ?? [])
        .flatMap((row) => [row.actor_user_id as string | null, row.target_user_id as string | null])
        .filter(Boolean)
    )
  ] as string[];

  const [{ data: organizations, error: organizationsError }, { data: users, error: usersError }] =
    await Promise.all([
      organizationIds.length
        ? supabase.from("organizations").select("id,name").in("id", organizationIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? supabase.from("app_users").select("id,full_name,email").in("id", userIds)
        : Promise.resolve({ data: [], error: null })
    ]);

  if (organizationsError) throw organizationsError;
  if (usersError) throw usersError;

  const organizationMap = new Map((organizations ?? []).map((row) => [row.id as string, row]));
  const userMap = new Map((users ?? []).map((row) => [row.id as string, row]));

  return (rows ?? []).map((row) => {
    const actor = row.actor_user_id ? userMap.get(row.actor_user_id as string) : null;
    const target = row.target_user_id ? userMap.get(row.target_user_id as string) : null;
    const organization = row.organization_id ? organizationMap.get(row.organization_id as string) : null;

    return {
      id: row.id as string,
      organizationId: (row.organization_id as string | null) ?? null,
      organizationName: (organization?.name as string | null | undefined) ?? null,
      actorUserId: (row.actor_user_id as string | null) ?? null,
      actorName: (actor?.full_name as string | null | undefined) ?? null,
      actorEmail: (actor?.email as string | null | undefined) ?? null,
      targetUserId: (row.target_user_id as string | null) ?? null,
      targetName: (target?.full_name as string | null | undefined) ?? null,
      targetEmail: (target?.email as string | null | undefined) ?? null,
      eventType: row.event_type as string,
      severity: (row.severity as PlatformSecurityEventItem["severity"]) ?? "info",
      ipAddress: (row.ip_address as string | null) ?? null,
      userAgent: (row.user_agent as string | null) ?? null,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: row.created_at as string
    };
  });
}
