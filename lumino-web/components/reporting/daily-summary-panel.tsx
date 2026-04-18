"use client";

import { useCallback, useEffect, useState } from "react";
import type { ManagerDailySummaryResponse } from "@/types/api";
import { authFetch, useAuth } from "@/lib/auth/client";

export function DailySummaryPanel() {
  const { session } = useAuth();
  const [report, setReport] = useState<ManagerDailySummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const loadReport = useCallback(async () => {
    if (!session?.access_token) return null;
    setLoading(true);
    try {
      const response = await authFetch(session.access_token, "/api/reporting/daily-summary");
      if (!response.ok) return null;
      const json = (await response.json()) as ManagerDailySummaryResponse;
      setReport(json);
      return json;
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  async function handleCopyEmail() {
    if (!report?.emailBody) return;

    try {
      await navigator.clipboard.writeText(`Subject: ${report.emailSubject}\n\n${report.emailBody}`);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Daily Summary</div>
          <h2 className="mt-2 text-xl font-semibold text-ink">
            {loading ? "Generating summary..." : report?.dateLabel ?? "Manager daily summary"}
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            {loading
              ? "Pulling together a manager-ready recap."
              : report?.headline ?? "A concise daily recap will appear here."}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleCopyEmail()}
            disabled={!report?.emailBody}
            className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copyState === "copied" ? "Summary Copied" : "Send Summary"}
          </button>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-500">
            Automation next
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "Active Reps", value: report?.summary.activeReps ?? 0 },
          { label: "Knocks", value: report?.summary.knocksToday ?? 0 },
          { label: "Opportunities", value: report?.summary.opportunitiesToday ?? 0 },
          { label: "Appointments", value: report?.summary.appointmentsToday ?? 0 },
          { label: "Overdue", value: report?.summary.overdueFollowUps ?? 0 },
          { label: "Stale Opps", value: report?.summary.staleOpportunities ?? 0 }
        ].map((item) => (
          <div key={item.label} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">{item.label}</div>
            <div className="mt-2 text-2xl font-semibold text-ink">{loading ? "…" : item.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-ink">Highlights</div>
          <div className="mt-3 space-y-2 text-sm text-slate-600">
            {(report?.highlights ?? []).slice(0, 3).map((item) => (
              <div key={item} className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                {item}
              </div>
            ))}
            {!loading && !(report?.highlights.length ?? 0) ? (
              <div className="text-slate-500">No highlights yet.</div>
            ) : null}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-ink">Risks and focus</div>
          <div className="mt-3 space-y-2 text-sm text-slate-600">
            {(report?.risks ?? []).slice(0, 3).map((item) => (
              <div key={item} className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                {item}
              </div>
            ))}
            {report?.territoryNotes ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                {report.territoryNotes}
              </div>
            ) : null}
            <div className="text-xs uppercase tracking-[0.14em] text-slate-400">
              {copyState === "error" ? "Copy failed" : report?.emailSubject ?? ""}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
