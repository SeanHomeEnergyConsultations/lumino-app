import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";
import type { ImportBatchListItem } from "@/types/api";

export async function getRecentImportBatches(context: AuthSessionContext): Promise<ImportBatchListItem[]> {
  if (!context.organizationId) return [];

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("import_batches")
    .select(
      "id,filename,source_name,status,total_rows,detected_rows,inserted_count,updated_count,duplicate_matched_count,pending_analysis_count,analyzing_count,analyzed_count,failed_count,created_at,started_at,completed_at,last_error"
    )
    .eq("organization_id", context.organizationId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    batchId: row.id as string,
    filename: (row.filename as string | null) ?? (row.source_name as string | null) ?? "Upload",
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
  }));
}
