"use client";

import { Sparkles } from "lucide-react";
import {
  toneForDatasetStatus,
  usePlatformWorkspace
} from "@/components/platform/platform-workspace-context";

export function PlatformDatasetsSurface() {
  const {
    canMutate,
    datasets,
    items,
    datasetTargets,
    releasingDatasetId,
    setDatasetTarget,
    releaseDataset,
    revokeDataset
  } = usePlatformWorkspace();

  return (
    <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-panel backdrop-blur">
      <div className="flex items-center gap-3">
        <Sparkles className="h-5 w-5 text-slate-500" />
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Shared Datasets</div>
          <p className="mt-1 text-sm text-slate-500">
            Publish once in the platform source org, then grant access without cloning or reanalyzing customer batches.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {datasets.length ? (
          datasets.map((dataset) => {
            const availableTargets = items.filter((item) => item.organizationId !== dataset.sourceOrganizationId);
            const targetOrganizationId = datasetTargets[dataset.datasetId] ?? availableTargets[0]?.organizationId ?? "";

            return (
              <div key={dataset.datasetId} className="rounded-[1.75rem] border border-slate-200 bg-slate-50/90 p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-lg font-semibold text-ink">{dataset.name}</div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                          dataset.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {dataset.status}
                      </span>
                      <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
                        {dataset.listType.replaceAll("_", " ")}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-slate-500">
                      Source org: {dataset.sourceOrganizationName} · {dataset.rowCount} rows
                    </div>
                    {dataset.description ? <div className="mt-2 text-sm text-slate-600">{dataset.description}</div> : null}
                  </div>

                  <div className="min-w-[18rem] rounded-3xl border border-slate-200 bg-white p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Grant Access</div>
                    <div className="mt-3 flex flex-col gap-3">
                      <select
                        value={targetOrganizationId}
                        disabled={!canMutate || !availableTargets.length}
                        onChange={(event) => setDatasetTarget(dataset.datasetId, event.target.value)}
                        className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                      >
                        {availableTargets.length ? null : <option value="">No target orgs available</option>}
                        {availableTargets.map((item) => (
                          <option key={item.organizationId} value={item.organizationId}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void releaseDataset(dataset.datasetId)}
                        disabled={!canMutate || !targetOrganizationId || releasingDatasetId === dataset.datasetId}
                        className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {releasingDatasetId === dataset.datasetId ? "Saving…" : "Grant Access"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Current Grants</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {dataset.grants.length ? (
                      dataset.grants.map((grant) => (
                        <span
                          key={grant.organizationId}
                          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-700"
                        >
                          {grant.organizationName} ·{" "}
                          {grant.visibilityScope === "organization"
                            ? "manager/admin pool"
                            : grant.visibilityScope === "team"
                              ? grant.assignedTeamName ?? "team"
                              : grant.assignedUserName ?? "assigned user"}{" "}
                          · {grant.status}
                          {canMutate ? (
                            <button
                              type="button"
                              onClick={() => void revokeDataset(dataset.datasetId, grant.organizationId)}
                              className="ml-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-600 underline underline-offset-2"
                            >
                              Revoke
                            </button>
                          ) : null}
                        </span>
                      ))
                    ) : (
                      <div className="text-sm text-slate-500">No orgs have access yet.</div>
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Org Access Status</div>
                  <div className="mt-2 text-xs text-slate-500">
                    Owner-defined packaging status for this shared dataset by organization.
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {dataset.organizationStatuses.map((status) => (
                      <span
                        key={`${dataset.datasetId}-${status.organizationId}`}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] ${toneForDatasetStatus(status.label)}`}
                      >
                        {status.organizationName} · {status.label}
                        {status.matchingTargetCount > 0 ? ` · ${status.matchingTargetCount} targets` : ""}
                      </span>
                    ))}
                  </div>
                  {dataset.coverage.cities.length || dataset.coverage.zips.length ? (
                    <div className="mt-3 text-xs text-slate-500">
                      Coverage:
                      {dataset.coverage.cities.length ? ` Cities: ${dataset.coverage.cities.slice(0, 6).join(", ")}` : ""}
                      {dataset.coverage.cities.length && dataset.coverage.zips.length ? " ·" : ""}
                      {dataset.coverage.zips.length ? ` Zips: ${dataset.coverage.zips.slice(0, 8).join(", ")}` : ""}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
            No shared datasets published yet. Publish a batch from the import detail screen to make it available here.
          </div>
        )}
      </div>
    </section>
  );
}
