import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { computeOperationalPropertyPriority } from "@/lib/properties/priority";
import type { MapPropertiesResponse } from "@/types/api";
import type { MapProperty } from "@/types/entities";

export interface MapViewportFilters {
  minLat?: number;
  maxLat?: number;
  minLng?: number;
  maxLng?: number;
  limit?: number;
  ownerId?: string;
  city?: string;
  state?: string;
}

function deriveMapState(row: Record<string, unknown>): MapProperty["mapState"] {
  const visitCount = Number(row.visit_count ?? 0);
  const lastVisitOutcome = row.last_visit_outcome as string | null;
  const leadId = row.lead_id as string | null;
  const leadStatus = row.lead_status as string | null;
  const appointmentAt = row.appointment_at as string | null;
  const followUpState = row.follow_up_state as string | null;

  if (leadStatus === "Closed Won") return "customer";
  if (appointmentAt || lastVisitOutcome === "appointment_set") return "appointment_set";
  if (followUpState === "overdue") return "follow_up_overdue";
  if (lastVisitOutcome === "opportunity") return "opportunity";
  if (lastVisitOutcome === "left_doorhanger") return "left_doorhanger";
  if (lastVisitOutcome === "not_home") return "not_home";
  if (lastVisitOutcome === "interested") return "interested";
  if (lastVisitOutcome === "callback_requested") return "callback_requested";
  if (lastVisitOutcome === "not_interested") return "not_interested";
  if (lastVisitOutcome === "disqualified") return "disqualified";
  if (lastVisitOutcome === "do_not_knock") return "do_not_knock";
  if (visitCount > 0 && leadId) return "canvassed_with_lead";
  if (visitCount > 0) return "canvassed";
  if (leadId) return "imported_target";
  return "unworked_property";
}

export async function getMapPropertiesForViewport(
  filters: MapViewportFilters = {}
): Promise<MapPropertiesResponse> {
  const supabase = createServerSupabaseClient();
  const limit = filters.limit ?? 250;

  let query = supabase
    .from("map_properties_view")
    .select(
      "property_id,raw_address,city,state,postal_code,lat,lng,map_state,follow_up_state,visit_count,last_visit_outcome,last_visited_at,lead_id,lead_status,appointment_at,first_name,last_name,phone,email"
    )
    .limit(limit);

  if (filters.minLat !== undefined) query = query.gte("lat", filters.minLat);
  if (filters.maxLat !== undefined) query = query.lte("lat", filters.maxLat);
  if (filters.minLng !== undefined) query = query.gte("lng", filters.minLng);
  if (filters.maxLng !== undefined) query = query.lte("lng", filters.maxLng);
  if (filters.ownerId) query = query.eq("owner_id", filters.ownerId);
  if (filters.city) query = query.ilike("city", filters.city);
  if (filters.state) query = query.ilike("state", filters.state);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  const propertyIds = rows.map((row) => row.property_id).filter(Boolean);
  let notHomeCounts = new Map<string, number>();
  let propertyFacts = new Map<string, Record<string, unknown>>();

  if (propertyIds.length) {
    const [{ data: visitRows, error: visitsError }, { data: propertyRows, error: propertyError }] = await Promise.all([
      supabase
        .from("visits")
        .select("property_id")
        .eq("outcome", "not_home")
        .in("property_id", propertyIds),
      supabase
        .from("properties")
        .select(
          "id,data_completeness_score,solar_fit_score,property_priority_score,property_priority_label"
        )
        .in("id", propertyIds)
    ]);

    if (visitsError) throw visitsError;
    if (propertyError) throw propertyError;

    notHomeCounts = new Map<string, number>();
    for (const visit of visitRows ?? []) {
      const propertyId = visit.property_id as string;
      notHomeCounts.set(propertyId, (notHomeCounts.get(propertyId) ?? 0) + 1);
    }

    propertyFacts = new Map((propertyRows ?? []).map((row) => [row.id as string, row as Record<string, unknown>]));
  }

  return {
    items: rows
      .map((row) => {
        const facts = propertyFacts.get(row.property_id as string);
        const priority = computeOperationalPropertyPriority({
          basePriorityScore: Number(facts?.property_priority_score ?? 0),
          solarFitScore: Number(facts?.solar_fit_score ?? 0),
          dataCompletenessScore: Number(facts?.data_completeness_score ?? 0),
          sourceRecordCount: row.lead_id ? 1 : 0,
          hasFirstName: Boolean(row.first_name),
          hasLastName: Boolean(row.last_name),
          hasPhone: Boolean(row.phone),
          hasEmail: Boolean(row.email),
          leadStatus: (row.lead_status as string | null) ?? null,
          followUpState: (row.follow_up_state as MapProperty["followUpState"]) ?? "none",
          appointmentAt: (row.appointment_at as string | null) ?? null,
          lastVisitOutcome: (row.last_visit_outcome as string | null) ?? null,
          lastVisitedAt: (row.last_visited_at as string | null) ?? null,
          notHomeCount: notHomeCounts.get(row.property_id as string) ?? 0
        });

        return {
          propertyId: row.property_id,
          address: row.raw_address,
          city: row.city,
          state: row.state,
          postalCode: row.postal_code,
          lat: row.lat,
          lng: row.lng,
          mapState: deriveMapState(row),
          followUpState: row.follow_up_state,
          visitCount: row.visit_count ?? 0,
          notHomeCount: notHomeCounts.get(row.property_id) ?? 0,
          lastVisitOutcome: row.last_visit_outcome,
          leadId: row.lead_id,
          leadStatus: row.lead_status,
          appointmentAt: row.appointment_at,
          priorityScore: priority.score,
          priorityBand: priority.band
        };
      })
      .sort((a, b) => b.priorityScore - a.priorityScore)
  };
}
