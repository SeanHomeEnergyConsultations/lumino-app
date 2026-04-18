import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { MapPropertiesResponse } from "@/types/api";

export interface MapViewportFilters {
  minLat?: number;
  maxLat?: number;
  minLng?: number;
  maxLng?: number;
  limit?: number;
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

  const { data, error } = await query;
  if (error) throw error;

  return {
    items: (data ?? []).map((row) => ({
      propertyId: row.property_id,
      address: row.raw_address,
      city: row.city,
      state: row.state,
      postalCode: row.postal_code,
      lat: row.lat,
      lng: row.lng,
      mapState: row.map_state,
      followUpState: row.follow_up_state,
      visitCount: row.visit_count ?? 0,
      lastVisitOutcome: row.last_visit_outcome,
      leadId: row.lead_id,
      leadStatus: row.lead_status,
      appointmentAt: row.appointment_at
    }))
  };
}
