import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { hasPlatformAccess } from "@/lib/auth/permissions";
import { ingestImportUpload } from "@/lib/db/mutations/imports";
import { getOrganizationFeatureAccess } from "@/lib/db/queries/platform";
import { normalizeOrganizationBillingPlan } from "@/lib/platform/features";
import type { AuthSessionContext } from "@/types/auth";

function assertPlatformAccess(context: AuthSessionContext) {
  if (!hasPlatformAccess(context)) {
    throw new Error("Platform access required.");
  }
}

async function assertOrganizationCanReceiveDataset(
  organizationId: string,
  listType: string
) {
  const featureResolution = await getOrganizationFeatureAccess(organizationId);
  const featureAccess = featureResolution.effective;
  if (!featureAccess.datasetMarketplaceEnabled) {
    throw new Error("This organization's plan does not include access to shared platform datasets.");
  }

  if (listType === "general_canvass_list" || listType === "homeowner_leads") {
    return featureAccess;
  }

  if (!featureAccess.solarCheckEnabled && ["solar_permits"].includes(listType)) {
    throw new Error("This organization's plan does not include solar dataset access.");
  }

  return featureAccess;
}

async function autoReleaseDatasetToIntelligenceOrganizations(
  datasetId: string,
  context: AuthSessionContext
) {
  const supabase = createServerSupabaseClient();
  const { data: organizations, error } = await supabase
    .from("organizations")
    .select("id,billing_plan")
    .eq("status", "active");

  if (error) throw error;

  for (const organization of organizations ?? []) {
    const organizationId = organization.id as string;
    const resolvedPlan = normalizeOrganizationBillingPlan((organization.billing_plan as string | null | undefined) ?? null);
    if (resolvedPlan !== "intelligence") continue;
    if (organizationId === context.organizationId) continue;

    try {
      await grantPlatformDatasetToOrganization(
        {
          datasetId,
          organizationId,
          visibilityScope: "organization"
        },
        context,
        { skipEntitlementCheck: false }
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
  await autoReleaseDatasetToIntelligenceOrganizations(data.id as string, context);
  return { datasetId: data.id as string, alreadyPublished: false };
}

export async function grantPlatformDatasetToOrganization(
  input: {
    datasetId: string;
    organizationId: string;
    visibilityScope?: "organization" | "team" | "assigned_user";
    assignedTeamId?: string | null;
    assignedUserId?: string | null;
  },
  context: AuthSessionContext,
  options?: { skipEntitlementCheck?: boolean }
) {
  assertPlatformAccess(context);
  const supabase = createServerSupabaseClient();

  const { data: dataset, error: datasetError } = await supabase
    .from("platform_datasets")
    .select("id,name,source_batch_id,list_type,source_organization_id")
    .eq("id", input.datasetId)
    .maybeSingle();
  if (datasetError) throw datasetError;
  if (!dataset) throw new Error("Platform dataset not found.");

  const visibilityScope = input.visibilityScope ?? "organization";
  const assignedTeamId = visibilityScope === "team" ? input.assignedTeamId ?? null : null;
  const assignedUserId = visibilityScope === "assigned_user" ? input.assignedUserId ?? null : null;

  if (!options?.skipEntitlementCheck) {
    await assertOrganizationCanReceiveDataset(input.organizationId, (dataset.list_type as string | null) ?? "general_canvass_list");
  }

  const { data: sourceItems, error: sourceItemsError } = await supabase
    .from("import_batch_items")
    .select("source_payload")
    .eq("import_batch_id", dataset.source_batch_id as string)
    .order("source_row_number", { ascending: true });
  if (sourceItemsError) throw sourceItemsError;

  const rows = (sourceItems ?? [])
    .map((item) => item.source_payload as Record<string, string> | null)
    .filter((item): item is Record<string, string> => Boolean(item));
  if (!rows.length) throw new Error("This dataset has no source rows to release.");

  const releaseContext: AuthSessionContext = {
    ...context,
    organizationId: input.organizationId
  };

  const ingestResult = await ingestImportUpload(
    {
      filename: `${(dataset.name as string) ?? "Shared Dataset"} (shared)`,
      listType: (dataset.list_type as "general_canvass_list" | "homeowner_leads" | "sold_properties" | "solar_permits" | "roofing_permits" | "custom") ?? "general_canvass_list",
      visibilityScope,
      assignedTeamId,
      assignedUserId,
      rows
    },
    releaseContext
  );

  const { error: grantError } = await supabase
    .from("organization_dataset_access")
    .upsert({
      platform_dataset_id: input.datasetId,
      organization_id: input.organizationId,
      visibility_scope: visibilityScope,
      assigned_team_id: assignedTeamId,
      assigned_user_id: assignedUserId,
      status: "active",
      granted_by: context.appUser.id,
      last_released_batch_id: ingestResult.batchId,
      updated_at: new Date().toISOString()
    }, {
      onConflict: "platform_dataset_id,organization_id"
    });
  if (grantError) throw grantError;

  return { batchId: ingestResult.batchId };
}
