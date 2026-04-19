import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";

export async function updateAppointmentStatus(
  input: {
    leadId: string;
    status: "scheduled" | "confirmed" | "completed" | "no_show" | "cancelled" | "rescheduled";
    notes?: string | null;
  },
  context: AuthSessionContext
) {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) {
    throw new Error("No active organization found for this user.");
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id,property_id,appointment_at")
    .eq("organization_id", context.organizationId)
    .eq("id", input.leadId)
    .maybeSingle();

  if (leadError) throw leadError;
  if (!lead) throw new Error("Lead not found.");

  const scheduledAt = (lead.appointment_at as string | null) ?? new Date().toISOString();
  const notes = input.notes?.trim() || null;

  const { data: existing, error: existingError } = await supabase
    .from("appointments")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("lead_id", input.leadId)
    .maybeSingle();

  if (existingError) throw existingError;

  let appointmentId = existing?.id as string | undefined;

  if (appointmentId) {
    const { error } = await supabase
      .from("appointments")
      .update({
        status: input.status,
        notes,
        scheduled_at: scheduledAt,
        assigned_rep_id: context.appUser.id,
        updated_at: new Date().toISOString()
      })
      .eq("id", appointmentId);

    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from("appointments")
      .insert({
        organization_id: context.organizationId,
        lead_id: input.leadId,
        assigned_rep_id: context.appUser.id,
        scheduled_at: scheduledAt,
        status: input.status,
        notes
      })
      .select("id")
      .single();

    if (error) throw error;
    appointmentId = data.id as string;
  }

  await supabase.from("activities").insert({
    organization_id: context.organizationId,
    entity_type: "appointment",
    entity_id: appointmentId,
    actor_user_id: context.appUser.id,
    type: "appointment_status_updated",
    data: {
      lead_id: input.leadId,
      property_id: (lead.property_id as string | null) ?? null,
      status: input.status,
      notes
    }
  });

  return { appointmentId };
}
