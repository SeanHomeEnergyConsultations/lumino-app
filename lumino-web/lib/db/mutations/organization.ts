import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";
import type { OrganizationBranding, OrganizationBrandLogoUploadTargetResponse } from "@/types/api";
import { getOrganizationBranding } from "@/lib/db/queries/organization";

export const ORGANIZATION_BRAND_ASSETS_BUCKET = "organization-brand-assets";

function sanitizeBrandAssetName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "brand-asset";
}

export async function updateOrganizationBranding(
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
): Promise<OrganizationBranding> {
  if (!context.organizationId) throw new Error("No active organization found.");

  const supabase = createServerSupabaseClient();
  const payload = {
    brand_name: input.appName.trim(),
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
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from("organizations")
    .update(payload)
    .eq("id", context.organizationId);

  if (error) throw error;
  return getOrganizationBranding(context);
}

export async function createOrganizationBrandLogoUploadTarget(
  input: {
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
  },
  context: AuthSessionContext
): Promise<OrganizationBrandLogoUploadTargetResponse> {
  if (!context.organizationId) throw new Error("No active organization found.");

  const supabase = createServerSupabaseClient();
  const safeName = sanitizeBrandAssetName(input.fileName);
  const path = `${context.organizationId}/logo-${Date.now()}-${crypto.randomUUID()}-${safeName}`;

  const { data, error } = await supabase.storage.from(ORGANIZATION_BRAND_ASSETS_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) {
    throw error ?? new Error("Could not create branding upload target.");
  }

  const { data: publicData } = supabase.storage.from(ORGANIZATION_BRAND_ASSETS_BUCKET).getPublicUrl(path);

  return {
    bucket: ORGANIZATION_BRAND_ASSETS_BUCKET,
    path,
    token: data.token,
    publicUrl: publicData.publicUrl
  };
}
