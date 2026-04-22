import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";
import type { AppBranding } from "@/types/api";
import { getAppBranding } from "@/lib/db/queries/app-branding";

export async function updateAppBranding(
  input: {
    appName: string;
    logoUrl?: string | null;
    logoScale?: number | null;
    primaryColor?: string | null;
    accentColor?: string | null;
    backgroundColor?: string | null;
    backgroundAccentColor?: string | null;
    surfaceColor?: string | null;
    sidebarColor?: string | null;
  },
  context: AuthSessionContext
): Promise<AppBranding> {
  const supabase = createServerSupabaseClient();
  const payload = {
    id: "default",
    app_name: input.appName.trim(),
    logo_url: input.logoUrl?.trim() || null,
    primary_color: input.primaryColor?.trim() || null,
    accent_color: input.accentColor?.trim() || null,
    theme_config: {
      logoScale: input.logoScale ?? 1,
      backgroundColor: input.backgroundColor?.trim() || null,
      backgroundAccentColor: input.backgroundAccentColor?.trim() || null,
      surfaceColor: input.surfaceColor?.trim() || null,
      sidebarColor: input.sidebarColor?.trim() || null
    },
    updated_by: context.appUser.id,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from("app_branding_settings").upsert(payload, { onConflict: "id" });
  if (error) throw error;
  return getAppBranding(context);
}
