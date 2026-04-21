import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";
import type { CreateRouteRunResponse } from "@/types/api";

function haversineMiles(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
) {
  const radiusMiles = 3958.8;
  const toRadians = Math.PI / 180;
  const deltaLat = (destination.lat - origin.lat) * toRadians;
  const deltaLng = (destination.lng - origin.lng) * toRadians;
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(origin.lat * toRadians) *
      Math.cos(destination.lat * toRadians) *
      Math.sin(deltaLng / 2) ** 2;
  return 2 * radiusMiles * Math.asin(Math.sqrt(a));
}

function optimizeStops<T extends { lat: number; lng: number }>(
  origin: { lat: number; lng: number },
  stops: T[]
) {
  const remaining = [...stops];
  const ordered: T[] = [];
  let current = origin;

  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const stop = remaining[index];
      const distance = haversineMiles(current, stop);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
    current = next;
  }

  return ordered;
}

async function getOwnedActiveRouteRun(input: {
  routeRunId: string;
  context: AuthSessionContext;
}) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("route_runs")
    .select("id,organization_id,rep_id,status,optimization_mode")
    .eq("id", input.routeRunId)
    .eq("organization_id", input.context.organizationId)
    .eq("rep_id", input.context.appUser.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error("This route is not available to the current user.");
  }

  return data as {
    id: string;
    organization_id: string;
    rep_id: string;
    status: "active" | "paused" | "completed" | "cancelled";
    optimization_mode: "drive_time" | "mileage";
  };
}

export async function createRouteRun(
  input: {
    leadIds: string[];
    startedFromLat: number;
    startedFromLng: number;
    startedFromLabel?: string | null;
    optimizationMode?: "drive_time" | "mileage";
  },
  context: AuthSessionContext
): Promise<CreateRouteRunResponse> {
  if (!context.organizationId) {
    throw new Error("No active organization found for this user.");
  }

  const uniqueLeadIds = [...new Set(input.leadIds)].filter(Boolean);
  if (!uniqueLeadIds.length) {
    throw new Error("Pick at least one lead to build a route.");
  }
  if (uniqueLeadIds.length > 25) {
    throw new Error("For now, route runs are limited to 25 selected leads.");
  }

  const supabase = createServerSupabaseClient();
  const isManager = context.memberships.some((membership) =>
    ["owner", "admin", "manager"].includes(membership.role)
  );

  let leadsQuery = supabase
    .from("leads")
    .select("id,property_id,first_name,last_name,phone,email,lead_status,appointment_at,owner_id,assigned_to")
    .eq("organization_id", context.organizationId)
    .in("id", uniqueLeadIds);

  if (!isManager) {
    leadsQuery = leadsQuery.or(
      `owner_id.eq.${context.appUser.id},assigned_to.eq.${context.appUser.id}`
    );
  }

  const { data: leadRows, error: leadError } = await leadsQuery;
  if (leadError) throw leadError;

  const leads = (leadRows ?? []) as Array<Record<string, unknown>>;
  if (!leads.length) {
    throw new Error("None of the selected leads are available for route planning.");
  }

  const propertyIds = leads
    .map((lead) => lead.property_id as string | null)
    .filter(Boolean) as string[];

  const { data: propertyRows, error: propertyError } = propertyIds.length
    ? await supabase
        .from("properties")
        .select("id,raw_address,address_line_1,city,state,postal_code,lat,lng")
        .in("id", propertyIds)
    : { data: [], error: null };
  if (propertyError) throw propertyError;

  const propertyMap = new Map(
    ((propertyRows ?? []) as Array<Record<string, unknown>>).map((row) => [row.id as string, row])
  );

  const selectedStops = leads
    .map((lead) => {
      const propertyId = lead.property_id as string | null;
      if (!propertyId) return null;
      const property = propertyMap.get(propertyId);
      if (!property) return null;
      const lat = Number(property.lat ?? NaN);
      const lng = Number(property.lng ?? NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      const addressParts = [
        (property.raw_address as string | null | undefined) ??
          (property.address_line_1 as string | null | undefined) ??
          null,
        property.city as string | null | undefined,
        property.state as string | null | undefined,
        property.postal_code as string | null | undefined
      ].filter(Boolean);

      return {
        leadId: lead.id as string,
        propertyId,
        address: addressParts.join(", "),
        lat,
        lng,
        homeownerName:
          [lead.first_name as string | null | undefined, lead.last_name as string | null | undefined]
            .filter(Boolean)
            .join(" ")
            .trim() || null,
        phone: (lead.phone as string | null | undefined) ?? null,
        email: (lead.email as string | null | undefined) ?? null
      };
    })
    .filter(
      (stop): stop is NonNullable<typeof stop> =>
        Boolean(stop?.leadId && stop.address && Number.isFinite(stop.lat) && Number.isFinite(stop.lng))
    );

  if (!selectedStops.length) {
    throw new Error("The selected leads do not have enough mapped property data to build a route.");
  }

  const activeRunIdsResult = await supabase
    .from("route_runs")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("rep_id", context.appUser.id)
    .in("status", ["active", "paused"]);

  if (activeRunIdsResult.error) throw activeRunIdsResult.error;

  const activeRunIds = ((activeRunIdsResult.data ?? []) as Array<Record<string, unknown>>).map(
    (row) => row.id as string
  );

  if (activeRunIds.length) {
    const { error: cancelRunsError } = await supabase
      .from("route_runs")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .in("id", activeRunIds);
    if (cancelRunsError) throw cancelRunsError;
  }

  const orderedStops = optimizeStops(
    {
      lat: input.startedFromLat,
      lng: input.startedFromLng
    },
    selectedStops
  );

  const { data: createdRun, error: createRunError } = await supabase
    .from("route_runs")
    .insert({
      organization_id: context.organizationId,
      rep_id: context.appUser.id,
      status: "active",
      optimization_mode: input.optimizationMode ?? "drive_time",
      started_from_lat: input.startedFromLat,
      started_from_lng: input.startedFromLng,
      started_from_label: input.startedFromLabel ?? "Current Location"
    })
    .select("id")
    .single();
  if (createRunError) throw createRunError;

  const routeRunId = createdRun.id as string;

  const { error: createStopsError } = await supabase.from("route_run_stops").insert(
    orderedStops.map((stop, index) => ({
      route_run_id: routeRunId,
      lead_id: stop.leadId,
      address: stop.address,
      lat: stop.lat,
      lng: stop.lng,
      sequence_number: index + 1,
      homeowner_name: stop.homeownerName,
      phone: stop.phone,
      email: stop.email
    }))
  );
  if (createStopsError) throw createStopsError;

  const { error: runStartedEventError } = await supabase.from("route_run_events").insert({
    route_run_id: routeRunId,
    event_type: "run_started",
    created_by: context.appUser.id,
    event_payload: {
      stopCount: orderedStops.length,
      startedFromLat: input.startedFromLat,
      startedFromLng: input.startedFromLng,
      startedFromLabel: input.startedFromLabel ?? "Current Location",
      optimizationMode: input.optimizationMode ?? "drive_time"
    }
  });
  if (runStartedEventError) throw runStartedEventError;

  return {
    routeRunId,
    totalStops: orderedStops.length,
    firstPropertyId: orderedStops[0]?.propertyId ?? null
  };
}

async function assertRouteRunAccess(input: {
  routeRunId: string;
  routeRunStopId: string;
  context: AuthSessionContext;
}) {
  await getOwnedActiveRouteRun({
    routeRunId: input.routeRunId,
    context: input.context
  });

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("route_run_stops")
    .select("id,route_run_id")
    .eq("id", input.routeRunStopId)
    .eq("route_run_id", input.routeRunId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error("This route stop is not available to the current user.");
  }
}

export async function optimizeRemainingRouteRunStops(input: {
  routeRunId: string;
  originLat: number;
  originLng: number;
  optimizationMode?: "drive_time" | "mileage";
  context: AuthSessionContext;
}) {
  const supabase = createServerSupabaseClient();
  const routeRun = await getOwnedActiveRouteRun({
    routeRunId: input.routeRunId,
    context: input.context
  });

  if (routeRun.status !== "active") {
    throw new Error("Only active routes can be re-optimized.");
  }

  const { data: pendingStops, error: pendingStopsError } = await supabase
    .from("route_run_stops")
    .select("id,lat,lng,sequence_number")
    .eq("route_run_id", input.routeRunId)
    .eq("stop_status", "pending")
    .order("sequence_number", { ascending: true });
  if (pendingStopsError) throw pendingStopsError;

  const pendingStopItems = ((pendingStops ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      routeRunStopId: row.id as string,
      lat: Number(row.lat ?? NaN),
      lng: Number(row.lng ?? NaN),
      sequenceNumber: Number(row.sequence_number ?? 0)
    }))
    .filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lng));

  if (pendingStopItems.length <= 1) {
    return {
      routeRunId: input.routeRunId,
      updatedStops: pendingStopItems.length
    };
  }

  const reorderedStops = optimizeStops(
    {
      lat: input.originLat,
      lng: input.originLng
    },
    pendingStopItems
  );

  const startingSequence = Math.min(...reorderedStops.map((stop) => stop.sequenceNumber));
  for (let index = 0; index < reorderedStops.length; index += 1) {
    const stop = reorderedStops[index];
    const { error: updateStopError } = await supabase
      .from("route_run_stops")
      .update({
        sequence_number: startingSequence + index,
        updated_at: new Date().toISOString()
      })
      .eq("id", stop.routeRunStopId)
      .eq("route_run_id", input.routeRunId);
    if (updateStopError) throw updateStopError;
  }

  const { error: updateRunError } = await supabase
    .from("route_runs")
    .update({
      optimization_mode: input.optimizationMode ?? routeRun.optimization_mode,
      updated_at: new Date().toISOString()
    })
    .eq("id", input.routeRunId);
  if (updateRunError) throw updateRunError;

  const { error: routeEventError } = await supabase.from("route_run_events").insert({
    route_run_id: input.routeRunId,
    event_type: "route_reoptimized",
    created_by: input.context.appUser.id,
    event_payload: {
      pendingStopCount: reorderedStops.length,
      originLat: input.originLat,
      originLng: input.originLng,
      optimizationMode: input.optimizationMode ?? routeRun.optimization_mode
    }
  });
  if (routeEventError) throw routeEventError;

  return {
    routeRunId: input.routeRunId,
    updatedStops: reorderedStops.length
  };
}

async function finalizeRouteIfDone(routeRunId: string) {
  const supabase = createServerSupabaseClient();
  const { data: pendingStops, error: pendingStopsError } = await supabase
    .from("route_run_stops")
    .select("id")
    .eq("route_run_id", routeRunId)
    .eq("stop_status", "pending")
    .limit(1);
  if (pendingStopsError) throw pendingStopsError;
  if ((pendingStops ?? []).length) return;

  const completionTimestamp = new Date().toISOString();
  const { error: completeRunError } = await supabase
    .from("route_runs")
    .update({
      status: "completed",
      completed_at: completionTimestamp,
      updated_at: completionTimestamp
    })
    .eq("id", routeRunId)
    .eq("status", "active");
  if (completeRunError) throw completeRunError;

  const { error: runCompletedEventError } = await supabase.from("route_run_events").insert({
    route_run_id: routeRunId,
    event_type: "run_completed",
    event_payload: {
      completedAt: completionTimestamp
    }
  });
  if (runCompletedEventError) throw runCompletedEventError;
}

export async function completeRouteRunStop(input: {
  routeRunId: string;
  routeRunStopId: string;
  disposition?: string | null;
  notes?: string | null;
  context: AuthSessionContext;
}) {
  const supabase = createServerSupabaseClient();
  await assertRouteRunAccess(input);

  const timestamp = new Date().toISOString();
  const { error: updateStopError } = await supabase
    .from("route_run_stops")
    .update({
      stop_status: "completed",
      completed_at: timestamp,
      disposition: input.disposition ?? null,
      notes: input.notes ?? null,
      updated_at: timestamp
    })
    .eq("id", input.routeRunStopId)
    .eq("route_run_id", input.routeRunId)
    .eq("stop_status", "pending");
  if (updateStopError) throw updateStopError;

  const { error: eventError } = await supabase.from("route_run_events").insert({
    route_run_id: input.routeRunId,
    route_run_stop_id: input.routeRunStopId,
    event_type: "stop_completed",
    created_by: input.context.appUser.id,
    event_payload: {
      disposition: input.disposition ?? null
    }
  });
  if (eventError) throw eventError;

  await finalizeRouteIfDone(input.routeRunId);
}

export async function skipRouteRunStop(input: {
  routeRunId: string;
  routeRunStopId: string;
  skippedReason?: string | null;
  context: AuthSessionContext;
}) {
  const supabase = createServerSupabaseClient();
  await assertRouteRunAccess(input);
  const timestamp = new Date().toISOString();

  const { error: updateStopError } = await supabase
    .from("route_run_stops")
    .update({
      stop_status: "skipped",
      skipped_reason: input.skippedReason ?? "Skipped from map",
      updated_at: timestamp
    })
    .eq("id", input.routeRunStopId)
    .eq("route_run_id", input.routeRunId)
    .eq("stop_status", "pending");
  if (updateStopError) throw updateStopError;

  const { error: eventError } = await supabase.from("route_run_events").insert({
    route_run_id: input.routeRunId,
    route_run_stop_id: input.routeRunStopId,
    event_type: "stop_skipped",
    created_by: input.context.appUser.id,
    event_payload: {
      skippedReason: input.skippedReason ?? "Skipped from map"
    }
  });
  if (eventError) throw eventError;

  await finalizeRouteIfDone(input.routeRunId);
}
