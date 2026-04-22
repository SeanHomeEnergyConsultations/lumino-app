import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { hasPlatformAccess } from "@/lib/auth/permissions";
import {
  reconcileOrganizationDatasetAccess,
  syncMarketplaceDatasetsToOrganization,
  syncPlatformDatasetsToIntelligenceOrganization
} from "@/lib/db/mutations/platform-datasets";
import {
  type DatasetEntitlementCollection,
  DATASET_ENTITLEMENT_TYPES,
  normalizeDatasetEntitlementValue
} from "@/lib/platform/dataset-entitlements";
import { getOrganizationFeatureAccess } from "@/lib/db/queries/platform";
import { resolveOrganizationFeatures } from "@/lib/platform/features";
import type { PlatformOrganizationOverviewItem } from "@/types/api";
import type { AuthSessionContext } from "@/types/auth";

function assertPlatformAccess(context: AuthSessionContext) {
  if (!hasPlatformAccess(context)) {
    throw new Error("Platform access required.");
  }
}

async function getPlatformOrganizationRecord(organizationId: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id,name,slug,brand_name,billing_plan,status,is_platform_source")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Organization not found.");
  return data;
}

export async function updatePlatformOrganization(
  organizationId: string,
  input: {
    name?: string | null;
    slug?: string | null;
    billingPlan?: string | null;
    status?: string | null;
  },
  context: AuthSessionContext
): Promise<Pick<PlatformOrganizationOverviewItem, "organizationId" | "name" | "slug" | "appName" | "billingPlan" | "status">> {
  assertPlatformAccess(context);
  const supabase = createServerSupabaseClient();
  const organization = await getPlatformOrganizationRecord(organizationId);

  if (organization.is_platform_source) {
    throw new Error("The platform source organization is locked and cannot be moved between customer plans.");
  }

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };

  if (input.name?.trim()) payload.name = input.name.trim();
  if (typeof input.slug !== "undefined") payload.slug = input.slug?.trim() || null;
  if (input.billingPlan) payload.billing_plan = input.billingPlan;
  if (input.status) payload.status = input.status;

  const { data, error } = await supabase
    .from("organizations")
    .update(payload)
    .eq("id", organizationId)
    .select("id,name,slug,brand_name,billing_plan,status,is_platform_source")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Organization not found.");

  const resolved = resolveOrganizationFeatures({
    billingPlan: data.is_platform_source ? "intelligence" : ((data.billing_plan as string | null | undefined) ?? null)
  });

  if (input.billingPlan) {
    await reconcileOrganizationDatasetAccess(organizationId, context);

    if (resolved.datasetPolicy.autoReleaseAllPublishedDatasets) {
      await syncPlatformDatasetsToIntelligenceOrganization(organizationId, context);
    } else if (resolved.datasetPolicy.manualReleaseAllowed) {
      await syncMarketplaceDatasetsToOrganization(organizationId, context);
    }
  }

  return {
    organizationId: data.id as string,
    name: (data.name as string | null | undefined) ?? organization.name ?? "",
    slug: (data.slug as string | null | undefined) ?? null,
    appName:
      (data.brand_name as string | null | undefined) ??
      (organization.brand_name as string | null | undefined) ??
      (data.name as string | null | undefined) ??
      organization.name ??
      "",
    billingPlan: resolved.billingPlan,
    status: (data.status as string | null) ?? "active"
  };
}

export async function updateOrganizationFeatures(
  organizationId: string,
  input: {
    enrichmentEnabled?: boolean | null;
    priorityScoringEnabled?: boolean | null;
    advancedImportsEnabled?: boolean | null;
    securityConsoleEnabled?: boolean | null;
  },
  context: AuthSessionContext
) {
  assertPlatformAccess(context);
  const organization = await getPlatformOrganizationRecord(organizationId);
  if (organization.is_platform_source) {
    throw new Error("The platform source organization is locked and does not use customer feature overrides.");
  }
  const supabase = createServerSupabaseClient();

  const payload = {
    organization_id: organizationId,
    enrichment_enabled: input.enrichmentEnabled ?? null,
    priority_scoring_enabled: input.priorityScoringEnabled ?? null,
    advanced_imports_enabled: input.advancedImportsEnabled ?? null,
    security_console_enabled: input.securityConsoleEnabled ?? null,
    updated_by: context.appUser.id,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from("organization_features").upsert(payload, {
    onConflict: "organization_id"
  });

  if (error) throw error;
  return getOrganizationFeatureAccess(organizationId);
}

export async function replaceOrganizationDatasetEntitlements(
  organizationId: string,
  input: DatasetEntitlementCollection,
  context: AuthSessionContext
) {
  assertPlatformAccess(context);
  const organization = await getPlatformOrganizationRecord(organizationId);
  if (organization.is_platform_source) {
    throw new Error("The platform source organization does not use marketplace entitlements.");
  }
  const supabase = createServerSupabaseClient();

  const rows = DATASET_ENTITLEMENT_TYPES.flatMap((datasetType) => {
    const config = input[datasetType];
    return [
      ...config.cities.map((value) => ({
        organization_id: organizationId,
        dataset_type: datasetType,
        geography_type: "city" as const,
        geography_value: value,
        geography_value_normalized: normalizeDatasetEntitlementValue("city", value),
        status: "active" as const,
        updated_by: context.appUser.id
      })),
      ...config.zips.map((value) => ({
        organization_id: organizationId,
        dataset_type: datasetType,
        geography_type: "zip" as const,
        geography_value: value,
        geography_value_normalized: normalizeDatasetEntitlementValue("zip", value),
        status: "active" as const,
        updated_by: context.appUser.id
      }))
    ];
  }).filter((row) => row.geography_value_normalized);

  const { error: deleteError } = await supabase
    .from("organization_dataset_entitlements")
    .delete()
    .eq("organization_id", organizationId);
  if (deleteError) throw deleteError;

  if (rows.length) {
    const { error: insertError } = await supabase.from("organization_dataset_entitlements").insert(rows);
    if (insertError) throw insertError;
  }

  await reconcileOrganizationDatasetAccess(organizationId, context);
  await syncMarketplaceDatasetsToOrganization(organizationId, context);
  return input;
}
