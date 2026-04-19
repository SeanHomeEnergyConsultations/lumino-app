"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type {
  ImportAssignmentOption,
  ImportBatchAnalysisResponse,
  ImportBatchDetailResponse,
  ImportsResponse
} from "@/types/api";
import { authFetch, useAuth } from "@/lib/auth/client";

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

function formatDateTime(value: string | null) {
  if (!value) return "Not available";
  return new Date(value).toLocaleString();
}

function formatListType(value: string) {
  return value.replaceAll("_", " ");
}

function formatVisibility(batch: {
  visibilityScope: string;
  assignedTeamName: string | null;
  assignedUserName: string | null;
}) {
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
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "analyzing":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "completed_with_errors":
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

export function ImportBatchDetailPage({ batchId }: { batchId: string }) {
  const { session, appContext } = useAuth();
  const accessToken = session?.access_token ?? null;
  const [batch, setBatch] = useState<ImportBatchDetailResponse["item"] | null>(null);
  const [assignmentOptions, setAssignmentOptions] = useState<{ teams: ImportAssignmentOption[]; users: ImportAssignmentOption[] }>({
    teams: [],
    users: []
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [running, setRunning] = useState<"idle" | "running" | "retrying">("idle");
  const [savingScope, setSavingScope] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [listType, setListType] = useState<string>("general_canvass_list");
  const [visibilityScope, setVisibilityScope] = useState<string>("organization");
  const [assignedTeamId, setAssignedTeamId] = useState<string>("");
  const [assignedUserId, setAssignedUserId] = useState<string>("");

  const loadBatch = useCallback(async (options?: { silent?: boolean }) => {
    if (!accessToken) return;
    const silent = options?.silent ?? false;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const response = await authFetch(accessToken, `/api/imports/${batchId}?page=${page}&pageSize=100`);
      if (!response.ok) throw new Error("Failed to load import batch.");
      const json = (await response.json()) as ImportBatchDetailResponse;
      setBatch(json.item);
      setListType(json.item.listType);
      setVisibilityScope(json.item.visibilityScope);
      setAssignedTeamId(json.item.assignedTeamId ?? "");
      setAssignedUserId(json.item.assignedUserId ?? "");
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [accessToken, batchId, page]);

  useEffect(() => {
    void loadBatch();
  }, [loadBatch]);

  useEffect(() => {
    if (!accessToken) return;
    authFetch(accessToken, "/api/imports")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as ImportsResponse;
      })
      .then((json) => {
        if (json?.options) {
          setAssignmentOptions(json.options);
        }
      });
  }, [accessToken]);

  useEffect(() => {
    if (!batch || running !== "idle") return;
    if (!["ready_for_analysis", "analyzing"].includes(batch.status)) return;

    const interval = window.setInterval(() => {
      void loadBatch({ silent: true });
    }, 3000);

    return () => window.clearInterval(interval);
  }, [batch, loadBatch, running]);

  async function runAnalysis(action: "run" | "retry_failed") {
    if (!accessToken) return;
    setRunning(action === "retry_failed" ? "retrying" : "running");
    try {
      let keepGoing = true;
      while (keepGoing) {
        const response = await authFetch(accessToken, `/api/imports/${batchId}/analysis`, {
          method: "POST",
          body: JSON.stringify({ action })
        });
        if (!response.ok) {
          const json = await response.json().catch(() => ({ error: "Failed to analyze import batch." }));
          throw new Error(json.error || "Failed to analyze import batch.");
        }
        const json = (await response.json()) as ImportBatchAnalysisResponse;
        keepGoing = json.continued;
      }
      await loadBatch({ silent: true });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to analyze import batch.");
    } finally {
      setRunning("idle");
    }
  }

  async function saveScope() {
    if (!accessToken || !batch) return;
    setSavingScope(true);
    try {
      const response = await authFetch(accessToken, `/api/imports/${batchId}`, {
        method: "PATCH",
        body: JSON.stringify({
          listType,
          visibilityScope,
          assignedTeamId: visibilityScope === "team" ? assignedTeamId || null : null,
          assignedUserId: visibilityScope === "assigned_user" ? assignedUserId || null : null
        })
      });
      if (!response.ok) {
        const json = await response.json().catch(() => ({ error: "Failed to save batch scope." }));
        throw new Error(json.error || "Failed to save batch scope.");
      }
      const json = (await response.json()) as ImportBatchDetailResponse;
      setBatch(json.item);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to save batch scope.");
    } finally {
      setSavingScope(false);
    }
  }

  async function publishDataset() {
    if (!accessToken || !batch) return;
    setPublishing(true);
    try {
      const response = await authFetch(accessToken, "/api/platform/datasets", {
        method: "POST",
        body: JSON.stringify({
          batchId,
          name: batch.filename
        })
      });
      const json = await response.json().catch(() => ({ error: "Failed to publish platform dataset." }));
      if (!response.ok) {
        throw new Error(json.error || "Failed to publish platform dataset.");
      }
      window.alert("Published this batch as a platform dataset.");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to publish platform dataset.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="p-4 md:p-6">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Import Batch</div>
            <h1 className="mt-2 text-3xl font-semibold text-ink">
              {loading ? "Loading batch..." : batch?.filename ?? "Import batch"}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Review imported row status, analysis progress, and retry failures from one place.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/imports"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-slate-300"
            >
              Back to Imports
            </Link>
            <button
              type="button"
              onClick={() => void loadBatch({ silent: Boolean(batch) })}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-slate-300"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => void runAnalysis("run")}
              disabled={running !== "idle"}
              className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {running === "running" ? "Running..." : "Run Analysis"}
            </button>
            <button
              type="button"
              onClick={() => void runAnalysis("retry_failed")}
              disabled={running !== "idle"}
              className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
            >
              {running === "retrying" ? "Retrying..." : "Retry Failed Rows"}
            </button>
            {appContext?.isPlatformOwner ? (
              <button
                type="button"
                onClick={() => void publishDataset()}
                disabled={publishing}
                className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-100 disabled:opacity-60"
              >
                {publishing ? "Publishing..." : "Publish Dataset"}
              </button>
            ) : null}
          </div>
        </div>

        {batch ? (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${statusTone(batch.status)}`}>
                {batch.status.replaceAll("_", " ")}
              </div>
              <div className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
                {formatListType(batch.listType)}
              </div>
              <div className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
                {formatVisibility(batch)}
              </div>
              <div className="text-sm text-slate-500">Created {formatDateTime(batch.createdAt)}</div>
              <div className="text-sm text-slate-500">Started {formatDateTime(batch.startedAt)}</div>
              <div className="text-sm text-slate-500">Completed {formatDateTime(batch.completedAt)}</div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              {[
                ["Rows", batch.totalRows],
                ["Pending", batch.pendingAnalysisCount],
                ["Analyzing", batch.analyzingCount],
                ["Analyzed", batch.analyzedCount],
                ["Failed", batch.failedCount],
                ["Duplicates", batch.duplicateMatchedCount]
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
                  <div className="mt-2 text-lg font-semibold text-ink">{value}</div>
                </div>
              ))}
            </div>

            {batch.lastError ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {batch.lastError}
              </div>
            ) : null}

            <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Batch Scope</div>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <label className="space-y-2 text-sm">
                  <span className="font-semibold text-ink">List Type</span>
                  <select
                    value={listType}
                    onChange={(event) => setListType(event.target.value)}
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
                      const next = event.target.value;
                      setVisibilityScope(next);
                      if (next !== "team") setAssignedTeamId("");
                      if (next !== "assigned_user") setAssignedUserId("");
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

                {visibilityScope === "team" ? (
                  <label className="space-y-2 text-sm">
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
                  <label className="space-y-2 text-sm">
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
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => void saveScope()}
                  disabled={
                    savingScope ||
                    (visibilityScope === "team" && !assignedTeamId) ||
                    (visibilityScope === "assigned_user" && !assignedUserId)
                  }
                  className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  {savingScope ? "Saving..." : "Save Scope"}
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <div>
                Showing rows {(batch.page - 1) * batch.pageSize + 1}-
                {Math.min(batch.page * batch.pageSize, batch.totalItems)} of {batch.totalItems}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={batch.page <= 1}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-slate-300 disabled:opacity-50"
                >
                  Previous
                </button>
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Page {batch.page} of {batch.totalPages}
                </div>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(batch.totalPages, current + 1))}
                  disabled={batch.page >= batch.totalPages}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-slate-300 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <section className="mt-6 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Rows</div>
        <div className="mt-4 space-y-3">
          {loading ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Loading rows...
            </div>
          ) : batch?.items.length ? (
            batch.items.map((item) => (
              <div key={item.itemId} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-ink">
                      Row {item.sourceRowNumber ?? "?"} · {item.rawAddress ?? "Unknown address"}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Ingest: {item.ingestStatus.replaceAll("_", " ")} · Analysis: {item.analysisStatus.replaceAll("_", " ")}
                    </div>
                  </div>
                  <div className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${statusTone(item.analysisStatus)}`}>
                    {item.analysisStatus.replaceAll("_", " ")}
                  </div>
                </div>
                {item.analysisError ? (
                  <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {item.analysisError}
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              No row details are available for this batch yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
