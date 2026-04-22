import { hasManagerAccess } from "@/lib/auth/permissions";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";

export const ORGANIZATION_RESOURCES_BUCKET = "organization-resources";

function sanitizeFileName(value: string) {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "resource";
}

export async function createResourceUploadTarget(
  input: {
    fileName: string;
    mimeType?: string | null;
    fileSizeBytes: number;
  },
  context: AuthSessionContext
) {
  if (!context.organizationId) {
    throw new Error("No active organization found for this user.");
  }
  if (!hasManagerAccess(context)) {
    throw new Error("Only managers can upload resources.");
  }

  const supabase = createServerSupabaseClient();
  const safeName = sanitizeFileName(input.fileName);
  const path = `${context.organizationId}/${context.appUser.id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const { data, error } = await supabase.storage.from(ORGANIZATION_RESOURCES_BUCKET).createSignedUploadUrl(path);
  if (error) throw error;

  return {
    bucket: ORGANIZATION_RESOURCES_BUCKET,
    path,
    token: data.token
  };
}

export async function createResource(
  input: {
    title: string;
    description?: string | null;
    resourceType: "document" | "video" | "printable";
    territoryId?: string | null;
    storageBucket: string;
    storagePath: string;
    fileName: string;
    mimeType?: string | null;
    fileSizeBytes: number;
  },
  context: AuthSessionContext
) {
  if (!context.organizationId) {
    throw new Error("No active organization found for this user.");
  }
  if (!hasManagerAccess(context)) {
    throw new Error("Only managers can create resources.");
  }
  if (input.storageBucket !== ORGANIZATION_RESOURCES_BUCKET) {
    throw new Error("Invalid storage bucket.");
  }
  if (!input.storagePath.startsWith(`${context.organizationId}/`)) {
    throw new Error("Invalid storage path.");
  }

  const supabase = createServerSupabaseClient();
  if (input.territoryId) {
    const { data: territory, error: territoryError } = await supabase
      .from("territories")
      .select("id")
      .eq("organization_id", context.organizationId)
      .eq("id", input.territoryId)
      .maybeSingle();

    if (territoryError) throw territoryError;
    if (!territory) throw new Error("That territory does not belong to this organization.");
  }

  const { data: objectInfo, error: objectError } = await supabase.storage
    .from(input.storageBucket)
    .info(input.storagePath);
  if (objectError) throw objectError;
  if (!objectInfo) throw new Error("Uploaded file could not be found.");

  const { data, error } = await supabase
    .from("organization_resources")
    .insert({
      organization_id: context.organizationId,
      territory_id: input.territoryId ?? null,
      uploaded_by_user_id: context.appUser.id,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      resource_type: input.resourceType,
      storage_bucket: input.storageBucket,
      storage_path: input.storagePath,
      file_name: input.fileName.trim(),
      mime_type: input.mimeType?.trim() || null,
      file_size_bytes: input.fileSizeBytes
    })
    .select("id")
    .single();

  if (error) throw error;

  await supabase.from("activities").insert({
    organization_id: context.organizationId,
    entity_type: "user",
    entity_id: context.appUser.id,
    actor_user_id: context.appUser.id,
    type: "resource_created",
    data: {
      resource_id: data.id,
      title: input.title.trim(),
      territory_id: input.territoryId ?? null,
      resource_type: input.resourceType,
      storage_path: input.storagePath
    }
  });

  return {
    resourceId: data.id as string
  };
}
