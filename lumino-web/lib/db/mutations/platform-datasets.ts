import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { hasPlatformAccess } from "@/lib/auth/permissions";
import { getOrganizationFeatureAccess } from "@/lib/db/queries/platform";
import { normalizeOrganizationBillingPlan } from "@/lib/platform/features";
import type { AuthSessionContext } from "@/types/auth";

type DatasetGrantScope = "organization" | "team" | "assigned_user";

function assertPlatformAccess(context: AuthSessionContext) {
  if (!hasPlatformAccess(context)) {
    throw new Error("Platform access required.");
  }
}

async function assertOrganizationCanReceiveDataset(organizationId: string, listType: string) {
  const featureResolution = await getOrganizationFeatureAccess(organizationId);
  const featureAccess = featureResolution.effective;
  if (!featureAccess.datasetMarketplaceEnabled) {
    throw new Error("This organization's plan does not include access to shared platform datasets.");
  }

  if (listType === "general_canvass_list" || listType === "homeowner_leads" || listType === "sold_properties") {
    return featureAccess;
  }

  if (!featureAccess.solarCheckEnabled && listType === "solar_permits") {
    throw new Error("This organization's plan does not include solar dataset access.");
  }

  return featureAccess;
}

async function syncPlatformDatasetRecords(datasetId: string, sourceBatchId: string) {
  const supabase = createServerSupabaseClient();
  const { data: itemRows, error: itemRowsError } = await supabase
    .from("import_batch_items")
    .select("id,lead_id,source_payload,raw_address,normalized_address")
    .eq("import_batch_id", sourceBatchId)
    .order("source_row_number", { ascending: true });
  if (itemRowsError) throw itemRowsError;

  const leadIds = [...new Set((itemRows ?? []).map((row) => row.lead_id as string | null).filter(Boolean))] as string[];
  const { data: leadRows, error: leadRowsError } = leadIds.length
    ? await supabase
        .from("leads")
        .select("id,property_id,address,city,state,zipcode,lat,lng")
        .in("id", leadIds)
    : { data: [], error: null };
  if (leadRowsError) throw leadRowsError;

  const propertyIds = [...new Set((leadRows ?? []).map((row) => row.property_id as string | null).filter(Boolean))] as string[];
  const [{ data: propertyRows, error: propertyRowsError }, { data: analysisRows, error: analysisRowsError }] =
    await Promise.all([
      propertyIds.length
        ? supabase
            .from("properties")
            .select(
              "id,normalized_address,raw_address,address_line_1,city,state,postal_code,zipcode,lat,lng,beds,baths,square_feet,lot_size_sqft,year_built,last_sale_date,last_sale_price,property_type,listing_status,sale_type,days_on_market,hoa_monthly,data_completeness_score,solar_fit_score,roof_capacity_score,roof_complexity_score,estimated_system_capacity_kw,estimated_yearly_energy_kwh,solar_imagery_quality,property_priority_score,property_priority_label"
            )
            .in("id", propertyIds)
        : Promise.resolve({ data: [], error: null }),
      leadIds.length
        ? supabase
            .from("lead_analysis")
            .select("*")
            .in("lead_id", leadIds)
            .order("updated_at", { ascending: false })
        : Promise.resolve({ data: [], error: null })
    ]);

  if (propertyRowsError) throw propertyRowsError;
  if (analysisRowsError) throw analysisRowsError;

  const leadMap = new Map((leadRows ?? []).map((row) => [row.id as string, row]));
  const propertyMap = new Map((propertyRows ?? []).map((row) => [row.id as string, row]));
  const analysisMap = new Map<string, Record<string, unknown>>();
  for (const analysis of analysisRows ?? []) {
    const leadId = analysis.lead_id as string;
    if (!analysisMap.has(leadId)) {
      analysisMap.set(leadId, analysis as Record<string, unknown>);
    }
  }

  const records = (itemRows ?? []).map((item) => {
    const lead = item.lead_id ? leadMap.get(item.lead_id as string) : null;
    const property = lead?.property_id ? propertyMap.get(lead.property_id as string) : null;
    const analysis = item.lead_id ? analysisMap.get(item.lead_id as string) ?? null : null;

    return {
      platform_dataset_id: datasetId,
      source_batch_item_id: item.id as string,
      property_id: (lead?.property_id as string | null | undefined) ?? null,
      normalized_address:
        (property?.normalized_address as string | null | undefined) ??
        ((item.normalized_address as string | null | undefined) ?? null),
      raw_address:
        (property?.raw_address as string | null | undefined) ??
        ((lead?.address as string | null | undefined) ?? (item.raw_address as string | null | undefined) ?? null),
      city: (property?.city as string | null | undefined) ?? ((lead?.city as string | null | undefined) ?? null),
      state: (property?.state as string | null | undefined) ?? ((lead?.state as string | null | undefined) ?? null),
      postal_code:
        (property?.postal_code as string | null | undefined) ??
        ((property?.zipcode as string | null | undefined) ?? (lead?.zipcode as string | null | undefined) ?? null),
      lat: (property?.lat as number | null | undefined) ?? ((lead?.lat as number | null | undefined) ?? null),
      lng: (property?.lng as number | null | undefined) ?? ((lead?.lng as number | null | undefined) ?? null),
      source_payload: (item.source_payload as Record<string, unknown> | null) ?? {},
      analysis_payload: analysis,
      property_snapshot: property ? (property as Record<string, unknown>) : null,
      updated_at: new Date().toISOString()
    };
  });

  if (!records.length) return;

  const { error: upsertError } = await supabase.from("platform_dataset_records").upsert(records, {
    onConflict: "platform_dataset_id,source_batch_item_id"
  });
  if (upsertError) throw upsertError;
}

async function syncOrganizationDatasetTargets(input: {
  datasetId: string;
  organizationId: string;
  visibilityScope: DatasetGrantScope;
  assignedTeamId: string | null;
  assignedUserId: string | null;
  status: "active" | "paused" | "revoked";
}) {
  const supabase = createServerSupabaseClient();

  if (input.status !== "active") {
    const { error } = await supabase
      .from("organization_dataset_targets")
      .delete()
      .eq("organization_id", input.organizationId)
      .eq("platform_dataset_id", input.datasetId);
    if (error) throw error;
    return;
  }

  const { data: records, error: recordsError } = await supabase
    .from("platform_dataset_records")
    .select("id,property_id")
    .eq("platform_dataset_id", input.datasetId);
  if (recordsError) throw recordsError;

  const { error: deleteError } = await supabase
    .from("organization_dataset_targets")
    .delete()
    .eq("organization_id", input.organizationId)
    .eq("platform_dataset_id", input.datasetId);
  if (deleteError) throw deleteError;

  const payload = (records ?? []).map((record) => ({
    organization_id: input.organizationId,
    platform_dataset_id: input.datasetId,
    platform_dataset_record_id: record.id as string,
    property_id: (record.property_id as string | null | undefined) ?? null,
    visibility_scope: input.visibilityScope,
    assigned_team_id: input.assignedTeamId,
    assigned_user_id: input.assignedUserId
  }));

  if (!payload.length) return;
  const { error: insertError } = await supabase.from("organization_dataset_targets").insert(payload);
  if (insertError) throw insertError;
}

async function autoReleaseDatasetToIntelligenceOrganizations(datasetId: string, context: AuthSessionContext) {
  const supabase = createServerSupabaseClient();
  const { data: organizations, error } = await supabase
    .from("organizations")
    .select("id,billing_plan")
    .eq("status", "active");

  if (error) throw error;

  for (const organization of organizations ?? []) {
    const organizationId = organization.id as string;
    const resolvedPlan = normalizeOrganizationBillingPlan((organization.billing_plan as string | null | undefined) ?? null);
    if (resolvedPlan !== "intelligence" || organizationId === context.organizationId) continue;

    try {
      await grantPlatformDatasetToOrganization(
        {
          datasetId,
          organizationId,
          visibilityScope: "organization"
        },
        context
      );
    } catch (errorToIgnore) {
      console.error("Failed to auto-release dataset to intelligence organization", {
        datasetId,
        organizationId,
        error: errorToIgnore
      });
    }
  }
}

export async function syncPlatformDatasetsToIntelligenceOrganization(
  organizationId: string,
  context: AuthSessionContext
) {
  const supabase = createServerSupabaseClient();
  const { data: datasets, error } = await supabase
    .from("platform_datasets")
    .select("id,status")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) throw error;

  for (const dataset of datasets ?? []) {
    try {
      await grantPlatformDatasetToOrganization(
        {
          datasetId: dataset.id as string,
          organizationId,
          visibilityScope: "organization"
        },
        context
      );
    } catch (errorToIgnore) {
      console.error("Failed to sync shared dataset into intelligence organization", {
        organizationId,
        datasetId: dataset.id,
        error: errorToIgnore
      });
    }
  }
}

export async function reconcileOrganizationDatasetAccess(
  organizationId: string,
  context: AuthSessionContext
) {
  assertPlatformAccess(context);
  const supabase = createServerSupabaseClient();

  const { data: grants, error: grantsError } = await supabase
    .from("organization_dataset_access")
    .select("platform_dataset_id,status,visibility_scope,assigned_team_id,assigned_user_id,platform_datasets!inner(list_type)")
    .eq("organization_id", organizationId);
  if (grantsError) throw grantsError;

  for (const grant of grants ?? []) {
    const dataset = grant.platform_datasets as { list_type?: string | null } | null;
    const listType = dataset?.list_type ?? "general_canvass_list";

    let shouldBeActive = true;
    try {
      await assertOrganizationCanReceiveDataset(organizationId, listType);
    } catch {
      shouldBeActive = false;
    }

    const nextStatus = shouldBeActive
      ? ((grant.status as "active" | "paused" | "revoked" | null) ?? "active")
      : "revoked";

    const { error: updateError } = await supabase
      .from("organization_dataset_access")
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString()
      })
      .eq("organization_id", organizationId)
      .eq("platform_dataset_id", grant.platform_dataset_id as string);
    if (updateError) throw updateError;

    await syncOrganizationDatasetTargets({
      datasetId: grant.platform_dataset_id as string,
      organizationId,
      visibilityScope:
        ((grant.visibility_scope as DatasetGrantScope | null | undefined) ?? "organization"),
      assignedTeamId: (grant.assigned_team_id as string | null | undefined) ?? null,
      assignedUserId: (grant.assigned_user_id as string | null | undefined) ?? null,
      status: nextStatus
    });
  }
}

export async function publishImportBatchAsPlatformDataset(
  input: {
    batchId: string;
    name: string;
    description?: string | null;
  },
  context: AuthSessionContext
) {
  assertPlatformAccess(context);
  if (!context.organizationId) throw new Error("Choose the source organization before publishing a dataset.");
  const supabase = createServerSupabaseClient();

  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .select("id,source_name,list_type")
    .eq("organization_id", context.organizationId)
    .eq("id", input.batchId)
    .maybeSingle();
  if (batchError) throw batchError;
  if (!batch) throw new Error("Import batch not found in the active organization.");

  const { data: existing } = await supabase
    .from("platform_datasets")
    .select("id")
    .eq("source_batch_id", input.batchId)
    .maybeSingle();

  if (existing?.id) {
    await syncPlatformDatasetRecords(existing.id as string, input.batchId);
    return { datasetId: existing.id as string, alreadyPublished: true };
  }

  const { data, error } = await supabase
    .from("platform_datasets")
    .insert({
      source_organization_id: context.organizationId,
      source_batch_id: input.batchId,
      name: input.name.trim() || ((batch.source_name as string | null) ?? "Shared Dataset"),
      description: input.description?.trim() || null,
      list_type: (batch.list_type as string | null) ?? "general_canvass_list",
      created_by: context.appUser.id
    })
    .select("id")
    .single();

  if (error) throw error;

  await syncPlatformDatasetRecords(data.id as string, input.batchId);
  await autoReleaseDatasetToIntelligenceOrganizations(data.id as string, context);
  return { datasetId: data.id as string, alreadyPublished: false };
}

export async function grantPlatformDatasetToOrganization(
  input: {
    datasetId: string;
    organizationId: string;
    visibilityScope?: DatasetGrantScope;
    assignedTeamId?: string | null;
    assignedUserId?: string | null;
    status?: "active" | "paused" | "revoked";
  },
  context: AuthSessionContext
) {
  assertPlatformAccess(context);
  const supabase = createServerSupabaseClient();

  const { data: dataset, error: datasetError } = await supabase
    .from("platform_datasets")
    .select("id,list_type")
    .eq("id", input.datasetId)
    .maybeSingle();
  if (datasetError) throw datasetError;
  if (!dataset) throw new Error("Platform dataset not found.");

  const visibilityScope = input.visibilityScope ?? "organization";
  const assignedTeamId = visibilityScope === "team" ? input.assignedTeamId ?? null : null;
  const assignedUserId = visibilityScope === "assigned_user" ? input.assignedUserId ?? null : null;
  const status = input.status ?? "active";

  if (status === "active") {
    await assertOrganizationCanReceiveDataset(
      input.organizationId,
      (dataset.list_type as string | null) ?? "general_canvass_list"
    );
  }

  const { error: grantError } = await supabase.from("organization_dataset_access").upsert(
    {
      platform_dataset_id: input.datasetId,
      organization_id: input.organizationId,
      visibility_scope: visibilityScope,
      assigned_team_id: assignedTeamId,
      assigned_user_id: assignedUserId,
      status,
      granted_by: context.appUser.id,
      granted_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      onConflict: "platform_dataset_id,organization_id"
    }
  );
  if (grantError) throw grantError;

  await syncOrganizationDatasetTargets({
    datasetId: input.datasetId,
    organizationId: input.organizationId,
    visibilityScope,
    assignedTeamId,
    assignedUserId,
    status
  });

  return { ok: true as const };
}
