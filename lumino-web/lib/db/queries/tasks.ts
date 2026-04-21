import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { TaskBoardItem, TasksResponse } from "@/types/api";
import type { AuthSessionContext } from "@/types/auth";

function startOfTomorrow() {
  const date = new Date();
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

function toTimestamp(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  return new Date(value).getTime();
}

function sortTaskItems(items: TaskBoardItem[]) {
  return [...items].sort((a, b) => toTimestamp(a.dueAt) - toTimestamp(b.dueAt));
}

export interface TaskCalendarItem {
  taskId: string;
  leadId: string | null;
  propertyId: string | null;
  type: string;
  status: string;
  dueAt: string | null;
  notes: string | null;
  address: string;
  city: string | null;
  state: string | null;
  leadStatus: string | null;
  ownerName: string | null;
}

export async function getTaskCalendarItem(
  context: AuthSessionContext,
  taskId: string
): Promise<TaskCalendarItem | null> {
  const supabase = createServerSupabaseClient();
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,lead_id,property_id,assigned_to,type,status,due_at,notes")
    .eq("id", taskId)
    .maybeSingle();

  if (taskError) throw taskError;
  if (!task) return null;

  const assignedTo = (task.assigned_to as string | null | undefined) ?? null;
  if (assignedTo && assignedTo !== context.appUser.id) {
    return null;
  }

  let property: Record<string, unknown> | null = null;
  if (task.property_id) {
    const { data: propertyRow, error: propertyError } = await supabase
      .from("property_history_view")
      .select("property_id,raw_address,city,state,lead_status,first_name,last_name")
      .eq("property_id", task.property_id as string)
      .maybeSingle();

    if (propertyError) throw propertyError;
    property = (propertyRow as Record<string, unknown> | null | undefined) ?? null;
  }

  const ownerName = property
    ? [property.first_name as string | null, property.last_name as string | null].filter(Boolean).join(" ") || null
    : null;

  return {
    taskId: task.id as string,
    leadId: (task.lead_id as string | null | undefined) ?? null,
    propertyId: (task.property_id as string | null | undefined) ?? null,
    type: (task.type as string | undefined) ?? "custom",
    status: (task.status as string | undefined) ?? "open",
    dueAt: (task.due_at as string | null | undefined) ?? null,
    notes: (task.notes as string | null | undefined) ?? null,
    address: (property?.raw_address as string | null | undefined) ?? "No linked property",
    city: (property?.city as string | null | undefined) ?? null,
    state: (property?.state as string | null | undefined) ?? null,
    leadStatus: (property?.lead_status as string | null | undefined) ?? null,
    ownerName
  };
}

export async function getTasksBoard(
  context: AuthSessionContext,
  requestedOwnerId?: string | null
): Promise<TasksResponse> {
  const supabase = createServerSupabaseClient();
  const isManager = context.memberships.some((membership) =>
    ["owner", "admin", "manager"].includes(membership.role)
  );
  const ownerId = requestedOwnerId && isManager ? requestedOwnerId : context.appUser.id;

  const [{ data: leads, error: leadsError }, { data: tasks, error: tasksError }] = await Promise.all([
    supabase
      .from("leads")
      .select("id,property_id,lead_status,next_follow_up_at,appointment_at,last_activity_at,address")
      .eq("status", "open")
      .or(`owner_id.eq.${ownerId},assigned_to.eq.${ownerId}`)
      .limit(250),
    supabase
      .from("tasks")
      .select("id,property_id,lead_id,type,status,due_at,notes")
      .eq("assigned_to", ownerId)
      .neq("status", "completed")
      .order("due_at", { ascending: true })
      .limit(150)
  ]);

  if (leadsError) throw leadsError;
  if (tasksError) throw tasksError;

  const propertyIds = [
    ...new Set(
      [
        ...(leads ?? []).map((row) => row.property_id as string | null),
        ...(tasks ?? []).map((row) => row.property_id as string | null)
      ].filter(Boolean)
    )
  ] as string[];

  const { data: properties, error: propertiesError } = propertyIds.length
    ? await supabase
        .from("property_history_view")
        .select("property_id,raw_address,city,state")
        .in("property_id", propertyIds)
    : { data: [], error: null };

  if (propertiesError) throw propertiesError;

  const propertyMap = new Map((properties ?? []).map((row) => [row.property_id as string, row]));
  const taskRows = (tasks ?? []) as Array<Record<string, unknown>>;
  const followUpTaskKeySet = new Set(
    taskRows
      .filter(
        (task) =>
          ["call", "text", "revisit"].includes((task.type as string) ?? "") &&
          Boolean(task.lead_id) &&
          Boolean(task.due_at)
      )
      .map((task) => `${task.lead_id as string}:${task.due_at as string}`)
  );
  const appointmentTaskKeySet = new Set(
    taskRows
      .filter(
        (task) =>
          (task.type as string) === "appointment_confirm" &&
          Boolean(task.lead_id) &&
          Boolean(task.due_at)
      )
      .map((task) => `${task.lead_id as string}:${task.due_at as string}`)
  );
  const taskLeadIds = new Set(taskRows.map((task) => task.lead_id as string | null).filter(Boolean) as string[]);
  const now = Date.now();
  const tomorrowTs = startOfTomorrow();

  const derivedItems: TaskBoardItem[] = (leads ?? []).flatMap((lead) => {
    const propertyId = lead.property_id as string | null;
    const property = propertyId ? propertyMap.get(propertyId) : null;
    const address =
      (property?.raw_address as string | undefined) ??
      (lead.address as string | undefined) ??
      "Unknown address";

    const items: TaskBoardItem[] = [];
    const nextFollowUpAt = lead.next_follow_up_at as string | null;
    const appointmentAt = lead.appointment_at as string | null;
    const leadStatus = lead.lead_status as string | null;

    if (nextFollowUpAt && !followUpTaskKeySet.has(`${lead.id as string}:${nextFollowUpAt}`)) {
      items.push({
        id: `followup:${lead.id as string}`,
        kind: "follow_up",
        title: "Lead follow-up",
        address,
        city: (property?.city as string | null | undefined) ?? null,
        state: (property?.state as string | null | undefined) ?? null,
        dueAt: nextFollowUpAt,
        leadStatus,
        propertyId,
        leadId: lead.id as string,
        notes: null
      });
    }

    if (appointmentAt && !appointmentTaskKeySet.has(`${lead.id as string}:${appointmentAt}`)) {
      items.push({
        id: `appointment:${lead.id as string}`,
        kind: "appointment",
        title: "Appointment preparation",
        address,
        city: (property?.city as string | null | undefined) ?? null,
        state: (property?.state as string | null | undefined) ?? null,
        dueAt: appointmentAt,
        leadStatus,
        propertyId,
        leadId: lead.id as string,
        notes: null
      });
    }

    if (
      (leadStatus === "Connected" || leadStatus === "Qualified" || leadStatus === "Appointment Set") &&
      !nextFollowUpAt &&
      !appointmentAt &&
      !taskLeadIds.has(lead.id as string)
    ) {
      items.push({
        id: `attention:${lead.id as string}`,
        kind: "needs_attention",
        title: "Needs next step",
        address,
        city: (property?.city as string | null | undefined) ?? null,
        state: (property?.state as string | null | undefined) ?? null,
        dueAt: (lead.last_activity_at as string | null) ?? null,
        leadStatus,
        propertyId,
        leadId: lead.id as string,
        notes: "Opportunity has no scheduled next action."
      });
    }

    return items;
  });

  const manualItems: TaskBoardItem[] = (tasks ?? []).map((task) => {
    const propertyId = task.property_id as string | null;
    const property = propertyId ? propertyMap.get(propertyId) : null;

    return {
      id: `task:${task.id as string}`,
      kind: "manual",
      title: (task.type as string)?.replaceAll("_", " ") || "Manual task",
      address: (property?.raw_address as string | undefined) ?? "No linked property",
      city: (property?.city as string | null | undefined) ?? null,
      state: (property?.state as string | null | undefined) ?? null,
      dueAt: (task.due_at as string | null) ?? null,
      leadStatus: null,
      propertyId,
      leadId: (task.lead_id as string | null) ?? null,
      notes: (task.notes as string | null) ?? null
    };
  });

  const allItems = [...derivedItems, ...manualItems];

  const overdue = sortTaskItems(
    allItems.filter((item) => item.dueAt && toTimestamp(item.dueAt) < now)
  );
  const today = sortTaskItems(
    allItems.filter((item) => {
      const time = toTimestamp(item.dueAt);
      return item.dueAt && time >= now && time < tomorrowTs;
    })
  );
  const upcoming = sortTaskItems(
    allItems.filter((item) => item.dueAt && toTimestamp(item.dueAt) >= tomorrowTs)
  );
  const needsAttention = allItems.filter((item) => item.kind === "needs_attention");

  return {
    summary: {
      overdue: overdue.length,
      today: today.length,
      upcoming: upcoming.length,
      needsAttention: needsAttention.length
    },
    overdue,
    today,
    upcoming,
    needsAttention
  };
}
