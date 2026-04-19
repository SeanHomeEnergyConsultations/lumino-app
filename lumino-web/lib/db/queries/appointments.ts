import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AppointmentsResponse, AppointmentScheduleItem } from "@/types/api";
import type { AuthSessionContext } from "@/types/auth";

function toTimestamp(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  return new Date(value).getTime();
}

export async function getAppointments(
  context: AuthSessionContext,
  requestedOwnerId?: string | null
): Promise<AppointmentsResponse> {
  const supabase = createServerSupabaseClient();
  const isManager = context.memberships.some((membership) =>
    ["owner", "admin", "manager"].includes(membership.role)
  );
  const ownerId = requestedOwnerId && isManager ? requestedOwnerId : context.appUser.id;

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id,property_id,owner_id,first_name,last_name,phone,email,lead_status,appointment_at")
    .eq("status", "open")
    .not("appointment_at", "is", null)
    .or(`owner_id.eq.${ownerId},assigned_to.eq.${ownerId}`)
    .order("appointment_at", { ascending: true })
    .limit(250);

  if (error) throw error;

  const propertyIds = (leads ?? []).map((row) => row.property_id as string | null).filter(Boolean) as string[];
  const ownerIds = [...new Set((leads ?? []).map((row) => row.owner_id as string | null).filter(Boolean))] as string[];
  const leadIds = (leads ?? []).map((row) => row.id as string | null).filter(Boolean) as string[];

  const [
    { data: properties, error: propertiesError },
    { data: users, error: usersError },
    { data: reminderTasks, error: reminderError },
    { data: appointmentRows, error: appointmentError }
  ] =
    await Promise.all([
      propertyIds.length
        ? supabase
            .from("property_history_view")
            .select("property_id,raw_address,city,state")
            .in("property_id", propertyIds)
        : Promise.resolve({ data: [], error: null }),
      ownerIds.length
        ? supabase.from("app_users").select("id,full_name,email").in("id", ownerIds)
        : Promise.resolve({ data: [], error: null }),
      leadIds.length
        ? supabase
            .from("tasks")
            .select("id,lead_id,due_at,status,type")
            .in("lead_id", leadIds)
            .eq("type", "appointment_confirm")
            .in("status", ["open", "overdue", "blocked"])
        : Promise.resolve({ data: [], error: null }),
      leadIds.length
        ? supabase
            .from("appointments")
            .select("id,lead_id,status,scheduled_at")
            .in("lead_id", leadIds)
        : Promise.resolve({ data: [], error: null })
    ]);

  if (propertiesError) throw propertiesError;
  if (usersError) throw usersError;
  if (reminderError) throw reminderError;
  if (appointmentError) throw appointmentError;

  const propertyMap = new Map((properties ?? []).map((row) => [row.property_id as string, row]));
  const userMap = new Map((users ?? []).map((row) => [row.id as string, row]));
  const reminderMap = new Map((reminderTasks ?? []).map((row) => [row.lead_id as string, row]));
  const appointmentMap = new Map((appointmentRows ?? []).map((row) => [row.lead_id as string, row]));
  const now = Date.now();
  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 0, 0);
  const tomorrowTs = tomorrow.getTime();

  const items: AppointmentScheduleItem[] = (leads ?? [])
    .map((lead) => {
      const propertyId = lead.property_id as string | null;
      if (!propertyId) return null;

      const property = propertyMap.get(propertyId);
      const owner = userMap.get((lead.owner_id as string | null) ?? "");
      const reminder = reminderMap.get(lead.id as string);
      const appointment = appointmentMap.get(lead.id as string);
      const scheduledAt = lead.appointment_at as string | null;
      if (!scheduledAt) return null;

      return {
        leadId: lead.id as string,
        propertyId,
        address: (property?.raw_address as string | undefined) ?? "Unknown address",
        city: (property?.city as string | null | undefined) ?? null,
        state: (property?.state as string | null | undefined) ?? null,
        scheduledAt,
        leadStatus: (lead.lead_status as string | null) ?? null,
        contactName:
          [lead.first_name as string | null, lead.last_name as string | null].filter(Boolean).join(" ") || null,
        phone: (lead.phone as string | null) ?? null,
        email: (lead.email as string | null) ?? null,
        ownerId: (lead.owner_id as string | null) ?? null,
        ownerName: (owner?.full_name as string | null | undefined) ?? (owner?.email as string | null | undefined) ?? null,
        reminderTaskId: (reminder?.id as string | null | undefined) ?? null,
        reminderDueAt: (reminder?.due_at as string | null | undefined) ?? null,
        appointmentRecordId: (appointment?.id as string | null | undefined) ?? null,
        appointmentStatus:
          ((appointment?.status as AppointmentScheduleItem["appointmentStatus"] | undefined) ?? "scheduled")
      };
    })
    .filter((item): item is AppointmentScheduleItem => Boolean(item));

  const pastDue = items
    .filter((item) => toTimestamp(item.scheduledAt) < now)
    .sort((a, b) => toTimestamp(a.scheduledAt) - toTimestamp(b.scheduledAt));
  const today = items
    .filter((item) => {
      const time = toTimestamp(item.scheduledAt);
      return time >= now && time < tomorrowTs;
    })
    .sort((a, b) => toTimestamp(a.scheduledAt) - toTimestamp(b.scheduledAt));
  const upcoming = items
    .filter((item) => toTimestamp(item.scheduledAt) >= tomorrowTs)
    .sort((a, b) => toTimestamp(a.scheduledAt) - toTimestamp(b.scheduledAt));

  return {
    summary: {
      pastDue: pastDue.length,
      today: today.length,
      upcoming: upcoming.length
    },
    pastDue,
    today,
    upcoming
  };
}
