import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";
import type { AppBranding } from "@/types/api";
import { DEFAULT_ORGANIZATION_THEME } from "@/lib/branding/theme";

const DEFAULT_BRANDING = DEFAULT_ORGANIZATION_THEME;

export async function getAppBranding(_context?: AuthSessionContext | null): Promise<AppBranding> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("app_branding_settings")
    .select("id,app_name,logo_url,primary_color,accent_color,theme_config")
    .eq("id", "default")
    .maybeSingle();

  if (error && error.code !== "42P01") throw error;

  return {
    brandingId: (data?.id as string | undefined) ?? "default",
    appName: (data?.app_name as string | null | undefined) ?? DEFAULT_BRANDING.appName,
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
