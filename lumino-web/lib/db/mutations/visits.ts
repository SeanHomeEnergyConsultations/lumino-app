import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { completeRouteRunStop } from "@/lib/db/mutations/routes";
import { ensureOutcomeTask } from "@/lib/db/mutations/tasks";
import type { AuthSessionContext } from "@/types/auth";
import type { VisitInput } from "@/types/entities";

export async function createVisit(input: VisitInput, context: AuthSessionContext) {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) {
    throw new Error("No active organization found for this user.");
  }

  console.info("[api/visits] rpc:start", {
    organizationId: context.organizationId,
    propertyId: input.propertyId,
    userId: context.appUser.id,
    outcome: input.outcome
  });

  const { data, error } = await supabase.rpc("log_property_visit", {
    p_organization_id: context.organizationId,
    p_property_id: input.propertyId,
    p_user_id: context.appUser.id,
    p_outcome: input.outcome,
    p_notes: input.notes ?? null,
    p_interest_level: input.interestLevel ?? null,
    p_lat: input.lat ?? null,
    p_lng: input.lng ?? null,
    p_captured_at: input.capturedAt ?? null,
    p_route_run_id: input.routeRunId ?? null,
    p_follow_up_at: null
  });

  if (error) {
    console.error("[api/visits] rpc:error", error);
    throw error;
  }

  const { data: propertyLead, error: propertyLeadError } = await supabase
    .from("property_history_view")
    .select("lead_id")
    .eq("property_id", input.propertyId)
    .maybeSingle();

  if (propertyLeadError) {
    console.error("[api/visits] property:error", propertyLeadError);
    throw propertyLeadError;
  }

  const leadId = (propertyLead?.lead_id as string | null | undefined) ?? null;
  const baseDue = new Date();

  if (input.outcome === "not_home") {
    baseDue.setDate(baseDue.getDate() + 1);
    await ensureOutcomeTask({
      context,
      propertyId: input.propertyId,
      leadId,
      type: "revisit",
      dueAt: baseDue.toISOString(),
      notes: "Auto-created from Not Home outcome."
    });
  }

  if (input.outcome === "left_doorhanger") {
    baseDue.setDate(baseDue.getDate() + 2);
    await ensureOutcomeTask({
      context,
      propertyId: input.propertyId,
      leadId,
      type: "revisit",
      dueAt: baseDue.toISOString(),
      notes: "Auto-created from Left Doorhanger outcome."
    });
  }

  if (input.outcome === "opportunity") {
    baseDue.setHours(baseDue.getHours() + 4);
    await ensureOutcomeTask({
      context,
      propertyId: input.propertyId,
      leadId,
      type: "call",
      dueAt: baseDue.toISOString(),
      notes: "Auto-created from Opportunity outcome."
    });
  }

  if (input.outcome === "appointment_set") {
    baseDue.setHours(baseDue.getHours() + 12);
    await ensureOutcomeTask({
      context,
      propertyId: input.propertyId,
      leadId,
      type: "appointment_confirm",
      dueAt: baseDue.toISOString(),
      notes: "Auto-created from Appointment outcome."
    });
  }

  if (input.routeRunId && input.routeRunStopId) {
    await completeRouteRunStop({
      routeRunId: input.routeRunId,
      routeRunStopId: input.routeRunStopId,
      disposition: input.outcome,
      notes: input.notes ?? null,
      context
    });
  }

  console.info("[api/visits] rpc:success", {
    visitId: data,
    propertyId: input.propertyId
  });

  return {
    visitId: data as string,
    propertyId: input.propertyId
  };
}
