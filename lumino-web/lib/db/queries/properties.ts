import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { PropertyDetail } from "@/types/entities";

function deriveFollowUpState(nextFollowUpAt: string | null): PropertyDetail["followUpState"] {
  if (!nextFollowUpAt) return "none";
  const next = new Date(nextFollowUpAt);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const nextDay = new Date(next.getFullYear(), next.getMonth(), next.getDate()).getTime();
  if (next.getTime() < now.getTime()) return "overdue";
  if (today === nextDay) return "due_today";
  return "scheduled_future";
}

function deriveMapState(row: Record<string, unknown>): PropertyDetail["mapState"] {
  const visitCount = Number(row.visit_count ?? 0);
  const lastVisitOutcome = row.last_visit_outcome as string | null;
  const leadId = row.lead_id as string | null;
  const leadStatus = row.lead_status as string | null;
  const appointmentAt = row.appointment_at as string | null;
  const nextFollowUpAt = row.lead_next_follow_up_at as string | null;

  if (lastVisitOutcome === "do_not_knock") return "do_not_knock";
  if (leadStatus === "Closed Won") return "customer";
  if (appointmentAt) return "appointment_set";
  if (nextFollowUpAt && new Date(nextFollowUpAt).getTime() < Date.now()) return "follow_up_overdue";
  if (lastVisitOutcome === "appointment_set") return "appointment_set";
  if (lastVisitOutcome === "opportunity") return "opportunity";
  if (lastVisitOutcome === "left_doorhanger") return "left_doorhanger";
  if (lastVisitOutcome === "not_home") return "not_home";
  if (lastVisitOutcome === "interested") return "interested";
  if (lastVisitOutcome === "callback_requested") return "callback_requested";
  if (lastVisitOutcome === "not_interested") return "not_interested";
  if (lastVisitOutcome === "disqualified") return "disqualified";
  if (visitCount > 0 && leadId) return "canvassed_with_lead";
  if (visitCount > 0) return "canvassed";
  if (leadId) return "imported_target";
  return "unworked_property";
}

export async function getPropertyDetail(propertyId: string): Promise<PropertyDetail | null> {
  const supabase = createServerSupabaseClient();

  const { data: historyRow, error: historyError } = await supabase
    .from("property_history_view")
    .select("*")
    .eq("property_id", propertyId)
    .maybeSingle();

  if (historyError) throw historyError;
  if (!historyRow) return null;

  const [
    { data: visits, error: visitsError },
    { data: activities, error: activitiesError },
    { data: sourceRecords, error: sourceRecordsError }
  ] =
    await Promise.all([
      supabase
        .from("visits")
        .select("id,outcome,notes,captured_at,user_id")
        .eq("property_id", propertyId)
        .order("captured_at", { ascending: false })
        .limit(12),
      supabase
        .from("activities")
        .select("id,type,created_at,actor_user_id,data")
        .eq("entity_type", "property")
        .eq("entity_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(12),
      supabase
        .from("property_source_records")
        .select("id,source_type,source_name,source_batch_id,source_record_id,source_url,record_date,payload,created_at")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(12)
    ]);

  if (visitsError) throw visitsError;
  if (activitiesError) throw activitiesError;
  if (sourceRecordsError) throw sourceRecordsError;

  const notHomeCount = (visits ?? []).filter((visit) => visit.outcome === "not_home").length;

  return {
    propertyId: historyRow.property_id,
    address: historyRow.raw_address,
    city: historyRow.city,
    state: historyRow.state,
    postalCode: historyRow.postal_code,
    lat: historyRow.lat,
    lng: historyRow.lng,
    mapState: deriveMapState(historyRow),
    followUpState: deriveFollowUpState(historyRow.lead_next_follow_up_at),
    visitCount: historyRow.visit_count ?? 0,
    notHomeCount,
    lastVisitOutcome: historyRow.last_visit_outcome,
    lastVisitedAt: historyRow.last_visited_at,
    leadId: historyRow.lead_id,
    leadStatus: historyRow.lead_status,
    ownerId: historyRow.owner_id,
    firstName: historyRow.first_name,
    lastName: historyRow.last_name,
    phone: historyRow.phone,
    email: historyRow.email,
    leadNotes: historyRow.lead_notes,
    leadNextFollowUpAt: historyRow.lead_next_follow_up_at,
    appointmentAt: historyRow.appointment_at,
    recentVisits:
      visits?.map((visit) => ({
        id: visit.id,
        outcome: visit.outcome,
        notes: visit.notes,
        capturedAt: visit.captured_at,
        userId: visit.user_id
      })) ?? [],
    recentActivities:
      activities?.map((activity) => ({
        id: activity.id,
        type: activity.type,
        createdAt: activity.created_at,
        actorUserId: activity.actor_user_id,
        data: (activity.data as Record<string, unknown>) ?? {}
      })) ?? [],
    sourceRecords:
      sourceRecords?.map((record) => ({
        id: record.id,
        sourceType: record.source_type,
        sourceName: (record.source_name as string | null) ?? null,
        sourceBatchId: (record.source_batch_id as string | null) ?? null,
        sourceRecordId: (record.source_record_id as string | null) ?? null,
        sourceUrl: (record.source_url as string | null) ?? null,
        recordDate: (record.record_date as string | null) ?? null,
        createdAt: record.created_at,
        payload: (record.payload as Record<string, unknown>) ?? {}
      })) ?? []
  };
}
