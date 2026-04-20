import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { getOrganizationFeatureAccess } from "@/lib/db/queries/platform";
import { computeOperationalPropertyPriority } from "@/lib/properties/priority";
import type { MapPropertiesResponse } from "@/types/api";
import type { AuthSessionContext } from "@/types/auth";
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
  showTeamKnocks?: boolean;
}

function deriveMapState(input: {
  visitCount: number;
  lastVisitOutcome: string | null;
  leadId: string | null;
  leadStatus: string | null;
  appointmentAt: string | null;
  followUpState: string;
  sharedTarget: boolean;
}): MapProperty["mapState"] {
  if (input.leadStatus === "Closed Won") return "customer";
  if (input.appointmentAt || input.lastVisitOutcome === "appointment_set") return "appointment_set";
  if (input.followUpState === "overdue") return "follow_up_overdue";
  if (input.lastVisitOutcome === "opportunity") return "opportunity";
  if (input.lastVisitOutcome === "left_doorhanger") return "left_doorhanger";
  if (input.lastVisitOutcome === "not_home") return "not_home";
  if (input.lastVisitOutcome === "interested") return "interested";
  if (input.lastVisitOutcome === "callback_requested") return "callback_requested";
  if (input.lastVisitOutcome === "not_interested") return "not_interested";
  if (input.lastVisitOutcome === "disqualified") return "disqualified";
  if (input.lastVisitOutcome === "do_not_knock") return "do_not_knock";
  if (input.visitCount > 0 && input.leadId) return "canvassed_with_lead";
  if (input.visitCount > 0) return "canvassed";
  if (input.leadId || input.sharedTarget) return "imported_target";
  return "unworked_property";
}

function deriveFollowUpState(nextFollowUpAt: string | null): MapProperty["followUpState"] {
  if (!nextFollowUpAt) return "none";
  const next = new Date(nextFollowUpAt);
  const now = new Date();
  if (next.getTime() < now.getTime()) return "overdue";
  if (next.toDateString() === now.toDateString()) return "due_today";
  return "scheduled_future";
}

export async function getMapPropertiesForViewport(
  context: AuthSessionContext,
  filters: MapViewportFilters = {}
): Promise<MapPropertiesResponse> {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) {
    return {
      items: [],
      features: {
        mapEnabled: true,
        doorKnockingEnabled: true,
        visitLoggingEnabled: true,
        leadsEnabled: false,
        crmEnabled: false,
        appointmentsEnabled: false,
        selfImportsEnabled: false,
        advancedImportsEnabled: false,
        tasksEnabled: false,
        teamManagementEnabled: false,
        territoriesEnabled: false,
        solarCheckEnabled: false,
        datasetMarketplaceEnabled: false,
        enrichmentEnabled: false,
        priorityScoringEnabled: false,
        territoryPlanningEnabled: false,
        securityConsoleEnabled: false
      }
    };
  }

  const featureResolution = await getOrganizationFeatureAccess(context.organizationId);
  const featureAccess = featureResolution.effective;
  const limit = filters.limit ?? 250;
  const isManager = context.memberships.some((membership) => ["owner", "admin", "manager"].includes(membership.role));
  const showTeamKnocks = filters.showTeamKnocks ?? isManager;

  const [{ data: localLeads, error: localLeadsError }, { data: localVisits, error: localVisitsError }, { data: teamMemberships, error: teamMembershipsError }] =
    await Promise.all([
      supabase
        .from("leads")
        .select("id,property_id,lead_status,owner_id,assigned_to,first_name,last_name,phone,email,next_follow_up_at,appointment_at,updated_at")
        .eq("organization_id", context.organizationId)
        .not("property_id", "is", null),
      supabase
        .from("visits")
        .select("id,property_id,user_id,outcome,captured_at")
        .eq("organization_id", context.organizationId),
      supabase
        .from("team_memberships")
        .select("team_id")
        .eq("organization_id", context.organizationId)
        .eq("user_id", context.appUser.id)
    ]);
  if (localLeadsError) throw localLeadsError;
  if (localVisitsError) throw localVisitsError;
  if (teamMembershipsError) throw teamMembershipsError;

  const userTeamIds = new Set((teamMemberships ?? []).map((row) => row.team_id as string));
  const localLeadMap = new Map<string, Record<string, unknown>>();
  for (const lead of localLeads ?? []) {
    const propertyId = lead.property_id as string | null;
    if (!propertyId || localLeadMap.has(propertyId)) continue;
    localLeadMap.set(propertyId, lead as Record<string, unknown>);
  }

  const latestVisitMap = new Map<string, Record<string, unknown>>();
  const visitCountMap = new Map<string, number>();
  const notHomeCountMap = new Map<string, number>();
  for (const visit of localVisits ?? []) {
    const propertyId = visit.property_id as string | null;
    if (!propertyId) continue;
    visitCountMap.set(propertyId, (visitCountMap.get(propertyId) ?? 0) + 1);
    if ((visit.outcome as string | null) === "not_home") {
      notHomeCountMap.set(propertyId, (notHomeCountMap.get(propertyId) ?? 0) + 1);
    }
    const current = latestVisitMap.get(propertyId);
    if (!current || new Date(visit.captured_at as string).getTime() > new Date(current.captured_at as string).getTime()) {
      latestVisitMap.set(propertyId, visit as Record<string, unknown>);
    }
  }

  const { data: sharedTargets, error: sharedTargetsError } = await supabase
    .from("organization_dataset_targets")
    .select("property_id,visibility_scope,assigned_team_id,assigned_user_id")
    .eq("organization_id", context.organizationId);
  if (sharedTargetsError) throw sharedTargetsError;

  const sharedTargetMap = new Map<string, Record<string, unknown>>();
  for (const target of sharedTargets ?? []) {
    const propertyId = target.property_id as string | null;
    if (!propertyId || sharedTargetMap.has(propertyId)) continue;

    if (!isManager) {
      const visibilityScope = target.visibility_scope as string;
      if (visibilityScope === "organization") continue;
      if (visibilityScope === "assigned_user" && target.assigned_user_id !== context.appUser.id) continue;
      if (visibilityScope === "team" && !userTeamIds.has(target.assigned_team_id as string)) continue;
    }

    sharedTargetMap.set(propertyId, target as Record<string, unknown>);
  }

  const propertyIds = [...new Set([...localLeadMap.keys(), ...latestVisitMap.keys(), ...sharedTargetMap.keys()])];
  if (!propertyIds.length) {
    return { items: [], features: featureAccess };
  }

  let query = supabase
    .from("properties")
    .select("id,raw_address,address_line_1,city,state,postal_code,zipcode,lat,lng,data_completeness_score,solar_fit_score,property_priority_score")
    .in("id", propertyIds)
    .limit(limit);

  if (filters.minLat !== undefined) query = query.gte("lat", filters.minLat);
  if (filters.maxLat !== undefined) query = query.lte("lat", filters.maxLat);
  if (filters.minLng !== undefined) query = query.gte("lng", filters.minLng);
  if (filters.maxLng !== undefined) query = query.lte("lng", filters.maxLng);
  if (filters.city) query = query.ilike("city", filters.city);
  if (filters.state) query = query.ilike("state", filters.state);

  const { data: properties, error: propertiesError } = await query;
  if (propertiesError) throw propertiesError;

  const items = (properties ?? [])
    .filter((property) => {
      const propertyId = property.id as string;
      const localLead = localLeadMap.get(propertyId);
      const latestVisit = latestVisitMap.get(propertyId);
      const sharedTarget = sharedTargetMap.get(propertyId);

      if (!localLead && !latestVisit && !sharedTarget) return false;
      if (!isManager) {
        if (localLead) {
          const ownerId = (localLead.owner_id as string | null | undefined) ?? (localLead.assigned_to as string | null | undefined) ?? null;
          if (ownerId === context.appUser.id) return true;
        }
        if (latestVisit) {
          if (showTeamKnocks) return true;
          if ((latestVisit.user_id as string | null | undefined) === context.appUser.id) return true;
        }
        if (sharedTarget) return true;
        return false;
      }
      return true;
    })
    .map((property) => {
      const propertyId = property.id as string;
      const localLead = localLeadMap.get(propertyId);
      const latestVisit = latestVisitMap.get(propertyId);
      const sharedTarget = sharedTargetMap.has(propertyId);
      const nextFollowUpAt = (localLead?.next_follow_up_at as string | null | undefined) ?? null;
      const followUpState = deriveFollowUpState(nextFollowUpAt);
      const priority = featureAccess.priorityScoringEnabled
        ? computeOperationalPropertyPriority({
            basePriorityScore: Number(property.property_priority_score ?? 0),
            solarFitScore: Number(property.solar_fit_score ?? 0),
            dataCompletenessScore: Number(property.data_completeness_score ?? 0),
            sourceRecordCount: localLead || sharedTarget ? 1 : 0,
            hasFirstName: Boolean(localLead?.first_name),
            hasLastName: Boolean(localLead?.last_name),
            hasPhone: Boolean(localLead?.phone),
            hasEmail: Boolean(localLead?.email),
            leadStatus: (localLead?.lead_status as string | null | undefined) ?? null,
            followUpState,
            appointmentAt: (localLead?.appointment_at as string | null | undefined) ?? null,
            lastVisitOutcome: (latestVisit?.outcome as string | null | undefined) ?? null,
            lastVisitedAt: (latestVisit?.captured_at as string | null | undefined) ?? null,
            notHomeCount: notHomeCountMap.get(propertyId) ?? 0
          })
        : { score: 0, band: "low" as const };

      return {
        propertyId,
        address:
          ((property.raw_address as string | null | undefined) ??
            (property.address_line_1 as string | null | undefined) ??
            "Unknown address") as string,
        city: (property.city as string | null | undefined) ?? null,
        state: (property.state as string | null | undefined) ?? null,
        postalCode:
          ((property.postal_code as string | null | undefined) ??
            (property.zipcode as string | null | undefined) ??
            null) as string | null,
        lat: property.lat as number,
        lng: property.lng as number,
        mapState: deriveMapState({
          visitCount: visitCountMap.get(propertyId) ?? 0,
          lastVisitOutcome: (latestVisit?.outcome as string | null | undefined) ?? null,
          leadId: (localLead?.id as string | null | undefined) ?? null,
          leadStatus: (localLead?.lead_status as string | null | undefined) ?? null,
          appointmentAt: (localLead?.appointment_at as string | null | undefined) ?? null,
          followUpState,
          sharedTarget
        }),
        followUpState,
        visitCount: visitCountMap.get(propertyId) ?? 0,
        notHomeCount: notHomeCountMap.get(propertyId) ?? 0,
        lastVisitOutcome: (latestVisit?.outcome as string | null | undefined) ?? null,
        leadId: (localLead?.id as string | null | undefined) ?? null,
        leadStatus: (localLead?.lead_status as string | null | undefined) ?? null,
        appointmentAt: (localLead?.appointment_at as string | null | undefined) ?? null,
        priorityScore: priority.score,
        priorityBand: priority.band
      } satisfies MapProperty;
    })
    .sort((a, b) =>
      featureAccess.priorityScoringEnabled ? b.priorityScore - a.priorityScore : a.address.localeCompare(b.address)
    );

  return {
    items,
    features: featureAccess
  };
}
