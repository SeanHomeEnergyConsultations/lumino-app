import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";
import type { LeadInput } from "@/types/entities";

function combineName(firstName?: string | null, lastName?: string | null) {
  return [firstName?.trim(), lastName?.trim()].filter(Boolean).join(" ") || null;
}

export async function upsertLead(input: LeadInput, context: AuthSessionContext) {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) {
    throw new Error("No active organization found for this user.");
  }

  const { data: propertyRow, error: propertyError } = await supabase
    .from("property_history_view")
    .select("property_id,lead_id,normalized_address,raw_address,address_line_1,city,state,postal_code,lat,lng")
    .eq("property_id", input.propertyId)
    .maybeSingle();

  if (propertyError) throw propertyError;
  if (!propertyRow) {
    throw new Error("Property not found.");
  }

  const firstName = input.firstName?.trim() || null;
  const lastName = input.lastName?.trim() || null;
  const payload = {
    property_id: input.propertyId,
    owner_id: context.appUser.id,
    assigned_to: context.appUser.id,
    owner_name: combineName(firstName, lastName),
    first_name: firstName,
    last_name: lastName,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    notes: input.notes?.trim() || null,
    lead_status: input.leadStatus ?? "New",
    interest_level: input.interestLevel ?? null,
    next_follow_up_at: input.nextFollowUpAt ?? null,
    appointment_at: input.appointmentAt ?? null,
    last_activity_at: new Date().toISOString(),
    last_activity_type: "lead_capture",
    last_activity_outcome: input.leadStatus ?? "New",
    updated_at: new Date().toISOString()
  };

  let leadId = propertyRow.lead_id as string | null;

  if (leadId) {
    const { error: updateError } = await supabase.from("leads").update(payload).eq("id", leadId);
    if (updateError) throw updateError;
  } else {
    const insertPayload = {
      organization_id: context.organizationId,
      created_by: context.appUser.id,
      normalized_address: propertyRow.normalized_address,
      address: propertyRow.raw_address || propertyRow.address_line_1 || propertyRow.normalized_address,
      city: propertyRow.city,
      state: propertyRow.state,
      zipcode: propertyRow.postal_code,
      lat: propertyRow.lat,
      lng: propertyRow.lng,
      status: "open",
      assignment_status: "assigned",
      analysis_status: "pending",
      source: "field_canvassing",
      follow_up_flags: [],
      ...payload
    };

    const { data: insertedRow, error: insertError } = await supabase
      .from("leads")
      .insert(insertPayload)
      .select("id")
      .single();

    if (insertError) throw insertError;
    leadId = insertedRow.id;
  }

  const propertyUpdates: Record<string, unknown> = {
    current_lead_id: leadId,
    next_follow_up_at: input.nextFollowUpAt ?? null,
    updated_at: new Date().toISOString()
  };

  const { error: propertyUpdateError } = await supabase
    .from("properties")
    .update(propertyUpdates)
    .eq("id", input.propertyId);

  if (propertyUpdateError) throw propertyUpdateError;

  const activityData = {
    lead_id: leadId,
    lead_status: input.leadStatus ?? "New",
    first_name: firstName,
    last_name: lastName,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    interest_level: input.interestLevel ?? null,
    next_follow_up_at: input.nextFollowUpAt ?? null,
    appointment_at: input.appointmentAt ?? null
  };

  const { error: propertyActivityError } = await supabase.from("activities").insert({
    organization_id: context.organizationId,
    entity_type: "property",
    entity_id: input.propertyId,
    actor_user_id: context.appUser.id,
    type: propertyRow.lead_id ? "lead_updated" : "lead_created",
    data: activityData
  });

  if (propertyActivityError) throw propertyActivityError;

  const { error: leadActivityError } = await supabase.from("activities").insert({
    organization_id: context.organizationId,
    entity_type: "lead",
    entity_id: leadId,
    actor_user_id: context.appUser.id,
    type: propertyRow.lead_id ? "lead_updated" : "lead_created",
    data: activityData
  });

  if (leadActivityError) throw leadActivityError;

  return {
    leadId,
    propertyId: input.propertyId
  };
}
