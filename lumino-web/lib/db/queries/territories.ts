import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type {
  TerritoriesResponse,
  TerritoryDetailResponse,
  TerritoryListItem,
  TerritoryPropertyItem,
  TerritoryPropertySearchResponse
} from "@/types/api";
import type { AuthSessionContext } from "@/types/auth";

export async function getTerritories(context: AuthSessionContext): Promise<TerritoriesResponse> {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) throw new Error("No active organization found for this user.");

  const [{ data: territoryRows, error: territoryError }, { data: assignmentRows, error: assignmentError }] =
    await Promise.all([
      supabase
        .from("territories")
        .select("id,name,status,created_at")
        .eq("organization_id", context.organizationId)
        .order("created_at", { ascending: false }),
      supabase
        .from("property_territories")
        .select("territory_id")
        .eq("organization_id", context.organizationId)
    ]);

  if (territoryError) throw territoryError;
  if (assignmentError) throw assignmentError;

  const counts = new Map<string, number>();
  for (const row of assignmentRows ?? []) {
    const territoryId = row.territory_id as string;
    counts.set(territoryId, (counts.get(territoryId) ?? 0) + 1);
  }

  const items: TerritoryListItem[] = (territoryRows ?? []).map((row) => ({
    territoryId: row.id as string,
    name: row.name as string,
    status: row.status as string,
    propertyCount: counts.get(row.id as string) ?? 0,
    createdAt: row.created_at as string
  }));

  return { items };
}

export async function getTerritoryDetail(
  territoryId: string,
  context: AuthSessionContext
): Promise<TerritoryDetailResponse["item"] | null> {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) throw new Error("No active organization found for this user.");

  const { data: territoryRow, error: territoryError } = await supabase
    .from("territories")
    .select("id,name,status")
    .eq("organization_id", context.organizationId)
    .eq("id", territoryId)
    .maybeSingle();

  if (territoryError) throw territoryError;
  if (!territoryRow) return null;

  const { data: assignmentRows, error: assignmentError } = await supabase
    .from("property_territories")
    .select("property_id")
    .eq("organization_id", context.organizationId)
    .eq("territory_id", territoryId);

  if (assignmentError) throw assignmentError;

  const propertyIds = (assignmentRows ?? []).map((row) => row.property_id as string);
  let properties: TerritoryPropertyItem[] = [];

  if (propertyIds.length) {
    const { data: propertyRows, error: propertiesError } = await supabase
      .from("property_history_view")
      .select("property_id,raw_address,city,state")
      .in("property_id", propertyIds)
      .order("raw_address", { ascending: true });

    if (propertiesError) throw propertiesError;

    properties = (propertyRows ?? []).map((row) => ({
      propertyId: row.property_id as string,
      address: row.raw_address as string,
      city: (row.city as string | null) ?? null,
      state: (row.state as string | null) ?? null
    }));
  }

  return {
    territoryId: territoryRow.id as string,
    name: territoryRow.name as string,
    status: territoryRow.status as string,
    propertyCount: propertyIds.length,
    properties
  };
}

export async function searchAssignableProperties(
  query: string,
  context: AuthSessionContext
): Promise<TerritoryPropertySearchResponse> {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) throw new Error("No active organization found for this user.");

  const trimmed = query.trim();
  if (!trimmed) return { items: [] };

  const { data, error } = await supabase
    .from("property_history_view")
    .select("property_id,raw_address,city,state")
    .ilike("raw_address", `%${trimmed}%`)
    .limit(12);

  if (error) throw error;

  return {
    items: (data ?? []).map((row) => ({
      propertyId: row.property_id as string,
      address: row.raw_address as string,
      city: (row.city as string | null) ?? null,
      state: (row.state as string | null) ?? null
    }))
  };
}
