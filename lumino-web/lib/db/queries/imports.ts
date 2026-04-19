import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";
import type { ImportAssignmentOption, ImportBatchDetailResponse, ImportBatchListItem } from "@/types/api";

function mapBatchRow(
  row: Record<string, unknown>,
  teamNameById: Map<string, string>,
  userNameById: Map<string, string>
): ImportBatchListItem {
  const assignedTeamId = (row.assigned_team_id as string | null) ?? null;
  const assignedUserId = (row.assigned_user_id as string | null) ?? null;

  return {
    batchId: row.id as string,
    filename: (row.filename as string | null) ?? (row.source_name as string | null) ?? "Upload",
    listType: ((row.list_type as ImportBatchListItem["listType"] | null) ?? "general_canvass_list"),
    visibilityScope: ((row.visibility_scope as ImportBatchListItem["visibilityScope"] | null) ?? "organization"),
    assignedTeamId,
    assignedTeamName: assignedTeamId ? teamNameById.get(assignedTeamId) ?? null : null,
    assignedUserId,
    assignedUserName: assignedUserId ? userNameById.get(assignedUserId) ?? null : null,
    status: (row.status as string | null) ?? "uploaded",
    totalRows: Number(row.total_rows ?? 0),
    detectedRows: Number(row.detected_rows ?? 0),
    insertedCount: Number(row.inserted_count ?? 0),
    updatedCount: Number(row.updated_count ?? 0),
    duplicateMatchedCount: Number(row.duplicate_matched_count ?? 0),
    pendingAnalysisCount: Number(row.pending_analysis_count ?? 0),
    analyzingCount: Number(row.analyzing_count ?? 0),
    analyzedCount: Number(row.analyzed_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    createdAt: row.created_at as string,
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null
  };
}

async function loadImportScopeLookups(organizationId: string) {
  const supabase = createServerSupabaseClient();
  const [{ data: teams, error: teamsError }, { data: users, error: usersError }] = await Promise.all([
    supabase
      .from("teams")
      .select("id,name")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true }),
    supabase
      .from("organization_members")
      .select("user_id,role,is_active,app_users!inner(id,full_name,email)")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
  ]);

  if (teamsError) throw teamsError;
  if (usersError) throw usersError;

  const teamOptions: ImportAssignmentOption[] = (teams ?? []).map((team) => ({
    id: team.id as string,
    label: (team.name as string | null) ?? "Unnamed team"
  }));

  const userOptions: ImportAssignmentOption[] = (users ?? []).map((row) => {
    const appUser = row.app_users as unknown as { id: string; full_name: string | null; email: string | null };
    return {
      id: appUser.id,
      label:
        appUser.full_name?.trim() ||
        appUser.email?.trim() ||
        ((row.role as string | null) ?? "Team member")
    };
  });

  const teamNameById = new Map(teamOptions.map((item) => [item.id, item.label]));
  const userNameById = new Map(userOptions.map((item) => [item.id, item.label]));

  return { teamOptions, userOptions, teamNameById, userNameById };
}

async function loadImportScopeLookupsSafe(organizationId: string) {
  try {
    return await loadImportScopeLookups(organizationId);
  } catch (error) {
    console.error("Failed to load import assignment lookups", error);
    return {
      teamOptions: [] as ImportAssignmentOption[],
      userOptions: [] as ImportAssignmentOption[],
      teamNameById: new Map<string, string>(),
      userNameById: new Map<string, string>()
    };
  }
}

export async function getRecentImportBatches(context: AuthSessionContext): Promise<ImportBatchListItem[]> {
  if (!context.organizationId) return [];

  const supabase = createServerSupabaseClient();
  const { teamNameById, userNameById } = await loadImportScopeLookupsSafe(context.organizationId);
  const { data, error } = await supabase
    .from("import_batches")
    .select(
      "id,filename,source_name,list_type,visibility_scope,assigned_team_id,assigned_user_id,status,total_rows,detected_rows,inserted_count,updated_count,duplicate_matched_count,pending_analysis_count,analyzing_count,analyzed_count,failed_count,created_at,started_at,completed_at,last_error"
    )
    .eq("organization_id", context.organizationId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;

  return (data ?? []).map((row) => mapBatchRow(row as Record<string, unknown>, teamNameById, userNameById));
}

export async function getImportAssignmentOptions(context: AuthSessionContext) {
  if (!context.organizationId) {
    return { teams: [], users: [] };
  }

  const { teamOptions, userOptions } = await loadImportScopeLookupsSafe(context.organizationId);
  return { teams: teamOptions, users: userOptions };
}

export async function getImportBatchDetail(
  batchId: string,
  context: AuthSessionContext,
  options?: { page?: number; pageSize?: number }
): Promise<ImportBatchDetailResponse["item"] | null> {
  if (!context.organizationId) return null;
  const page = Math.max(1, options?.page ?? 1);
  const pageSize = Math.min(500, Math.max(25, options?.pageSize ?? 100));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = createServerSupabaseClient();
  const { teamNameById, userNameById } = await loadImportScopeLookupsSafe(context.organizationId);
  const { data: batchRow, error: batchError } = await supabase
    .from("import_batches")
    .select(
      "id,filename,source_name,source_type,list_type,visibility_scope,assigned_team_id,assigned_user_id,status,total_rows,detected_rows,inserted_count,updated_count,duplicate_matched_count,pending_analysis_count,analyzing_count,analyzed_count,failed_count,created_at,started_at,completed_at,last_error,notes"
    )
    .eq("organization_id", context.organizationId)
    .eq("id", batchId)
    .maybeSingle();

  if (batchError) throw batchError;
  if (!batchRow) return null;

  const { count: totalItems, error: countError } = await supabase
    .from("import_batch_items")
    .select("id", { count: "exact", head: true })
    .eq("import_batch_id", batchId);

  if (countError) throw countError;

  const { data: itemRows, error: itemsError } = await supabase
    .from("import_batch_items")
    .select("id,lead_id,source_row_number,raw_address,normalized_address,ingest_status,analysis_status,analysis_error,created_at")
    .eq("import_batch_id", batchId)
    .order("source_row_number", { ascending: true })
    .range(from, to);

  if (itemsError) throw itemsError;

  return {
    ...mapBatchRow(batchRow as Record<string, unknown>, teamNameById, userNameById),
    sourceName: (batchRow.source_name as string | null) ?? null,
    sourceType: (batchRow.source_type as string | null) ?? null,
    notes: (batchRow.notes as string | null) ?? null,
    page,
    pageSize,
    totalItems: Number(totalItems ?? 0),
    totalPages: Math.max(1, Math.ceil(Number(totalItems ?? 0) / pageSize)),
    items:
      (itemRows ?? []).map((row) => ({
        itemId: row.id as string,
        leadId: (row.lead_id as string | null) ?? null,
        sourceRowNumber: (row.source_row_number as number | null) ?? null,
        rawAddress: (row.raw_address as string | null) ?? null,
        normalizedAddress: (row.normalized_address as string | null) ?? null,
        ingestStatus: (row.ingest_status as string | null) ?? "pending",
        analysisStatus: (row.analysis_status as string | null) ?? "pending",
        analysisError: (row.analysis_error as string | null) ?? null,
        createdAt: (row.created_at as string | null) ?? null
      })) ?? []
  };
}
