import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { createTaskIfMissing, ensureOutcomeTask } from "@/lib/db/mutations/tasks";
import {
  deleteSyncedGoogleCalendarAppointment,
  syncAppointmentToGoogleCalendar
} from "@/lib/google-calendar/service";
import { buildLeadCadencePlan } from "@/lib/leads/cadence";
import { getAppBaseUrl } from "@/lib/utils/env";
import type { AuthSessionContext } from "@/types/auth";
import type { LeadInput } from "@/types/entities";

function combineName(firstName?: string | null, lastName?: string | null) {
  return [firstName?.trim(), lastName?.trim()].filter(Boolean).join(" ") || null;
}

async function queueCadenceTasks(input: {
  propertyId: string;
  leadId: string;
  leadStatus: string | null;
  phone: string | null;
  email: string | null;
  interestLevel: LeadInput["interestLevel"];
  nextFollowUpAt: string | null;
  appointmentAt: string | null;
  decisionMakerStatus: LeadInput["decisionMakerStatus"];
  preferredChannel: LeadInput["preferredChannel"];
  bestContactTime: string | null;
  textConsent: boolean | null;
  objectionType: LeadInput["objectionType"];
  appointmentOutcome: LeadInput["appointmentOutcome"];
  engagementScore: number | null;
  cadenceTrack: LeadInput["cadenceTrack"];
  context: AuthSessionContext;
}) {
  const plan = buildLeadCadencePlan({
    phone: input.phone,
    email: input.email,
    interestLevel: input.interestLevel ?? null,
    nextFollowUpAt: input.nextFollowUpAt,
    appointmentAt: input.appointmentAt,
    decisionMakerStatus: input.decisionMakerStatus ?? null,
    preferredChannel: input.preferredChannel ?? null,
    bestContactTime: input.bestContactTime ?? null,
    textConsent: input.textConsent ?? null,
    objectionType: input.objectionType ?? null,
    appointmentOutcome: input.appointmentOutcome ?? null,
    engagementScore: input.engagementScore ?? null,
    cadenceTrack: input.cadenceTrack ?? null
  });

  await Promise.all(
    plan.tasks.map((task) =>
      createTaskIfMissing(
        {
          propertyId: input.propertyId,
          leadId: input.leadId,
          type: task.type,
          dueAt: task.dueAt,
          notes: task.notes
        },
        input.context
      )
    )
  );

  return plan;
}

export async function upsertLead(input: LeadInput, context: AuthSessionContext) {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) {
    throw new Error("No active organization found for this user.");
  }

  const { data: propertyRow, error: propertyError } = await supabase
    .from("property_history_view")
    .select(
      "property_id,lead_id,normalized_address,raw_address,address_line_1,city,state,postal_code,lat,lng,owner_id,first_name,last_name,phone,email,lead_notes,lead_status,lead_next_follow_up_at,appointment_at"
    )
    .eq("property_id", input.propertyId)
    .maybeSingle();

  if (propertyError) throw propertyError;
  if (!propertyRow) {
    throw new Error("Property not found.");
  }

  const { data: existingLead, error: existingLeadError } = propertyRow.lead_id
    ? await supabase
        .from("leads")
        .select(
          "decision_maker_status,preferred_channel,best_contact_time,text_consent,objection_type,bill_received,proposal_presented,appointment_outcome,reschedule_reason,cancellation_reason,engagement_score,cadence_track,interest_level,next_follow_up_at,appointment_at"
        )
        .eq("id", propertyRow.lead_id as string)
        .maybeSingle()
    : { data: null, error: null };

  if (existingLeadError) throw existingLeadError;

  const firstName =
    input.firstName !== undefined ? input.firstName.trim() || null : ((propertyRow.first_name as string | null) ?? null);
  const lastName =
    input.lastName !== undefined ? input.lastName.trim() || null : ((propertyRow.last_name as string | null) ?? null);
  const phone =
    input.phone !== undefined ? input.phone.trim() || null : ((propertyRow.phone as string | null) ?? null);
  const email =
    input.email !== undefined ? input.email.trim() || null : ((propertyRow.email as string | null) ?? null);
  const notes =
    input.notes !== undefined ? input.notes.trim() || null : ((propertyRow.lead_notes as string | null) ?? null);
  const leadStatus =
    input.leadStatus !== undefined ? input.leadStatus : ((propertyRow.lead_status as string | null) ?? "New");
  const nextFollowUpAt =
    input.nextFollowUpAt !== undefined
      ? input.nextFollowUpAt
      : ((existingLead?.next_follow_up_at as string | null | undefined) ?? (propertyRow.lead_next_follow_up_at as string | null) ?? null);
  const appointmentAt =
    input.appointmentAt !== undefined
      ? input.appointmentAt
      : ((existingLead?.appointment_at as string | null | undefined) ?? (propertyRow.appointment_at as string | null) ?? null);
  const interestLevel =
    input.interestLevel !== undefined
      ? input.interestLevel
      : ((existingLead?.interest_level as LeadInput["interestLevel"] | undefined) ?? null);
  const decisionMakerStatus =
    input.decisionMakerStatus !== undefined
      ? input.decisionMakerStatus
      : ((existingLead?.decision_maker_status as LeadInput["decisionMakerStatus"] | undefined) ?? null);
  const preferredChannel =
    input.preferredChannel !== undefined
      ? input.preferredChannel
      : ((existingLead?.preferred_channel as LeadInput["preferredChannel"] | undefined) ?? (phone ? "text" : "door"));
  const bestContactTime =
    input.bestContactTime !== undefined
      ? input.bestContactTime?.trim() || null
      : ((existingLead?.best_contact_time as string | null | undefined) ?? null);
  const textConsent =
    input.textConsent !== undefined
      ? input.textConsent
      : ((existingLead?.text_consent as boolean | null | undefined) ?? Boolean(phone));
  const objectionType =
    input.objectionType !== undefined
      ? input.objectionType
      : ((existingLead?.objection_type as LeadInput["objectionType"] | undefined) ?? null);
  const billReceived =
    input.billReceived !== undefined
      ? input.billReceived
      : ((existingLead?.bill_received as boolean | null | undefined) ?? null);
  const proposalPresented =
    input.proposalPresented !== undefined
      ? input.proposalPresented
      : ((existingLead?.proposal_presented as boolean | null | undefined) ?? null);
  const appointmentOutcome =
    input.appointmentOutcome !== undefined
      ? input.appointmentOutcome
      : ((existingLead?.appointment_outcome as LeadInput["appointmentOutcome"] | undefined) ?? null);
  const rescheduleReason =
    input.rescheduleReason !== undefined
      ? input.rescheduleReason?.trim() || null
      : ((existingLead?.reschedule_reason as string | null | undefined) ?? null);
  const cancellationReason =
    input.cancellationReason !== undefined
      ? input.cancellationReason?.trim() || null
      : ((existingLead?.cancellation_reason as string | null | undefined) ?? null);
  const engagementScore =
    input.engagementScore !== undefined
      ? input.engagementScore
      : ((existingLead?.engagement_score as number | null | undefined) ?? null);
  const cadenceTrack =
    input.cadenceTrack !== undefined
      ? input.cadenceTrack
      : ((existingLead?.cadence_track as LeadInput["cadenceTrack"] | undefined) ?? null);

  const shouldGenerateCadence =
    input.appointmentAt !== undefined ||
    input.appointmentOutcome !== undefined ||
    input.cadenceTrack !== undefined ||
    (!propertyRow.lead_id && input.nextFollowUpAt == null);

  const cadencePlan =
    shouldGenerateCadence
      ? buildLeadCadencePlan({
          phone,
          email,
          interestLevel,
          nextFollowUpAt,
          appointmentAt,
          decisionMakerStatus,
          preferredChannel,
          bestContactTime,
          textConsent,
          objectionType,
          appointmentOutcome,
          engagementScore,
          cadenceTrack
        })
      : null;
  const payload = {
    property_id: input.propertyId,
    owner_id: context.appUser.id,
    assigned_to: context.appUser.id,
    owner_name: combineName(firstName, lastName),
    first_name: firstName,
    last_name: lastName,
    phone,
    email,
    notes,
    lead_status: leadStatus,
    interest_level: interestLevel ?? null,
    decision_maker_status: decisionMakerStatus,
    preferred_channel: preferredChannel,
    best_contact_time: bestContactTime,
    text_consent: textConsent,
    objection_type: objectionType,
    bill_received: billReceived,
    proposal_presented: proposalPresented,
    appointment_outcome: appointmentOutcome,
    reschedule_reason: rescheduleReason,
    cancellation_reason: cancellationReason,
    engagement_score: engagementScore,
    cadence_track: cadencePlan?.cadenceTrack ?? cadenceTrack,
    next_follow_up_at: nextFollowUpAt ?? cadencePlan?.suggestedNextFollowUpAt ?? null,
    appointment_at: appointmentAt,
    last_activity_at: new Date().toISOString(),
    last_activity_type: "lead_capture",
    last_activity_outcome: leadStatus,
    updated_at: new Date().toISOString()
  };

  let leadId = propertyRow.lead_id as string | null;

  if (leadId) {
    const { error: updateError } = await supabase.from("leads").update(payload).eq("id", leadId);
    if (updateError) throw updateError;
  } else {
    const insertPayload = {
      organization_id: context.organizationId,
      created_by: context.appUser.id,
      normalized_address: propertyRow.normalized_address,
      address: propertyRow.raw_address || propertyRow.address_line_1 || propertyRow.normalized_address,
      city: propertyRow.city,
      state: propertyRow.state,
      zipcode: propertyRow.postal_code,
      lat: propertyRow.lat,
      lng: propertyRow.lng,
      status: "open",
      assignment_status: "assigned",
      analysis_status: "pending",
      source: "field_canvassing",
      follow_up_flags: [],
      ...payload
    };

    const { data: insertedRow, error: insertError } = await supabase
      .from("leads")
      .insert(insertPayload)
      .select("id")
      .single();

    if (insertError) throw insertError;
    leadId = insertedRow.id;
  }

  const propertyUpdates: Record<string, unknown> = {
    current_lead_id: leadId,
    next_follow_up_at: nextFollowUpAt ?? cadencePlan?.suggestedNextFollowUpAt ?? null,
    updated_at: new Date().toISOString()
  };

  const { error: propertyUpdateError } = await supabase
    .from("properties")
    .update(propertyUpdates)
    .eq("id", input.propertyId);

  if (propertyUpdateError) throw propertyUpdateError;

  const activityData = {
    lead_id: leadId,
    lead_status: leadStatus,
    first_name: firstName,
    last_name: lastName,
    phone,
    email,
    interest_level: interestLevel ?? null,
    decision_maker_status: decisionMakerStatus,
    preferred_channel: preferredChannel,
    text_consent: textConsent,
    objection_type: objectionType,
    appointment_outcome: appointmentOutcome,
    cadence_track: cadencePlan?.cadenceTrack ?? cadenceTrack,
    next_follow_up_at: nextFollowUpAt ?? cadencePlan?.suggestedNextFollowUpAt ?? null,
    appointment_at: appointmentAt
  };

  const { error: propertyActivityError } = await supabase.from("activities").insert({
    organization_id: context.organizationId,
    entity_type: "property",
    entity_id: input.propertyId,
    actor_user_id: context.appUser.id,
    type: propertyRow.lead_id ? "lead_updated" : "lead_created",
    data: activityData
  });

  if (propertyActivityError) throw propertyActivityError;

  const { error: leadActivityError } = await supabase.from("activities").insert({
    organization_id: context.organizationId,
    entity_type: "lead",
    entity_id: leadId,
    actor_user_id: context.appUser.id,
    type: propertyRow.lead_id ? "lead_updated" : "lead_created",
    data: activityData
  });

  if (leadActivityError) throw leadActivityError;

  if (nextFollowUpAt) {
    await ensureOutcomeTask({
      context,
      propertyId: input.propertyId,
      leadId,
      type: "call",
      dueAt: nextFollowUpAt,
      notes: "Auto-created from lead follow-up scheduling."
    });
  }

  if (leadId && cadencePlan) {
    await queueCadenceTasks({
      propertyId: input.propertyId,
      leadId,
      leadStatus,
      phone,
      email,
      interestLevel,
      nextFollowUpAt: nextFollowUpAt ?? cadencePlan.suggestedNextFollowUpAt ?? null,
      appointmentAt,
      decisionMakerStatus,
      preferredChannel,
      bestContactTime,
      textConsent,
      objectionType,
      appointmentOutcome,
      engagementScore,
      cadenceTrack: cadencePlan.cadenceTrack,
      context
    });
  }

  const appBaseUrl = getAppBaseUrl() ?? "http://localhost:3000";
  if (appointmentAt && leadId) {
    await syncAppointmentToGoogleCalendar({
      context,
      leadId,
      appUrl: appBaseUrl
    }).catch(() => null);
  } else if (leadId) {
    await deleteSyncedGoogleCalendarAppointment({
      context,
      leadId
    }).catch(() => null);
  }

  return {
    leadId,
    propertyId: input.propertyId
  };
}
