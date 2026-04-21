import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";
import type { OrganizationBranding } from "@/types/api";
import { DEFAULT_ORGANIZATION_THEME } from "@/lib/branding/theme";

const DEFAULT_BRANDING = DEFAULT_ORGANIZATION_THEME;

export async function getOrganizationBranding(
  context: AuthSessionContext
): Promise<OrganizationBranding> {
  if (!context.organizationId) {
    return {
      organizationId: "default",
      appName: DEFAULT_BRANDING.appName,
      logoUrl: null,
      primaryColor: DEFAULT_BRANDING.primaryColor,
      accentColor: DEFAULT_BRANDING.accentColor,
      backgroundColor: DEFAULT_BRANDING.backgroundColor,
      backgroundAccentColor: DEFAULT_BRANDING.backgroundAccentColor,
      surfaceColor: DEFAULT_BRANDING.surfaceColor,
      sidebarColor: DEFAULT_BRANDING.sidebarColor
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
        theme_config?:
          | {
              backgroundColor?: string | null;
              backgroundAccentColor?: string | null;
              surfaceColor?: string | null;
              sidebarColor?: string | null;
            }
          | null;
      }
    | null
    | undefined;

  const brandingResponse = await supabase
    .from("organizations")
    .select("id,name,brand_name,logo_url,primary_color,accent_color,theme_config")
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
    accentColor: (data?.accent_color as string | null | undefined) ?? DEFAULT_BRANDING.accentColor,
    backgroundColor:
      (data?.theme_config?.backgroundColor as string | null | undefined) ??
      DEFAULT_BRANDING.backgroundColor,
    backgroundAccentColor:
      (data?.theme_config?.backgroundAccentColor as string | null | undefined) ??
      DEFAULT_BRANDING.backgroundAccentColor,
    surfaceColor:
      (data?.theme_config?.surfaceColor as string | null | undefined) ??
      DEFAULT_BRANDING.surfaceColor,
    sidebarColor:
      (data?.theme_config?.sidebarColor as string | null | undefined) ??
      DEFAULT_BRANDING.sidebarColor
  };
}
