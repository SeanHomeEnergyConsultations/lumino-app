import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";
import type { OrganizationBranding } from "@/types/api";
import { getOrganizationBranding } from "@/lib/db/queries/organization";

export async function updateOrganizationBranding(
  input: {
    appName: string;
    logoUrl?: string | null;
    primaryColor?: string | null;
    accentColor?: string | null;
  },
  context: AuthSessionContext
): Promise<OrganizationBranding> {
  if (!context.organizationId) throw new Error("No active organization found.");

  const supabase = createServerSupabaseClient();
  const payload = {
    brand_name: input.appName.trim(),
    logo_url: input.logoUrl?.trim() || null,
    primary_color: input.primaryColor?.trim() || null,
    accent_color: input.accentColor?.trim() || null,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from("organizations")
    .update(payload)
    .eq("id", context.organizationId);

  if (error) throw error;
  return getOrganizationBranding(context);
}
