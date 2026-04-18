import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";
import type { RepQueueItem, RepQueueResponse } from "@/types/api";

function classifyQueueItem(item: Omit<RepQueueItem, "priority">): RepQueueItem["priority"] | null {
  const now = Date.now();
  const appointmentTime = item.appointmentAt ? new Date(item.appointmentAt).getTime() : null;
  const followUpTime = item.nextFollowUpAt ? new Date(item.nextFollowUpAt).getTime() : null;
  const isOpportunity =
    item.lastVisitOutcome === "opportunity" || item.leadStatus === "Connected" || item.leadStatus === "Qualified";

  if (appointmentTime && appointmentTime >= now - 86_400_000) return "appointment";
  if (followUpTime && followUpTime < now) return "due_now";
  if (item.lastVisitOutcome === "not_home" || item.lastVisitOutcome === "left_doorhanger") return "revisit";
  if (isOpportunity && !item.nextFollowUpAt && !item.appointmentAt) return "needs_attention";
  if (isOpportunity) {
    return "opportunity";
  }
  return null;
}

function getTimestamp(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  return new Date(value).getTime();
}

function sortQueueItems(items: RepQueueItem[], priority: RepQueueItem["priority"]) {
  return [...items].sort((a, b) => {
    if (priority === "due_now") {
      return getTimestamp(a.nextFollowUpAt) - getTimestamp(b.nextFollowUpAt);
    }

    if (priority === "appointment") {
      return getTimestamp(a.appointmentAt) - getTimestamp(b.appointmentAt);
    }

    if (priority === "revisit") {
      if (b.notHomeCount !== a.notHomeCount) return b.notHomeCount - a.notHomeCount;
      return getTimestamp(a.lastVisitedAt) - getTimestamp(b.lastVisitedAt);
    }

    if (priority === "needs_attention") {
      return getTimestamp(a.lastVisitedAt) - getTimestamp(b.lastVisitedAt);
    }

    return getTimestamp(a.lastVisitedAt) - getTimestamp(b.lastVisitedAt);
  });
}

export async function getRepQueue(context: AuthSessionContext): Promise<RepQueueResponse> {
  const supabase = createServerSupabaseClient();
  const ownerId = context.appUser.id;

  const { data: leadRows, error: leadsError } = await supabase
    .from("leads")
    .select("id,property_id,lead_status,next_follow_up_at,appointment_at")
    .or(`owner_id.eq.${ownerId},assigned_to.eq.${ownerId}`)
    .eq("status", "open")
    .limit(250);

  if (leadsError) throw leadsError;

  const leads = leadRows ?? [];
  const propertyIds = leads.map((lead) => lead.property_id).filter(Boolean);

  let historyByProperty = new Map<string, Record<string, unknown>>();
  let notHomeCounts = new Map<string, number>();

  if (propertyIds.length) {
    const [{ data: historyRows, error: historyError }, { data: visitRows, error: visitError }] = await Promise.all([
      supabase
        .from("property_history_view")
        .select("property_id,raw_address,city,state,postal_code,last_visit_outcome,last_visited_at,visit_count")
        .in("property_id", propertyIds),
      supabase.from("visits").select("property_id").eq("outcome", "not_home").in("property_id", propertyIds)
    ]);

    if (historyError) throw historyError;
    if (visitError) throw visitError;

    historyByProperty = new Map((historyRows ?? []).map((row) => [row.property_id as string, row]));
    notHomeCounts = new Map<string, number>();
    for (const visit of visitRows ?? []) {
      const propertyId = visit.property_id as string;
      notHomeCounts.set(propertyId, (notHomeCounts.get(propertyId) ?? 0) + 1);
    }
  }

  const items: RepQueueItem[] = leads
    .map((lead) => {
      const history = historyByProperty.get(lead.property_id as string);
      if (!history) return null;

      const baseItem = {
        leadId: lead.id as string,
        propertyId: lead.property_id as string,
        address: (history.raw_address as string) || "Unknown address",
        city: (history.city as string | null) ?? null,
        state: (history.state as string | null) ?? null,
        postalCode: (history.postal_code as string | null) ?? null,
        leadStatus: (lead.lead_status as string | null) ?? null,
        lastVisitOutcome: (history.last_visit_outcome as string | null) ?? null,
        lastVisitedAt: (history.last_visited_at as string | null) ?? null,
        nextFollowUpAt: (lead.next_follow_up_at as string | null) ?? null,
        appointmentAt: (lead.appointment_at as string | null) ?? null,
        visitCount: Number(history.visit_count ?? 0),
        notHomeCount: notHomeCounts.get(lead.property_id as string) ?? 0
      };

      const priority = classifyQueueItem(baseItem);
      if (!priority) return null;

      return {
        ...baseItem,
        priority
      };
    })
    .filter((item): item is RepQueueItem => Boolean(item));

  const response: RepQueueResponse = {
    summary: {
      dueNow: items.filter((item) => item.priority === "due_now").length,
      revisits: items.filter((item) => item.priority === "revisit").length,
      appointments: items.filter((item) => item.priority === "appointment").length,
      opportunities: items.filter((item) => item.priority === "opportunity").length,
      needsAttention: items.filter((item) => item.priority === "needs_attention").length
    },
    dueNow: sortQueueItems(
      items.filter((item) => item.priority === "due_now"),
      "due_now"
    ),
    revisits: sortQueueItems(
      items.filter((item) => item.priority === "revisit"),
      "revisit"
    ),
    appointments: sortQueueItems(
      items.filter((item) => item.priority === "appointment"),
      "appointment"
    ),
    opportunities: sortQueueItems(
      items.filter((item) => item.priority === "opportunity"),
      "opportunity"
    ),
    needsAttention: sortQueueItems(
      items.filter((item) => item.priority === "needs_attention"),
      "needs_attention"
    )
  };

  return response;
}
