import { createServerSupabaseClient } from "@/lib/db/supabase-server";

export interface OrganizationAuthEmailBranding {
  orgId: string | null;
  orgName: string;
  orgLogoUrl: string | null;
  brandColor: string;
  supportEmail: string;
  appName: string;
  appUrl: string;
}

const DEFAULT_APP_NAME = "Lumino";
const DEFAULT_BRAND_COLOR = "#0b1220";
const DEFAULT_SUPPORT_EMAIL = "sean.dotts@gmail.com";
const DEFAULT_APP_URL = "http://localhost:3000";

function normalizeUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function getDefaultAppUrl() {
  return (
    normalizeUrl(process.env.NEXT_PUBLIC_APP_URL) ??
    normalizeUrl(process.env.NEXT_PUBLIC_SITE_URL) ??
    DEFAULT_APP_URL
  );
}

export async function getOrganizationAuthEmailBranding(
  organizationId: string | null | undefined
): Promise<OrganizationAuthEmailBranding> {
  const fallback = {
    orgId: organizationId ?? null,
    orgName: DEFAULT_APP_NAME,
    orgLogoUrl: null,
    brandColor: DEFAULT_BRAND_COLOR,
    supportEmail: DEFAULT_SUPPORT_EMAIL,
    appName: DEFAULT_APP_NAME,
    appUrl: getDefaultAppUrl()
  } satisfies OrganizationAuthEmailBranding;

  if (!organizationId) return fallback;

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id,name,brand_name,logo_url,primary_color,support_email,app_url")
    .eq("id", organizationId)
    .maybeSingle();

  if (error || !data) {
    return fallback;
  }

  return {
    orgId: (data.id as string | null | undefined) ?? organizationId,
    orgName: ((data.name as string | null | undefined)?.trim() || DEFAULT_APP_NAME),
    orgLogoUrl: ((data.logo_url as string | null | undefined)?.trim() || null),
    brandColor: ((data.primary_color as string | null | undefined)?.trim() || DEFAULT_BRAND_COLOR),
    supportEmail: ((data.support_email as string | null | undefined)?.trim() || DEFAULT_SUPPORT_EMAIL),
    appName:
      ((data.brand_name as string | null | undefined)?.trim() ||
        (data.name as string | null | undefined)?.trim() ||
        DEFAULT_APP_NAME),
    appUrl: normalizeUrl((data.app_url as string | null | undefined) ?? null) ?? fallback.appUrl
  };
}

export function buildInviteRedirectUrl(appUrl: string) {
  return `${appUrl.replace(/\/$/, "")}/set-password?mode=invite`;
}

export function buildPasswordResetRedirectUrl(appUrl: string) {
  return `${appUrl.replace(/\/$/, "")}/set-password?mode=recovery`;
}

export function buildInviteUserMetadata(
  branding: OrganizationAuthEmailBranding,
  fullName: string
) {
  return {
    full_name: fullName.trim(),
    org_id: branding.orgId,
    org_name: branding.orgName,
    org_logo_url: branding.orgLogoUrl,
    brand_color: branding.brandColor,
    support_email: branding.supportEmail,
    app_name: branding.appName,
    app_url: branding.appUrl
  };
}
