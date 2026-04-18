import { createServerSupabaseClient } from "@/lib/db/supabase-server";
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
      "property_id,raw_address,city,state,postal_code,lat,lng,map_state,follow_up_state,visit_count,last_visit_outcome,lead_id,lead_status,appointment_at"
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

  if (propertyIds.length) {
    const { data: visitRows, error: visitsError } = await supabase
      .from("visits")
      .select("property_id")
      .eq("outcome", "not_home")
      .in("property_id", propertyIds);

    if (visitsError) throw visitsError;

    notHomeCounts = new Map<string, number>();
    for (const visit of visitRows ?? []) {
      const propertyId = visit.property_id as string;
      notHomeCounts.set(propertyId, (notHomeCounts.get(propertyId) ?? 0) + 1);
    }
  }

  return {
    items: rows.map((row) => ({
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
      appointmentAt: row.appointment_at
    }))
  };
}
