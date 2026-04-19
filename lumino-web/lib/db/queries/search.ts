import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { SearchResponse, SearchResultItem } from "@/types/api";
import type { AuthSessionContext } from "@/types/auth";

export async function searchEntities(
  query: string,
  context: AuthSessionContext
): Promise<SearchResponse> {
  const supabase = createServerSupabaseClient();
  const trimmed = query.trim();
  const normalized = trimmed.toLowerCase();

  if (!trimmed || trimmed.length < 2) {
    return { items: [] };
  }

  const [{ data: propertyRows, error: propertyError }, { data: leadRows, error: leadError }] =
    await Promise.all([
      supabase
        .from("properties")
        .select("id,raw_address,address_line_1,city,state,postal_code,normalized_address")
        .or(
          [
            `raw_address.ilike.%${trimmed}%`,
            `address_line_1.ilike.%${trimmed}%`,
            `city.ilike.%${trimmed}%`,
            `state.ilike.%${trimmed}%`,
            `normalized_address.ilike.%${normalized}%`
          ].join(",")
        )
        .limit(8),
      supabase
        .from("leads")
        .select("id,property_id,first_name,last_name,phone,email,address")
        .eq("organization_id", context.organizationId)
        .or(
          [
            `first_name.ilike.%${trimmed}%`,
            `last_name.ilike.%${trimmed}%`,
            `phone.ilike.%${trimmed}%`,
            `email.ilike.%${trimmed}%`,
            `address.ilike.%${trimmed}%`
          ].join(",")
        )
        .limit(8)
    ]);

  if (propertyError) throw propertyError;
  if (leadError) throw leadError;

  const items: SearchResultItem[] = [
    ...(propertyRows ?? []).map((row) => ({
      id: `property:${row.id as string}`,
      kind: "property" as const,
      title:
        (row.raw_address as string | null) ??
        (row.address_line_1 as string | null) ??
        "Property",
      subtitle:
        [
          row.city as string | null,
          row.state as string | null,
          row.postal_code as string | null
        ]
          .filter(Boolean)
          .join(", ") || "Property",
      href: `/properties/${row.id as string}`,
      propertyId: row.id as string,
      leadId: null
    })),
    ...(leadRows ?? []).map((row) => {
      const contactName =
        [row.first_name as string | null, row.last_name as string | null].filter(Boolean).join(" ") || "Lead";
      const propertyId = row.property_id as string | null;

      return {
        id: `lead:${row.id as string}`,
        kind: "lead" as const,
        title: contactName,
        subtitle:
          (row.address as string | null) ??
          (row.phone as string | null) ??
          (row.email as string | null) ??
          "Lead",
        href: propertyId ? `/properties/${propertyId}` : "/queue",
        propertyId,
        leadId: row.id as string
      };
    })
  ];

  const deduped = new Map<string, SearchResultItem>();
  for (const item of items) {
    const key = item.kind === "property" ? `property:${item.propertyId}` : `lead:${item.leadId}`;
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  return { items: Array.from(deduped.values()).slice(0, 12) };
}
