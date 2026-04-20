import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { ActiveRouteRunResponse, RouteRunStopItem } from "@/types/api";
import type { AuthSessionContext } from "@/types/auth";

function buildNextStopDirectionsUrl(input: {
  originLat: number | null;
  originLng: number | null;
  destinationAddress: string;
}) {
  const params = new URLSearchParams({
    api: "1",
    destination: input.destinationAddress
  });

  if (input.originLat !== null && input.originLng !== null) {
    params.set("origin", `${input.originLat},${input.originLng}`);
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export async function getActiveRouteRun(
  context: AuthSessionContext
): Promise<ActiveRouteRunResponse | null> {
  if (!context.organizationId) return null;

  const supabase = createServerSupabaseClient();

  const { data: routeRun, error: routeRunError } = await supabase
    .from("route_runs")
    .select(
      "id,status,optimization_mode,started_at,started_from_lat,started_from_lng,started_from_label"
    )
    .eq("organization_id", context.organizationId)
    .eq("rep_id", context.appUser.id)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .maybeSingle();

  if (routeRunError) throw routeRunError;
  if (!routeRun) return null;

  const { data: stopRows, error: stopError } = await supabase
    .from("route_run_stops")
    .select(
      "id,lead_id,address,lat,lng,sequence_number,stop_status,disposition,skipped_reason,notes,homeowner_name,phone,email"
    )
    .eq("route_run_id", routeRun.id)
    .order("sequence_number", { ascending: true });
  if (stopError) throw stopError;

  const leadIds = ((stopRows ?? []) as Array<Record<string, unknown>>)
    .map((row) => row.lead_id as string | null)
    .filter(Boolean) as string[];

  const { data: leadRows, error: leadError } = leadIds.length
    ? await supabase
        .from("leads")
        .select("id,property_id,lead_status,appointment_at")
        .in("id", leadIds)
    : { data: [], error: null };
  if (leadError) throw leadError;

  const leadMap = new Map(
    ((leadRows ?? []) as Array<Record<string, unknown>>).map((row) => [row.id as string, row])
  );

  const stops: RouteRunStopItem[] = ((stopRows ?? []) as Array<Record<string, unknown>>).map((row) => {
    const lead = row.lead_id ? leadMap.get(row.lead_id as string) : null;
    return {
      routeRunStopId: row.id as string,
      leadId: (row.lead_id as string | null | undefined) ?? null,
      propertyId: (lead?.property_id as string | null | undefined) ?? null,
      address: row.address as string,
      lat: (row.lat as number | null | undefined) ?? null,
      lng: (row.lng as number | null | undefined) ?? null,
      sequenceNumber: Number(row.sequence_number ?? 0),
      stopStatus: row.stop_status as RouteRunStopItem["stopStatus"],
      disposition: (row.disposition as string | null | undefined) ?? null,
      skippedReason: (row.skipped_reason as string | null | undefined) ?? null,
      notes: (row.notes as string | null | undefined) ?? null,
      homeownerName: (row.homeowner_name as string | null | undefined) ?? null,
      phone: (row.phone as string | null | undefined) ?? null,
      email: (row.email as string | null | undefined) ?? null,
      leadStatus: (lead?.lead_status as string | null | undefined) ?? null,
      appointmentAt: (lead?.appointment_at as string | null | undefined) ?? null
    };
  });

  const nextStop =
    stops.find((stop) => stop.stopStatus === "pending") ??
    null;

  return {
    routeRunId: routeRun.id as string,
    status: routeRun.status as ActiveRouteRunResponse["status"],
    optimizationMode: routeRun.optimization_mode as ActiveRouteRunResponse["optimizationMode"],
    startedAt: routeRun.started_at as string,
    startedFromLat: (routeRun.started_from_lat as number | null | undefined) ?? null,
    startedFromLng: (routeRun.started_from_lng as number | null | undefined) ?? null,
    startedFromLabel: (routeRun.started_from_label as string | null | undefined) ?? null,
    totalStops: stops.length,
    completedStops: stops.filter((stop) => stop.stopStatus === "completed").length,
    pendingStops: stops.filter((stop) => stop.stopStatus === "pending").length,
    skippedStops: stops.filter((stop) => stop.stopStatus === "skipped").length,
    nextStop,
    stops,
    nextStopDirectionsUrl: nextStop
      ? buildNextStopDirectionsUrl({
          originLat: (routeRun.started_from_lat as number | null | undefined) ?? null,
          originLng: (routeRun.started_from_lng as number | null | undefined) ?? null,
          destinationAddress: nextStop.address
        })
      : null
  };
}
