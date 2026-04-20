import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";

async function ensureTerritoryInOrganization(
  territoryId: string,
  organizationId: string
) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("territories")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", territoryId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Territory not found.");
}

async function ensurePropertyExists(propertyId: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Property not found.");
}

export async function createTerritory(
  input: { name: string; status: "active" | "archived" },
  context: AuthSessionContext
) {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) throw new Error("No active organization found for this user.");

  const { data, error } = await supabase
    .from("territories")
    .insert({
      organization_id: context.organizationId,
      name: input.name,
      status: input.status
    })
    .select("id")
    .single();

  if (error) throw error;
  return { territoryId: data.id as string };
}

export async function updateTerritory(
  territoryId: string,
  input: { name: string; status: "active" | "archived" },
  context: AuthSessionContext
) {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) throw new Error("No active organization found for this user.");
  await ensureTerritoryInOrganization(territoryId, context.organizationId);

  const { error } = await supabase
    .from("territories")
    .update({
      name: input.name,
      status: input.status,
      updated_at: new Date().toISOString()
    })
    .eq("organization_id", context.organizationId)
    .eq("id", territoryId);

  if (error) throw error;
  return { territoryId };
}

export async function assignPropertyToTerritory(
  territoryId: string,
  propertyId: string,
  context: AuthSessionContext
) {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) throw new Error("No active organization found for this user.");
  await ensureTerritoryInOrganization(territoryId, context.organizationId);
  await ensurePropertyExists(propertyId);

  const { error } = await supabase
    .from("property_territories")
    .upsert({
      organization_id: context.organizationId,
      territory_id: territoryId,
      property_id: propertyId
    });

  if (error) throw error;
}

export async function removePropertyFromTerritory(
  territoryId: string,
  propertyId: string,
  context: AuthSessionContext
) {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) throw new Error("No active organization found for this user.");
  await ensureTerritoryInOrganization(territoryId, context.organizationId);

  const { error } = await supabase
    .from("property_territories")
    .delete()
    .eq("organization_id", context.organizationId)
    .eq("territory_id", territoryId)
    .eq("property_id", propertyId);

  if (error) throw error;
}
