import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";
import type { OrganizationBranding } from "@/types/api";

const DEFAULT_BRANDING = {
  appName: "Lumino",
  primaryColor: "#0b1220",
  accentColor: "#94a3b8"
};

export async function getOrganizationBranding(
  context: AuthSessionContext
): Promise<OrganizationBranding> {
  if (!context.organizationId) {
    return {
      organizationId: "default",
      appName: DEFAULT_BRANDING.appName,
      logoUrl: null,
      primaryColor: DEFAULT_BRANDING.primaryColor,
      accentColor: DEFAULT_BRANDING.accentColor
    };
  }

  const supabase = createServerSupabaseClient();
  let data:
    | {
        id?: string;
        name?: string | null;
        brand_name?: string | null;
        logo_url?: string | null;
        primary_color?: string | null;
        accent_color?: string | null;
      }
    | null
    | undefined;

  const brandingResponse = await supabase
    .from("organizations")
    .select("id,name,brand_name,logo_url,primary_color,accent_color")
    .eq("id", context.organizationId)
    .maybeSingle();

  if (brandingResponse.error) {
    const fallbackResponse = await supabase
      .from("organizations")
      .select("id,name")
      .eq("id", context.organizationId)
      .maybeSingle();
    if (fallbackResponse.error) throw fallbackResponse.error;
    data = fallbackResponse.data as typeof data;
  } else {
    data = brandingResponse.data as typeof data;
  }

  return {
    organizationId: (data?.id as string | undefined) ?? context.organizationId,
    appName:
      (data?.brand_name as string | null | undefined) ??
      (data?.name as string | null | undefined) ??
      DEFAULT_BRANDING.appName,
    logoUrl: (data?.logo_url as string | null | undefined) ?? null,
    primaryColor: (data?.primary_color as string | null | undefined) ?? DEFAULT_BRANDING.primaryColor,
    accentColor: (data?.accent_color as string | null | undefined) ?? DEFAULT_BRANDING.accentColor
  };
}
