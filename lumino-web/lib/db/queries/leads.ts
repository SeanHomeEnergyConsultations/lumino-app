import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { LeadDetailResponse, LeadsResponse, LeadListItem, LeadDetailItem } from "@/types/api";
import type { AuthSessionContext } from "@/types/auth";

function mapLeadStatus(status: string | null) {
  return status ?? "New";
}

export async function getLeads(
  context: AuthSessionContext,
  requestedOwnerId?: string | null
): Promise<LeadsResponse> {
  const supabase = createServerSupabaseClient();
  const isManager = context.memberships.some((membership) =>
    ["owner", "admin", "manager"].includes(membership.role)
  );
  const ownerId = requestedOwnerId && isManager ? requestedOwnerId : null;

  let query = supabase
    .from("leads")
    .select(
      "id,property_id,address,city,state,phone,email,lead_status,next_follow_up_at,appointment_at,last_activity_at,owner_id,first_name,last_name"
    )
    .eq("organization_id", context.organizationId)
    .order("updated_at", { ascending: false })
    .limit(250);

  if (ownerId) {
    query = query.or(`owner_id.eq.${ownerId},assigned_to.eq.${ownerId}`);
  }

  const { data: leads, error } = await query;
  if (error) throw error;

  const ownerIds = [...new Set((leads ?? []).map((row) => row.owner_id as string | null).filter(Boolean))] as string[];
  const { data: owners, error: ownersError } = ownerIds.length
    ? await supabase.from("app_users").select("id,full_name,email").in("id", ownerIds)
    : { data: [], error: null };

  if (ownersError) throw ownersError;

  const ownerMap = new Map((owners ?? []).map((row) => [row.id as string, row]));

  const items: LeadListItem[] = (leads ?? []).map((row) => {
    const owner = ownerMap.get((row.owner_id as string | null) ?? "");

    return {
      leadId: row.id as string,
      propertyId: (row.property_id as string | null) ?? null,
      address: (row.address as string | null) ?? "Unknown address",
      city: (row.city as string | null) ?? null,
      state: (row.state as string | null) ?? null,
      contactName:
        [row.first_name as string | null, row.last_name as string | null].filter(Boolean).join(" ") || null,
      phone: (row.phone as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      leadStatus: mapLeadStatus((row.lead_status as string | null) ?? null),
      nextFollowUpAt: (row.next_follow_up_at as string | null) ?? null,
      appointmentAt: (row.appointment_at as string | null) ?? null,
      lastActivityAt: (row.last_activity_at as string | null) ?? null,
      ownerName: (owner?.full_name as string | null | undefined) ?? (owner?.email as string | null | undefined) ?? null
    };
  });

  return { items };
}

export async function getLeadDetail(
  leadId: string,
  context: AuthSessionContext
): Promise<LeadDetailResponse["item"] | null> {
  const supabase = createServerSupabaseClient();
  const { data: lead, error } = await supabase
    .from("leads")
    .select("*")
    .eq("organization_id", context.organizationId)
    .eq("id", leadId)
    .maybeSingle();

  if (error) throw error;
  if (!lead) return null;

  const propertyId = (lead.property_id as string | null) ?? null;
  const ownerId = (lead.owner_id as string | null) ?? null;

  const [{ data: property, error: propertyError }, { data: activities, error: activitiesError }, { data: owner, error: ownerError }] =
    await Promise.all([
      propertyId
        ? supabase
            .from("property_history_view")
            .select("property_id,raw_address,city,state,postal_code,last_visit_outcome,last_visited_at,visit_count")
            .eq("property_id", propertyId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("activities")
        .select("id,type,created_at,actor_user_id,data")
        .eq("organization_id", context.organizationId)
        .eq("entity_type", "lead")
        .eq("entity_id", leadId)
        .order("created_at", { ascending: false })
        .limit(15),
      ownerId
        ? supabase.from("app_users").select("id,full_name,email").eq("id", ownerId).maybeSingle()
        : Promise.resolve({ data: null, error: null })
    ]);

  if (propertyError) throw propertyError;
  if (activitiesError) throw activitiesError;
  if (ownerError) throw ownerError;

  const item: LeadDetailItem = {
    leadId: lead.id as string,
    propertyId,
    address:
      (property?.raw_address as string | undefined) ??
      ((lead.address as string | null) ?? "Unknown address"),
    city: (property?.city as string | null | undefined) ?? ((lead.city as string | null) ?? null),
    state: (property?.state as string | null | undefined) ?? ((lead.state as string | null) ?? null),
    postalCode:
      (property?.postal_code as string | null | undefined) ?? ((lead.zipcode as string | null) ?? null),
    contactName:
      [lead.first_name as string | null, lead.last_name as string | null].filter(Boolean).join(" ") || null,
    firstName: (lead.first_name as string | null) ?? null,
    lastName: (lead.last_name as string | null) ?? null,
    phone: (lead.phone as string | null) ?? null,
    email: (lead.email as string | null) ?? null,
    leadStatus: mapLeadStatus((lead.lead_status as string | null) ?? null),
    interestLevel: (lead.interest_level as string | null) ?? null,
    nextFollowUpAt: (lead.next_follow_up_at as string | null) ?? null,
    appointmentAt: (lead.appointment_at as string | null) ?? null,
    lastActivityAt: (lead.last_activity_at as string | null) ?? null,
    lastActivityType: (lead.last_activity_type as string | null) ?? null,
    lastActivityOutcome: (lead.last_activity_outcome as string | null) ?? null,
    notes: (lead.notes as string | null) ?? null,
    ownerName: (owner?.full_name as string | null | undefined) ?? (owner?.email as string | null | undefined) ?? null,
    propertySummary: property
      ? {
          lastVisitOutcome: (property.last_visit_outcome as string | null) ?? null,
          lastVisitedAt: (property.last_visited_at as string | null) ?? null,
          visitCount: Number(property.visit_count ?? 0)
        }
      : null,
    activities:
      (activities ?? []).map((activity) => ({
        id: activity.id as string,
        type: activity.type as string,
        createdAt: activity.created_at as string,
        actorUserId: (activity.actor_user_id as string | null) ?? null,
        data: (activity.data as Record<string, unknown>) ?? {}
      })) ?? []
  };

  return { item }.item;
}
