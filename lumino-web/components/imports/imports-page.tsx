"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Upload, FileUp, Database, RefreshCw } from "lucide-react";
import { useAppFeedback } from "@/components/shared/app-feedback";
import { authFetch, useAuth } from "@/lib/auth/client";
import { formatDateTime } from "@/lib/format/date";
import { parseCsvText } from "@/lib/imports/csv";
import type { OrganizationBillingPlan } from "@/lib/platform/features";
import type { ImportBatchAnalysisResponse, ImportBatchListItem, ImportsResponse, ImportUploadResponse } from "@/types/api";

const LIST_TYPE_OPTIONS = [
  { value: "general_canvass_list", label: "General Canvass List" },
  { value: "homeowner_leads", label: "Homeowner Leads" },
  { value: "sold_properties", label: "Sold Properties" },
  { value: "solar_permits", label: "Solar Permits" },
  { value: "roofing_permits", label: "Roofing Permits" },
  { value: "custom", label: "Custom List" }
] as const;

const VISIBILITY_OPTIONS = [
  { value: "organization", label: "Manager/Admin Pool" },
  { value: "team", label: "Assigned Team" },
  { value: "assigned_user", label: "Assigned User" }
] as const;

function formatListType(value: ImportBatchListItem["listType"]) {
  return LIST_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value.replaceAll("_", " ");
}

function formatVisibility(batch: Pick<ImportBatchListItem, "visibilityScope" | "assignedTeamName" | "assignedUserName">) {
  if (batch.visibilityScope === "team") {
    return batch.assignedTeamName ? `Team · ${batch.assignedTeamName}` : "Team";
  }
  if (batch.visibilityScope === "assigned_user") {
    return batch.assignedUserName ? `User · ${batch.assignedUserName}` : "Assigned User";
  }
  return "Manager/Admin Pool";
}

function statusTone(status: string) {
  switch (status) {
    case "ready_for_analysis":
    case "uploaded":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "analyzing":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "failed":
    case "completed_with_errors":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function formatBillingPlan(plan: OrganizationBillingPlan) {
  if (plan === "free") return "Free";
  if (plan === "starter") return "Starter";
  if (plan === "pro") return "Pro";
  return "Intelligence";
}

export function ImportsPage() {
  const { session, appContext } = useAuth();
  const { notify } = useAppFeedback();
  const accessToken = session?.access_token ?? null;
  const canRunPremiumEnrichment = Boolean(appContext?.featureAccess?.importEnrichmentEnabled);

  const [filename, setFilename] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [batches, setBatches] = useState<ImportBatchListItem[]>([]);
  const [sharedDatasets, setSharedDatasets] = useState<ImportsResponse["sharedDatasets"]>([]);
  const [assignmentOptions, setAssignmentOptions] = useState<ImportsResponse["options"]>({
    teams: [],
    users: []
  });
  const [access, setAccess] = useState<ImportsResponse["access"]>({
    billingPlan: "starter",
    requiresContributionConsent: false,
    contributedUploadsOnly: false,
    hasCurrentConsent: false,
    consentVersion: null,
    acceptedAt: null
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processingBatchId, setProcessingBatchId] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<"idle" | "done" | "error">("idle");
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [listType, setListType] = useState<ImportBatchListItem["listType"]>("general_canvass_list");
  const [visibilityScope, setVisibilityScope] = useState<ImportBatchListItem["visibilityScope"]>("organization");
  const [assignedTeamId, setAssignedTeamId] = useState<string>("");
  const [assignedUserId, setAssignedUserId] = useState<string>("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [recordingConsent, setRecordingConsent] = useState(false);

  const loadBatches = useCallback(async (options?: { silent?: boolean }) => {
    if (!accessToken) return;
    const silent = options?.silent ?? false;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const response = await authFetch(accessToken, "/api/imports");
      const json = await response.json().catch(() => ({} as { error?: string }));
      if (!response.ok) {
        throw new Error((json as { error?: string }).error || "Failed to load imports.");
      }
      const typedJson = json as ImportsResponse;
      setBatches(typedJson.items);
      setSharedDatasets(typedJson.sharedDatasets);
      setAssignmentOptions(typedJson.options);
      setAccess(typedJson.access);
      return typedJson.items;
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [accessToken]);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  useEffect(() => {
    const hasActiveBatch = batches.some((batch) => batch.status === "analyzing");
    if (!hasActiveBatch || processingBatchId) return;

    const interval = window.setInterval(() => {
      void loadBatches({ silent: true });
    }, 4000);

    return () => window.clearInterval(interval);
  }, [batches, loadBatches, processingBatchId]);

  const applyBatchProgress = useCallback(
    (
      batchId: string,
      progress: Pick<
        ImportBatchAnalysisResponse,
        "status" | "pendingAnalysisCount" | "analyzingCount" | "analyzedCount" | "failedItemCount" | "lastError"
      >
    ) => {
      setBatches((current) =>
        current.map((batch) =>
          batch.batchId === batchId
            ? {
                ...batch,
                status: progress.status,
                pendingAnalysisCount: progress.pendingAnalysisCount,
                analyzingCount: progress.analyzingCount,
                analyzedCount: progress.analyzedCount,
                failedCount: progress.failedItemCount,
                lastError: progress.lastError
              }
            : batch
        )
      );
    },
    []
  );

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const parsed = parseCsvText(text);
    setFilename(file.name);
    setHeaders(parsed.headers);
    setPreviewRows(parsed.rows);
    setUploadState("idle");
    setUploadMessage(null);
  }

  async function handleUpload() {
    if (!accessToken || !filename || !previewRows.length) return;
    if (access.requiresContributionConsent && !access.hasCurrentConsent) {
      setUploadState("error");
      setUploadMessage("Accept the upload contribution terms before importing a CSV on the free plan.");
      return;
    }
    const currentFilename = filename;
    const existingBatchIds = new Set(batches.map((batch) => batch.batchId));
    setUploading(true);
    setUploadState("idle");
    setUploadMessage(null);
    try {
      const response = await authFetch(accessToken, "/api/imports", {
        method: "POST",
        body: JSON.stringify({
          filename: currentFilename,
          listType,
          visibilityScope,
          assignedTeamId: visibilityScope === "team" ? assignedTeamId || null : null,
          assignedUserId: visibilityScope === "assigned_user" ? assignedUserId || null : null,
          rows: previewRows
        })
      });
      const json = await response.json().catch(() => ({} as { error?: string }));
      if (!response.ok) {
        throw new Error((json as { error?: string }).error || "Failed to upload import.");
      }
      const result = json as ImportUploadResponse;
      setUploadState("done");
      setUploadMessage(
        canRunPremiumEnrichment
          ? "Import created successfully. Open the batch whenever you want to run premium enrichment."
          : "Import created successfully. Your rows are ready to work now."
      );
      setFilename(null);
      setHeaders([]);
      setPreviewRows([]);
      setListType("general_canvass_list");
      setVisibilityScope("organization");
      setAssignedTeamId("");
      setAssignedUserId("");
      await loadBatches({ silent: true });
    } catch (error) {
      let recovered = false;
      try {
        const refreshed = await loadBatches({ silent: true });
        const recoveredBatch = refreshed?.find(
          (batch) =>
            !existingBatchIds.has(batch.batchId) ||
            (batch.filename === currentFilename &&
              Date.now() - new Date(batch.createdAt).getTime() < 15 * 60 * 1000)
        );

        if (recoveredBatch) {
          recovered = true;
          setUploadState("done");
          setUploadMessage(
            "The upload response timed out, but your batch was created successfully. You can continue from the batch list below."
          );
          setFilename(null);
          setHeaders([]);
          setPreviewRows([]);
          setListType("general_canvass_list");
          setVisibilityScope("organization");
          setAssignedTeamId("");
          setAssignedUserId("");
        }
      } catch {
        // Keep the original upload error if the recovery refresh fails too.
      }

      if (!recovered) {
        setUploadState("error");
        setUploadMessage(error instanceof Error ? error.message : "Upload failed.");
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleContributionConsent() {
    if (!accessToken || !consentChecked) return;
    setRecordingConsent(true);
    setUploadState("idle");
    setUploadMessage(null);
    try {
      const response = await authFetch(accessToken, "/api/imports/contribution-consent", {
        method: "POST"
      });
      const json = await response.json().catch(() => ({} as { error?: string }));
      if (!response.ok) {
        throw new Error((json as { error?: string }).error || "Failed to save upload consent.");
      }

      await loadBatches({ silent: true });
      setConsentChecked(false);
      setUploadState("done");
      setUploadMessage("Upload contribution consent saved. You can now import CSV lists on the free plan.");
    } catch (error) {
      setUploadState("error");
      setUploadMessage(error instanceof Error ? error.message : "Failed to save upload consent.");
    } finally {
      setRecordingConsent(false);
    }
  }

  async function runAnalysis(batchId: string, action: "run" | "retry_failed") {
    if (!accessToken) return;
    setProcessingBatchId(batchId);
    setBatches((current) =>
      current.map((batch) =>
        batch.batchId === batchId
          ? {
              ...batch,
              status: "analyzing",
              lastError: null
            }
          : batch
      )
    );
    try {
      let keepGoing = true;
      while (keepGoing) {
        const response = await authFetch(accessToken, `/api/imports/${batchId}/analysis`, {
          method: "POST",
          body: JSON.stringify({ action })
        });
        if (!response.ok) {
          const json = await response.json().catch(() => ({ error: "Failed to run premium enrichment." }));
          throw new Error(json.error || "Failed to run premium enrichment.");
        }
        const json = (await response.json()) as ImportBatchAnalysisResponse;
        keepGoing = json.continued;
        applyBatchProgress(batchId, json);
      }
      await loadBatches({ silent: true });
    } catch {
      notify({
        tone: "error",
        title: "Premium enrichment failed",
        message: "Open the batch detail page to inspect the error and retry."
      });
      await loadBatches({ silent: true });
    } finally {
      setProcessingBatchId(null);
    }
  }

  const previewSample = useMemo(() => previewRows.slice(0, 5), [previewRows]);

  return (
    <div className="p-4 md:p-6">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Imports</div>
            <h1 className="mt-2 text-3xl font-semibold text-ink">Upload Manager Lists</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Upload private CSV lists for this organization and start working them right away. Premium enrichment is optional and only appears on plans that include it.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadBatches({ silent: batches.length > 0 })}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-slate-300"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Upload className="h-4 w-4" />
              Upload CSV
            </div>
            <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center transition hover:border-slate-400">
              <FileUp className="h-8 w-8 text-slate-500" />
              <div className="mt-4 text-base font-semibold text-ink">Choose a CSV file</div>
              <div className="mt-1 text-sm text-slate-500">We’ll preview a few rows before import.</div>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
            </label>

            {filename ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                <div className="font-semibold text-ink">{filename}</div>
                <div className="mt-1">{previewRows.length} detected rows</div>
                <div className="mt-1">{headers.length} detected columns</div>
              </div>
            ) : null}

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-ink">List Type</span>
                <select
                  value={listType}
                  onChange={(event) => setListType(event.target.value as ImportBatchListItem["listType"])}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-700"
                >
                  {LIST_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span className="font-semibold text-ink">Visibility</span>
                <select
                  value={visibilityScope}
                  onChange={(event) => {
                    const nextValue = event.target.value as ImportBatchListItem["visibilityScope"];
                    setVisibilityScope(nextValue);
                    if (nextValue !== "team") setAssignedTeamId("");
                    if (nextValue !== "assigned_user") setAssignedUserId("");
                  }}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-700"
                >
                  {VISIBILITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {visibilityScope === "team" ? (
              <label className="mt-4 block space-y-2 text-sm">
                <span className="font-semibold text-ink">Assigned Team</span>
                <select
                  value={assignedTeamId}
                  onChange={(event) => setAssignedTeamId(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-700"
                >
                  <option value="">Choose a team</option>
                  {assignmentOptions.teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {visibilityScope === "assigned_user" ? (
              <label className="mt-4 block space-y-2 text-sm">
                <span className="font-semibold text-ink">Assigned User</span>
                <select
                  value={assignedUserId}
                  onChange={(event) => setAssignedUserId(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-700"
                >
                  <option value="">Choose a user</option>
                  {assignmentOptions.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              <div className="font-semibold text-ink">Active Plan · {formatBillingPlan(access.billingPlan)}</div>
              <div className="mt-2">
                {access.requiresContributionConsent
                  ? access.hasCurrentConsent
                    ? "Free-plan bulk upload is enabled through contributed uploads."
                    : "Free-plan bulk upload requires contribution consent. Imported CSV rows become contributed platform data in exchange for automatic upload and map pinning."
                  : "This plan can upload private organization data without contribution consent."}
              </div>
              <div className="mt-2">
                {canRunPremiumEnrichment
                  ? "Premium enrichment is enabled here when you want solar and scoring data layered onto an uploaded batch."
                  : "This org is on the low-cost upload workflow. Rows import directly without paid solar or premium analysis."}
              </div>
              {access.requiresContributionConsent && !access.hasCurrentConsent ? (
                <div className="mt-4 space-y-3">
                  <label className="flex items-start gap-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={consentChecked}
                      onChange={(event) => setConsentChecked(event.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                    />
                    <span>
                      I understand CSV upload on the free plan is a contributed-data feature and that uploaded lists may be
                      retained, enriched, and used to create shared commercial datasets under the current Terms of Use.
                    </span>
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={!consentChecked || recordingConsent}
                      onClick={() => void handleContributionConsent()}
                      className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {recordingConsent ? "Saving..." : "Enable CSV Upload"}
                    </button>
                    <Link href="/terms" className="text-sm font-medium text-slate-600 underline underline-offset-4">
                      Review terms
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleUpload()}
                disabled={
                  !filename ||
                  !previewRows.length ||
                  uploading ||
                  (access.requiresContributionConsent && !access.hasCurrentConsent) ||
                  (visibilityScope === "team" && !assignedTeamId) ||
                  (visibilityScope === "assigned_user" && !assignedUserId)
                }
                className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {uploading ? "Uploading..." : "Import Rows"}
              </button>
              {uploadState === "done" ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                  {uploadMessage ?? "Import created successfully. Your rows are ready to work now."}
                </div>
              ) : null}
              {uploadState === "error" ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700">
                  {uploadMessage ?? "Upload failed."}
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Database className="h-4 w-4" />
              Preview
            </div>
            {previewSample.length ? (
              <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      {headers.slice(0, 6).map((header) => (
                        <th key={header} className="px-3 py-2 font-semibold text-slate-600">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewSample.map((row, index) => (
                      <tr key={`${index}-${row[headers[0]] ?? "row"}`} className="border-b border-slate-100 last:border-b-0">
                        {headers.slice(0, 6).map((header) => (
                          <td key={header} className="px-3 py-2 text-slate-600">
                            {row[header] || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">
                Upload a CSV to preview the first few rows here.
              </div>
            )}
          </section>
        </div>
      </div>

      <section className="mt-6 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Local Batches</div>
        <div className="mt-4 space-y-3">
          {loading && !batches.length ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Loading import history...
            </div>
          ) : batches.length ? (
            batches.map((batch) => (
              <div key={batch.batchId} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-ink">{batch.filename}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {formatListType(batch.listType)} · {formatVisibility(batch)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">Created {formatDateTime(batch.createdAt)}</div>
                  </div>
                  <div className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${statusTone(batch.status)}`}>
                    {batch.status.replaceAll("_", " ")}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-4 xl:grid-cols-8">
                  {[
                    ["Rows", batch.totalRows],
                    ["Detected", batch.detectedRows],
                    ["Inserted", batch.insertedCount],
                    ["Updated", batch.updatedCount],
                    ["Duplicates", batch.duplicateMatchedCount],
                    ...(canRunPremiumEnrichment
                      ? ([
                          ["Queued", batch.pendingAnalysisCount],
                          ["Running", batch.analyzingCount],
                          ["Enriched", batch.analyzedCount],
                          ["Failed", batch.failedCount]
                        ] as Array<[string, number]>)
                      : [])
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
                      <div className="mt-1 text-base font-semibold text-ink">{value}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={`/imports/${batch.batchId}`}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-slate-300"
                  >
                    View Batch
                  </Link>
                  {canRunPremiumEnrichment ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void runAnalysis(batch.batchId, "run")}
                        disabled={processingBatchId === batch.batchId}
                        className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                      >
                        {processingBatchId === batch.batchId ? "Running..." : "Run Premium Enrichment"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void runAnalysis(batch.batchId, "retry_failed")}
                        disabled={processingBatchId === batch.batchId || batch.failedCount === 0}
                        className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                      >
                        Retry Failed
                      </button>
                    </>
                  ) : (
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
                      Premium enrichment is available on the Intelligence plan.
                    </div>
                  )}
                </div>
                {batch.lastError ? <div className="mt-3 text-sm text-rose-600">{batch.lastError}</div> : null}
              </div>
            ))
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              No import batches yet. Upload your first manager list above.
            </div>
          )}
        </div>
      </section>

      <section className="mt-6 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Shared Active Datasets</div>
        <div className="mt-4 space-y-3">
          {sharedDatasets.length ? (
            sharedDatasets.map((dataset) => (
              <div key={dataset.datasetId} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-ink">{dataset.name}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {formatListType(dataset.listType)} · {formatVisibility(dataset)} · Source {dataset.sourceOrganizationName}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Granted {formatDateTime(dataset.grantedAt)} · {dataset.rowCount} rows
                    </div>
                    {dataset.description ? (
                      <div className="mt-2 text-sm text-slate-600">{dataset.description}</div>
                    ) : null}
                  </div>
                  <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                    {dataset.status}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              No shared datasets are active for this organization yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
