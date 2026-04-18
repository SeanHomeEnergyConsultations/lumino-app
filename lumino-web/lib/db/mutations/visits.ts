import { createServerSupabaseClient } from "@/lib/db/supabase-server";
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
    p_route_run_id: null,
    p_follow_up_at: null
  });

  if (error) {
    console.error("[api/visits] rpc:error", error);
    throw error;
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
