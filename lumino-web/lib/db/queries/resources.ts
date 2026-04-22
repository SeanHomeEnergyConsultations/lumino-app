import { hasManagerAccess } from "@/lib/auth/permissions";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";
import type { OrganizationResourceItem, ResourcesResponse } from "@/types/api";

type ResourceRow = {
  id: string;
  title: string;
  description: string | null;
  resource_type: "document" | "video" | "printable";
  territory_id: string | null;
  uploaded_by_user_id: string;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  file_size_bytes: number;
  created_at: string;
};

export async function getResourcesLibrary(context: AuthSessionContext): Promise<ResourcesResponse> {
  if (!context.organizationId) {
    throw new Error("No active organization found for this user.");
  }

  const supabase = createServerSupabaseClient();
  const { data: rows, error } = await supabase
    .from("organization_resources")
    .select(
      "id,title,description,resource_type,territory_id,uploaded_by_user_id,storage_bucket,storage_path,file_name,mime_type,file_size_bytes,created_at"
    )
    .eq("organization_id", context.organizationId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) throw error;

  const resourceRows = (rows ?? []) as ResourceRow[];
  const territoryIds = [...new Set(resourceRows.map((row) => row.territory_id).filter(Boolean))] as string[];
  const userIds = [...new Set(resourceRows.map((row) => row.uploaded_by_user_id).filter(Boolean))] as string[];

  const [
    { data: territoryRows, error: territoryError },
    { data: userRows, error: userError }
  ] = await Promise.all([
    territoryIds.length
      ? supabase.from("territories").select("id,name").in("id", territoryIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? supabase.from("app_users").select("id,full_name,email").in("id", userIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (territoryError) throw territoryError;
  if (userError) throw userError;

  const territoryMap = new Map(
    ((territoryRows ?? []) as Array<{ id: string; name: string | null }>).map((row) => [row.id, row.name])
  );
  const userMap = new Map(
    ((userRows ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((row) => [
      row.id,
      row.full_name ?? row.email ?? null
    ])
  );

  const items = await Promise.all(
    resourceRows.map(async (row) => {
      const { data: signed } = await supabase.storage
        .from(row.storage_bucket)
        .createSignedUrl(row.storage_path, 60 * 60);

      return {
        resourceId: row.id,
        title: row.title,
        description: row.description,
        resourceType: row.resource_type,
        territoryId: row.territory_id,
        territoryName: row.territory_id ? territoryMap.get(row.territory_id) ?? null : null,
        fileName: row.file_name,
        mimeType: row.mime_type,
        fileSizeBytes: Number(row.file_size_bytes),
        uploaderUserId: row.uploaded_by_user_id,
        uploaderName: userMap.get(row.uploaded_by_user_id) ?? null,
        signedUrl: signed?.signedUrl ?? null,
        createdAt: row.created_at
      } satisfies OrganizationResourceItem;
    })
  );

  return {
    canManageResources: hasManagerAccess(context),
    items
  };
}
