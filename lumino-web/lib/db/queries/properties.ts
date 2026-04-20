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

function deriveMapState(input: {
  visitCount: number;
  lastVisitOutcome: string | null;
  leadId: string | null;
  leadStatus: string | null;
  appointmentAt: string | null;
  nextFollowUpAt: string | null;
  sharedTarget: boolean;
}): PropertyDetail["mapState"] {
  if (input.lastVisitOutcome === "do_not_knock") return "do_not_knock";
  if (input.leadStatus === "Closed Won") return "customer";
  if (input.appointmentAt) return "appointment_set";
  if (input.nextFollowUpAt && new Date(input.nextFollowUpAt).getTime() < Date.now()) return "follow_up_overdue";
  if (input.lastVisitOutcome === "appointment_set") return "appointment_set";
  if (input.lastVisitOutcome === "opportunity") return "opportunity";
  if (input.lastVisitOutcome === "left_doorhanger") return "left_doorhanger";
  if (input.lastVisitOutcome === "not_home") return "not_home";
  if (input.lastVisitOutcome === "interested") return "interested";
  if (input.lastVisitOutcome === "callback_requested") return "callback_requested";
  if (input.lastVisitOutcome === "not_interested") return "not_interested";
  if (input.lastVisitOutcome === "disqualified") return "disqualified";
  if (input.visitCount > 0 && input.leadId) return "canvassed_with_lead";
  if (input.visitCount > 0) return "canvassed";
  if (input.leadId || input.sharedTarget) return "imported_target";
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
  };

  const [
    { data: propertyRow, error: propertyError },
    { data: leadRows, error: leadError },
    { data: visits, error: visitsError },
    { data: activities, error: activitiesError },
    { data: localSourceRecords, error: sourceRecordsError },
    { data: propertyFactsRow, error: propertyFactsError },
    { data: enrichments, error: enrichmentsError },
    { data: sharedTargets, error: sharedTargetsError }
  ] = await Promise.all([
    supabase
      .from("properties")
      .select(
        "id,raw_address,address_line_1,city,state,postal_code,zipcode,lat,lng,beds,baths,square_feet,lot_size_sqft,year_built,last_sale_date,last_sale_price,property_type,listing_status,sale_type,days_on_market,hoa_monthly,data_completeness_score,solar_fit_score,roof_capacity_score,roof_complexity_score,estimated_system_capacity_kw,estimated_yearly_energy_kwh,solar_imagery_quality,property_priority_score,property_priority_label"
      )
      .eq("id", propertyId)
      .maybeSingle(),
    context.organizationId
      ? supabase
          .from("leads")
          .select("*")
          .eq("organization_id", context.organizationId)
          .eq("property_id", propertyId)
          .order("updated_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
    context.organizationId
      ? supabase
          .from("visits")
          .select("id,outcome,notes,captured_at,user_id")
          .eq("organization_id", context.organizationId)
          .eq("property_id", propertyId)
          .order("captured_at", { ascending: false })
          .limit(25)
      : Promise.resolve({ data: [], error: null }),
    context.organizationId
      ? supabase
          .from("activities")
          .select("id,type,created_at,actor_user_id,data")
          .eq("organization_id", context.organizationId)
          .eq("entity_type", "property")
          .eq("entity_id", propertyId)
          .order("created_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [], error: null }),
    context.organizationId
      ? supabase
          .from("property_source_records")
          .select("id,source_type,source_name,source_batch_id,source_record_id,source_url,record_date,payload,created_at")
          .eq("organization_id", context.organizationId)
          .eq("property_id", propertyId)
          .order("created_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [], error: null }),
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
      .limit(8),
    context.organizationId
      ? supabase
          .from("organization_dataset_targets")
          .select("platform_dataset_record_id")
          .eq("organization_id", context.organizationId)
          .eq("property_id", propertyId)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (propertyError) throw propertyError;
  if (leadError) throw leadError;
  if (visitsError) throw visitsError;
  if (activitiesError) throw activitiesError;
  if (sourceRecordsError) throw sourceRecordsError;
  if (propertyFactsError) throw propertyFactsError;
  if (enrichmentsError) throw enrichmentsError;
  if (sharedTargetsError) throw sharedTargetsError;
  if (!propertyRow) return null;

  const localLead = (leadRows ?? [])[0] as Record<string, unknown> | undefined;
  const sharedRecordIds = (sharedTargets ?? []).map((row) => row.platform_dataset_record_id as string);
  const { data: sharedRecords, error: sharedRecordsError } = sharedRecordIds.length
    ? await supabase
        .from("platform_dataset_records")
        .select("id,platform_dataset_id,source_payload,analysis_payload,created_at")
        .in("id", sharedRecordIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (sharedRecordsError) throw sharedRecordsError;

  const datasetIds = [...new Set((sharedRecords ?? []).map((row) => row.platform_dataset_id as string))];
  const { data: datasets } = datasetIds.length
    ? await supabase.from("platform_datasets").select("id,name,list_type").in("id", datasetIds)
    : { data: [] };
  const datasetMap = new Map((datasets ?? []).map((row) => [row.id as string, row]));

  const notHomeCount = (visits ?? []).filter((visit) => visit.outcome === "not_home").length;
  const sourceRecordCount = (localSourceRecords?.length ?? 0) + (sharedRecords?.length ?? 0);
  const priority = featureAccess.priorityScoringEnabled
    ? computeOperationalPropertyPriority({
        basePriorityScore: (propertyFactsRow?.property_priority_score as number | null) ?? 0,
        solarFitScore: (propertyFactsRow?.solar_fit_score as number | null) ?? 0,
        dataCompletenessScore: (propertyFactsRow?.data_completeness_score as number | null) ?? 0,
        sourceRecordCount,
        hasFirstName: Boolean(localLead?.first_name),
        hasLastName: Boolean(localLead?.last_name),
        hasPhone: Boolean(localLead?.phone),
        hasEmail: Boolean(localLead?.email),
        leadStatus: (localLead?.lead_status as string | null | undefined) ?? null,
        followUpState: deriveFollowUpState((localLead?.next_follow_up_at as string | null | undefined) ?? null),
        appointmentAt: (localLead?.appointment_at as string | null | undefined) ?? null,
        lastVisitOutcome: (visits?.[0]?.outcome as string | null | undefined) ?? null,
        lastVisitedAt: (visits?.[0]?.captured_at as string | null | undefined) ?? null,
        notHomeCount
      })
    : {
        score: 0,
        band: "low" as const,
        summary: "Priority scoring is not enabled for this organization."
      };

  return {
    propertyId: propertyRow.id as string,
    address: ((propertyRow.raw_address as string | null | undefined) ?? (propertyRow.address_line_1 as string | null | undefined) ?? "Unknown address"),
    city: (propertyRow.city as string | null | undefined) ?? null,
    state: (propertyRow.state as string | null | undefined) ?? null,
    postalCode: ((propertyRow.postal_code as string | null | undefined) ?? (propertyRow.zipcode as string | null | undefined) ?? null),
    lat: (propertyRow.lat as number | null | undefined) ?? null,
    lng: (propertyRow.lng as number | null | undefined) ?? null,
    mapState: deriveMapState({
      visitCount: visits?.length ?? 0,
      lastVisitOutcome: (visits?.[0]?.outcome as string | null | undefined) ?? null,
      leadId: (localLead?.id as string | null | undefined) ?? null,
      leadStatus: (localLead?.lead_status as string | null | undefined) ?? null,
      appointmentAt: (localLead?.appointment_at as string | null | undefined) ?? null,
      nextFollowUpAt: (localLead?.next_follow_up_at as string | null | undefined) ?? null,
      sharedTarget: sharedRecordIds.length > 0
    }),
    followUpState: deriveFollowUpState((localLead?.next_follow_up_at as string | null | undefined) ?? null),
    visitCount: visits?.length ?? 0,
    notHomeCount,
    lastVisitOutcome: (visits?.[0]?.outcome as string | null | undefined) ?? null,
    lastVisitedAt: (visits?.[0]?.captured_at as string | null | undefined) ?? null,
    leadId: (localLead?.id as string | null | undefined) ?? null,
    leadStatus: (localLead?.lead_status as string | null | undefined) ?? null,
    ownerId: (localLead?.owner_id as string | null | undefined) ?? null,
    firstName: (localLead?.first_name as string | null | undefined) ?? null,
    lastName: (localLead?.last_name as string | null | undefined) ?? null,
    phone: (localLead?.phone as string | null | undefined) ?? null,
    email: (localLead?.email as string | null | undefined) ?? null,
    leadNotes: (localLead?.notes as string | null | undefined) ?? null,
    leadNextFollowUpAt: (localLead?.next_follow_up_at as string | null | undefined) ?? null,
    appointmentAt: (localLead?.appointment_at as string | null | undefined) ?? null,
    priorityScore: priority.score,
    priorityBand: priority.band,
    prioritySummary: priority.summary,
    featureAccess,
    recentVisits:
      visits?.slice(0, 12).map((visit) => ({
        id: visit.id as string,
        outcome: visit.outcome as string,
        notes: (visit.notes as string | null | undefined) ?? null,
        capturedAt: visit.captured_at as string,
        userId: (visit.user_id as string | null | undefined) ?? null
      })) ?? [],
    recentActivities:
      activities?.map((activity) => ({
        id: activity.id as string,
        type: activity.type as string,
        createdAt: activity.created_at as string,
        actorUserId: (activity.actor_user_id as string | null | undefined) ?? null,
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
          id: enrichment.id as string,
          provider: enrichment.provider as string,
          enrichmentType: enrichment.enrichment_type as string,
          status: enrichment.status as string,
          fetchedAt: enrichment.fetched_at as string,
          expiresAt: (enrichment.expires_at as string | null | undefined) ?? null,
          payload: (enrichment.payload as Record<string, unknown>) ?? {}
        })) ?? []
      : [],
    sourceRecords: [
      ...((localSourceRecords ?? []).map((record) => ({
        id: record.id as string,
        sourceType: record.source_type as string,
        sourceName: (record.source_name as string | null | undefined) ?? null,
        sourceBatchId: (record.source_batch_id as string | null | undefined) ?? null,
        sourceRecordId: (record.source_record_id as string | null | undefined) ?? null,
        sourceUrl: (record.source_url as string | null | undefined) ?? null,
        recordDate: (record.record_date as string | null | undefined) ?? null,
        createdAt: record.created_at as string,
        payload: (record.payload as Record<string, unknown>) ?? {}
      })) ?? []),
      ...((sharedRecords ?? []).map((record) => {
        const dataset = datasetMap.get(record.platform_dataset_id as string);
        return {
          id: record.id as string,
          sourceType: "shared_dataset",
          sourceName: (dataset?.name as string | null | undefined) ?? "Shared Dataset",
          sourceBatchId: null,
          sourceRecordId: record.id as string,
          sourceUrl: null,
          recordDate: null,
          createdAt: record.created_at as string,
          payload: ((record.analysis_payload as Record<string, unknown> | null | undefined) ??
            (record.source_payload as Record<string, unknown> | null | undefined) ??
            {}) as Record<string, unknown>
        };
      }) ?? [])
    ]
  };
}
