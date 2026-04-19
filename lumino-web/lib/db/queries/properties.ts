import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { getOrganizationFeatureAccess } from "@/lib/db/queries/platform";
import { computeOperationalPropertyPriority } from "@/lib/properties/priority";
import type { AuthSessionContext } from "@/types/auth";
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

export async function getPropertyDetail(
  propertyId: string,
  context: AuthSessionContext
): Promise<PropertyDetail | null> {
  const supabase = createServerSupabaseClient();
  const featureResolution = context.organizationId
    ? await getOrganizationFeatureAccess(context.organizationId)
    : null;
  const featureAccess = featureResolution?.effective ?? {
    enrichmentEnabled: false,
    priorityScoringEnabled: false,
    advancedImportsEnabled: false,
    securityConsoleEnabled: false
  };

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
    { data: sourceRecords, error: sourceRecordsError },
    { data: propertyFactsRow, error: propertyFactsError },
    { data: enrichments, error: enrichmentsError }
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
        .limit(12),
      supabase
        .from("properties")
        .select(
          "beds,baths,square_feet,lot_size_sqft,year_built,last_sale_date,last_sale_price,property_type,listing_status,sale_type,days_on_market,hoa_monthly,data_completeness_score,solar_fit_score,roof_capacity_score,roof_complexity_score,estimated_system_capacity_kw,estimated_yearly_energy_kwh,solar_imagery_quality,property_priority_score,property_priority_label"
        )
        .eq("id", propertyId)
        .maybeSingle(),
      supabase
        .from("property_enrichments")
        .select("id,provider,enrichment_type,status,fetched_at,expires_at,payload")
        .eq("property_id", propertyId)
        .order("fetched_at", { ascending: false })
        .limit(8)
    ]);

  if (visitsError) throw visitsError;
  if (activitiesError) throw activitiesError;
  if (sourceRecordsError) throw sourceRecordsError;
  if (propertyFactsError) throw propertyFactsError;
  if (enrichmentsError) throw enrichmentsError;

  const notHomeCount = (visits ?? []).filter((visit) => visit.outcome === "not_home").length;
  const priority = featureAccess.priorityScoringEnabled
    ? computeOperationalPropertyPriority({
        basePriorityScore: (propertyFactsRow?.property_priority_score as number | null) ?? 0,
        solarFitScore: (propertyFactsRow?.solar_fit_score as number | null) ?? 0,
        dataCompletenessScore: (propertyFactsRow?.data_completeness_score as number | null) ?? 0,
        sourceRecordCount: sourceRecords?.length ?? 0,
        hasFirstName: Boolean(historyRow.first_name),
        hasLastName: Boolean(historyRow.last_name),
        hasPhone: Boolean(historyRow.phone),
        hasEmail: Boolean(historyRow.email),
        leadStatus: historyRow.lead_status,
        followUpState: deriveFollowUpState(historyRow.lead_next_follow_up_at),
        appointmentAt: historyRow.appointment_at,
        lastVisitOutcome: historyRow.last_visit_outcome,
        lastVisitedAt: historyRow.last_visited_at,
        notHomeCount
      })
    : {
        score: 0,
        band: "low" as const,
        summary: "Priority scoring is not enabled for this organization."
      };

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
    priorityScore: priority.score,
    priorityBand: priority.band,
    prioritySummary: priority.summary,
    featureAccess,
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
    facts: {
      beds: (propertyFactsRow?.beds as number | null) ?? null,
      baths: (propertyFactsRow?.baths as number | null) ?? null,
      squareFeet: (propertyFactsRow?.square_feet as number | null) ?? null,
      lotSizeSqft: (propertyFactsRow?.lot_size_sqft as number | null) ?? null,
      yearBuilt: (propertyFactsRow?.year_built as number | null) ?? null,
      lastSaleDate: (propertyFactsRow?.last_sale_date as string | null) ?? null,
      lastSalePrice: (propertyFactsRow?.last_sale_price as number | null) ?? null,
      propertyType: (propertyFactsRow?.property_type as string | null) ?? null,
      listingStatus: (propertyFactsRow?.listing_status as string | null) ?? null,
      saleType: (propertyFactsRow?.sale_type as string | null) ?? null,
      daysOnMarket: (propertyFactsRow?.days_on_market as number | null) ?? null,
      hoaMonthly: (propertyFactsRow?.hoa_monthly as number | null) ?? null,
      dataCompletenessScore: (propertyFactsRow?.data_completeness_score as number | null) ?? null,
      solarFitScore: (propertyFactsRow?.solar_fit_score as number | null) ?? null,
      roofCapacityScore: (propertyFactsRow?.roof_capacity_score as number | null) ?? null,
      roofComplexityScore: (propertyFactsRow?.roof_complexity_score as number | null) ?? null,
      estimatedSystemCapacityKw: (propertyFactsRow?.estimated_system_capacity_kw as number | null) ?? null,
      estimatedYearlyEnergyKwh: (propertyFactsRow?.estimated_yearly_energy_kwh as number | null) ?? null,
      solarImageryQuality: (propertyFactsRow?.solar_imagery_quality as string | null) ?? null,
      propertyPriorityScore: (propertyFactsRow?.property_priority_score as number | null) ?? null,
      propertyPriorityLabel: (propertyFactsRow?.property_priority_label as string | null) ?? null
    },
    enrichments: featureAccess.enrichmentEnabled
      ? enrichments?.map((enrichment) => ({
          id: enrichment.id,
          provider: enrichment.provider,
          enrichmentType: enrichment.enrichment_type,
          status: enrichment.status,
          fetchedAt: enrichment.fetched_at,
          expiresAt: (enrichment.expires_at as string | null) ?? null,
          payload: (enrichment.payload as Record<string, unknown>) ?? {}
        })) ?? []
      : [],
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
