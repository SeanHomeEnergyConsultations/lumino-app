import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { hasPlatformAccess } from "@/lib/auth/permissions";
import { getOrganizationFeatureAccess } from "@/lib/db/queries/platform";
import { resolveOrganizationFeatures } from "@/lib/platform/features";
import type { PlatformOrganizationOverviewItem } from "@/types/api";
import type { AuthSessionContext } from "@/types/auth";

function assertPlatformAccess(context: AuthSessionContext) {
  if (!hasPlatformAccess(context)) {
    throw new Error("Platform access required.");
  }
}

export async function updatePlatformOrganization(
  organizationId: string,
  input: {
    billingPlan?: string | null;
    status?: string | null;
  },
  context: AuthSessionContext
): Promise<Pick<PlatformOrganizationOverviewItem, "organizationId" | "billingPlan" | "status">> {
  assertPlatformAccess(context);
  const supabase = createServerSupabaseClient();

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };

  if (input.billingPlan) payload.billing_plan = input.billingPlan;
  if (input.status) payload.status = input.status;

  const { data, error } = await supabase
    .from("organizations")
    .update(payload)
    .eq("id", organizationId)
    .select("id,billing_plan,status")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Organization not found.");

  const resolved = resolveOrganizationFeatures({
    billingPlan: (data.billing_plan as string | null | undefined) ?? null
  });

  return {
    organizationId: data.id as string,
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
