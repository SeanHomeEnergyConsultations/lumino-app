import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { resolveOrganizationFeatures } from "@/lib/platform/features";
import type { AuthSessionContext } from "@/types/auth";

export const CURRENT_UPLOAD_CONTRIBUTION_CONSENT_VERSION = "2026-04-19-upload-contribution";

export interface OrganizationUploadConsentStatus {
  billingPlan: ReturnType<typeof resolveOrganizationFeatures>["billingPlan"];
  requiresContributionConsent: boolean;
  contributedUploadsOnly: boolean;
  hasCurrentConsent: boolean;
  consentVersion: string | null;
  acceptedAt: string | null;
}

export async function getOrganizationUploadConsentStatus(
  context: Pick<AuthSessionContext, "organizationId">
): Promise<OrganizationUploadConsentStatus> {
  if (!context.organizationId) {
    return {
      billingPlan: "starter",
      requiresContributionConsent: false,
      contributedUploadsOnly: false,
      hasCurrentConsent: false,
      consentVersion: null,
      acceptedAt: null
    };
  }

  const supabase = createServerSupabaseClient();
  const [{ data: organization, error: organizationError }, { data: consent, error: consentError }] = await Promise.all([
    supabase.from("organizations").select("billing_plan").eq("id", context.organizationId).maybeSingle(),
    supabase
      .from("organization_upload_consents")
      .select("consent_version,accepted_at")
      .eq("organization_id", context.organizationId)
      .maybeSingle()
  ]);

  if (organizationError) throw organizationError;
  if (consentError) throw consentError;

  const resolved = resolveOrganizationFeatures({
    billingPlan: (organization?.billing_plan as string | null | undefined) ?? null
  });
  const hasCurrentConsent =
    (consent?.consent_version as string | null | undefined) === CURRENT_UPLOAD_CONTRIBUTION_CONSENT_VERSION;

  return {
    billingPlan: resolved.billingPlan,
    requiresContributionConsent: resolved.uploadPolicy.contributionConsentRequired,
    contributedUploadsOnly: resolved.uploadPolicy.contributedUploadsOnly,
    hasCurrentConsent,
    consentVersion: (consent?.consent_version as string | null | undefined) ?? null,
    acceptedAt: (consent?.accepted_at as string | null | undefined) ?? null
  };
}

export async function recordOrganizationUploadConsent(
  request: Request,
  context: AuthSessionContext
): Promise<OrganizationUploadConsentStatus> {
  if (!context.organizationId) {
    throw new Error("No active organization found.");
  }

  const supabase = createServerSupabaseClient();
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = request.headers.get("user-agent");

  const { error } = await supabase.from("organization_upload_consents").upsert(
    {
      organization_id: context.organizationId,
      consent_version: CURRENT_UPLOAD_CONTRIBUTION_CONSENT_VERSION,
      accepted_at: new Date().toISOString(),
      accepted_by: context.appUser.id,
      ip_address: forwardedFor,
      user_agent: userAgent,
      updated_at: new Date().toISOString()
    },
    { onConflict: "organization_id" }
  );

  if (error) throw error;
  return getOrganizationUploadConsentStatus(context);
}
