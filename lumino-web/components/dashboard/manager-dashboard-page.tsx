"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarCheck2, Layers3, MapPinned, Target, Users } from "lucide-react";
import type { ManagerDashboardResponse } from "@/types/api";
import { authFetch, useAuth } from "@/lib/auth/client";
import { ManagerSupervisionMap } from "@/components/dashboard/manager-supervision-map";
import { DailySummaryPanel } from "@/components/reporting/daily-summary-panel";

function formatDateTime(value: string | null) {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString();
}

function outcomeLabel(value: string | null) {
  if (!value) return "Lead update";
  return value.replaceAll("_", " ");
}

export function ManagerDashboardPage() {
  const { session } = useAuth();
  const [dashboard, setDashboard] = useState<ManagerDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const appointmentConversionRate =
    dashboard?.summary.opportunitiesToday && dashboard.summary.opportunitiesToday > 0
      ? Math.round((dashboard.summary.appointmentsToday / dashboard.summary.opportunitiesToday) * 100)
      : 0;
  const territoryCoverage =
    dashboard?.territories.length
      ? Math.round(
          (dashboard.territories.filter((territory) => territory.health === "strong").length /
            dashboard.territories.length) *
            100
        )
      : 0;

  const loadDashboard = useCallback(async () => {
    if (!session?.access_token) return null;
    setLoading(true);
    try {
      const response = await authFetch(session.access_token, "/api/dashboard/manager");
      if (!response.ok) return null;
      const json = (await response.json()) as ManagerDashboardResponse;
      setDashboard(json);
      return json;
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  return (
    <div className="p-4 md:p-6">
      <DailySummaryPanel />

      <div className="app-panel mt-6 rounded-[2rem] border p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Manager Dashboard</div>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Team operating view</h1>
        <p className="mt-3 max-w-3xl text-sm text-[rgba(var(--app-primary-rgb),0.72)]">
          See who is working, whether field activity is creating real opportunities, and where follow-up is starting to leak.
        </p>

      <div className="mt-6 grid gap-3 md:grid-cols-5">
          {[
            { label: "Active Reps", value: dashboard?.summary.activeReps ?? 0, icon: Users, href: "/follow-up" },
            { label: "Knocks Today", value: dashboard?.summary.knocksToday ?? 0, icon: MapPinned, href: "/map" },
            { label: "Opportunities", value: dashboard?.summary.opportunitiesToday ?? 0, icon: Target, href: "/map?filters=opportunity" },
            { label: "Appointments", value: dashboard?.summary.appointmentsToday ?? 0, icon: CalendarCheck2, href: "/map?filters=appointment_set" },
            { label: "Overdue Follow-Up", value: dashboard?.summary.overdueFollowUps ?? 0, icon: AlertTriangle, href: "/map?filters=follow_up_overdue" }
          ].map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.label} href={item.href as Route} className="app-panel-soft rounded-3xl border p-4 transition hover:border-[rgba(var(--app-primary-rgb),0.18)] hover:brightness-105">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">{item.label}</div>
                  <Icon className="h-4 w-4 text-[rgba(var(--app-primary-rgb),0.56)]" />
                </div>
                <div className="mt-2 text-3xl font-semibold text-ink">{loading ? "…" : item.value}</div>
              </Link>
            );
          })}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {[
            {
              label: "Rep Activity",
              value: `${dashboard?.summary.activeReps ?? 0} live`,
              detail: `${dashboard?.repScorecards.reduce((sum, rep) => sum + rep.knocks, 0) ?? 0} knocks tracked today`
            },
            {
              label: "Follow-Up Aging",
              value: `${dashboard?.leakage.overdueCount ?? 0} overdue`,
              detail: `${dashboard?.leakage.staleOpportunityCount ?? 0} stale opportunities leaking`
            },
            {
              label: "Appointment Conversion",
              value: `${loading ? "…" : appointmentConversionRate}%`,
              detail: `${dashboard?.summary.appointmentsToday ?? 0} appointments from ${dashboard?.summary.opportunitiesToday ?? 0} opportunities`
            },
            {
              label: "Territory Performance",
              value: `${loading ? "…" : territoryCoverage}%`,
              detail: `${dashboard?.territories.filter((territory) => territory.health === "strong").length ?? 0} strong territories in rotation`
            }
          ].map((item) => (
            <div key={item.label} className="app-panel-soft rounded-3xl border p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">{item.label}</div>
              <div className="mt-2 text-2xl font-semibold text-ink">{item.value}</div>
              <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">{item.detail}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <section className="app-panel rounded-[2rem] border p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Manager Alerts</div>
              <p className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.68)]">Immediate issues that need manager attention today.</p>
            </div>
            <div className="app-chip rounded-full px-3 py-1 text-sm font-semibold text-[rgba(var(--app-primary-rgb),0.74)]">
              {dashboard?.alerts.length ?? 0}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {(dashboard?.alerts ?? []).map((alert) => {
              const content = (
                <div
                  className={`rounded-3xl border p-4 ${
                    alert.severity === "high"
                      ? "border-rose-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.24),rgba(255,255,255,0)_34%),rgba(254,226,226,0.82)]"
                        : alert.severity === "medium"
                        ? "border-amber-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.24),rgba(255,255,255,0)_34%),rgba(254,243,199,0.82)]"
                        : "app-panel-soft"
                  }`}
                >
                  <div className="text-sm font-semibold text-ink">{alert.title}</div>
                  <div className="mt-1 text-sm text-[rgba(var(--app-primary-rgb),0.72)]">{alert.body}</div>
                </div>
              );

              return alert.href ? (
                <Link key={alert.id} href={alert.href as Route} className="block">
                  {content}
                </Link>
              ) : (
                <div key={alert.id}>{content}</div>
              );
            })}
            {!loading && !(dashboard?.alerts.length ?? 0) ? (
              <div className="app-panel-soft rounded-3xl border border-dashed p-4 text-sm text-[rgba(var(--app-primary-rgb),0.6)]">
                No active alerts right now.
              </div>
            ) : null}
          </div>
        </section>

        <section className="app-panel rounded-[2rem] border p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Coaching Flags</div>
              <p className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.68)]">Rep-quality and process-discipline signals worth coaching on.</p>
            </div>
            <div className="app-chip rounded-full px-3 py-1 text-sm font-semibold text-[rgba(var(--app-primary-rgb),0.74)]">
              {dashboard?.coachingFlags.length ?? 0}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {(dashboard?.coachingFlags ?? []).map((flag) => (
              <Link key={flag.id} href={flag.href as Route} className="app-panel-soft block rounded-3xl border p-4 transition hover:border-[rgba(var(--app-primary-rgb),0.18)] hover:brightness-105">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-ink">{flag.repName ?? "Rep"}</div>
                    <div className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-[rgba(var(--app-primary-rgb),0.56)]">{flag.reason}</div>
                  </div>
                  <div
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                      flag.severity === "high"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : flag.severity === "medium"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-[rgba(var(--app-primary-rgb),0.12)] bg-[rgba(var(--app-surface-rgb),0.72)] text-[rgba(var(--app-primary-rgb),0.74)]"
                    }`}
                  >
                    {flag.severity}
                  </div>
                </div>
                <div className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.72)]">{flag.detail}</div>
              </Link>
            ))}
            {!loading && !(dashboard?.coachingFlags.length ?? 0) ? (
              <div className="app-panel-soft rounded-3xl border border-dashed p-4 text-sm text-[rgba(var(--app-primary-rgb),0.6)]">
                No coaching flags right now.
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <div className="mt-6">
        <ManagerSupervisionMap points={dashboard?.supervisionMap ?? []} repPresence={dashboard?.repPresence ?? []} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section className="app-panel rounded-[2rem] border p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Rep Performance</div>
              <p className="mt-2 text-sm text-slate-500">Today’s rep activity, output, and follow-up ownership.</p>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.14em] text-slate-500">
                <tr>
                  <th className="pb-3 pr-4 font-semibold">Rep</th>
                  <th className="pb-3 pr-4 font-semibold">Knocks</th>
                  <th className="pb-3 pr-4 font-semibold">Not Home</th>
                  <th className="pb-3 pr-4 font-semibold">Doorhangers</th>
                  <th className="pb-3 pr-4 font-semibold">Opps</th>
                  <th className="pb-3 pr-4 font-semibold">Appts</th>
                  <th className="pb-3 pr-4 font-semibold">Opp Rate</th>
                  <th className="pb-3 pr-4 font-semibold">Overdue</th>
                  <th className="pb-3 font-semibold">Active Window</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {(dashboard?.repScorecards ?? []).map((rep) => (
                  <tr key={rep.userId}>
                    <td className="py-3 pr-4">
                      <div className="font-semibold text-ink">{rep.fullName ?? rep.email ?? "Unknown rep"}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">{rep.role}</div>
                    </td>
                    <td className="py-3 pr-4">{rep.knocks}</td>
                    <td className="py-3 pr-4">{rep.notHome}</td>
                    <td className="py-3 pr-4">{rep.doorhangers}</td>
                    <td className="py-3 pr-4">{rep.opportunities}</td>
                    <td className="py-3 pr-4">{rep.appointments}</td>
                    <td className="py-3 pr-4">{rep.opportunityRate}%</td>
                    <td className="py-3 pr-4">{rep.overdueFollowUps}</td>
                    <td className="py-3">
                      <div>{rep.activeWindowMinutes ? `${rep.activeWindowMinutes} min` : "—"}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Link
                          href={`/follow-up?ownerId=${rep.userId}&repName=${encodeURIComponent(rep.fullName ?? rep.email ?? "Rep")}` as Route}
                          className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 transition hover:border-slate-300"
                        >
                          Follow Up
                        </Link>
                        <Link
                          href={`/map?ownerId=${rep.userId}` as Route}
                          className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 transition hover:border-slate-300"
                        >
                          Map
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && !(dashboard?.repScorecards.length ?? 0) ? (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-slate-500">
                      No rep activity yet for this organization.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-6">
          <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Neighborhood Performance</div>
                <p className="mt-2 text-sm text-slate-500">Where today’s field effort is creating momentum or stalling out.</p>
              </div>
              <Layers3 className="h-4 w-4 text-slate-500" />
            </div>

            <div className="mt-4 space-y-3">
              {(dashboard?.neighborhoods ?? []).map((neighborhood) => (
                <Link
                  key={`${neighborhood.city ?? "Unknown"}-${neighborhood.state ?? ""}`}
                  href={`/map?city=${encodeURIComponent(neighborhood.city ?? "")}&state=${encodeURIComponent(neighborhood.state ?? "")}` as Route}
                  className="block rounded-3xl border border-slate-200 bg-slate-50 p-4 transition hover:border-slate-300 hover:bg-white"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-ink">
                        {[neighborhood.city, neighborhood.state].filter(Boolean).join(", ") || "Unknown area"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {neighborhood.knocks} knocks · {neighborhood.opportunities} opps · {neighborhood.appointments} appointments
                      </div>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {neighborhood.opportunityRate}% opp rate
                    </div>
                  </div>
                </Link>
              ))}
              {!loading && !(dashboard?.neighborhoods.length ?? 0) ? (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  No neighborhood patterns yet for today.
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Territory Summary</div>
                <p className="mt-2 text-sm text-slate-500">Territory-level coverage using the assignments already in the CRM.</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              {(dashboard?.territories ?? []).map((territory) => (
                <div key={territory.territoryId} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-ink">{territory.name}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">{territory.status}</div>
                    </div>
                    <div
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                        territory.health === "strong"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : territory.health === "mixed"
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      {territory.propertyCount} props
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
                    <div>{territory.knocksToday} knocks</div>
                    <div>{territory.opportunitiesToday} opps</div>
                    <div>{territory.appointmentsToday} appts</div>
                  </div>
                </div>
              ))}
              {!loading && !(dashboard?.territories.length ?? 0) ? (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  No territories configured yet.
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Live Activity Feed</div>
            <div className="mt-4 space-y-3">
              {(dashboard?.recentActivity ?? []).map((item) => (
                <div key={item.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-ink">{item.address}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {item.actorName ?? "Unknown rep"} · {outcomeLabel(item.outcome ?? item.leadStatus)}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500">{formatDateTime(item.createdAt)}</div>
                  </div>
                </div>
              ))}
              {!loading && !(dashboard?.recentActivity.length ?? 0) ? (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  No recent activity yet.
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Neighborhood Yield Over Time</div>
                <p className="mt-2 text-sm text-slate-500">Today versus the trailing 7-day neighborhood average.</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {(dashboard?.neighborhoodTrends ?? []).map((item) => (
                <div
                  key={`${item.city ?? "Unknown"}-${item.state ?? ""}-trend`}
                  className="rounded-3xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-ink">
                        {[item.city, item.state].filter(Boolean).join(", ") || "Unknown area"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Today: {item.todayKnocks} knocks / {item.todayOpportunities} opps
                      </div>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <div>7d avg knocks: {item.trailingAvgKnocks}</div>
                      <div>7d avg opps: {item.trailingAvgOpportunities}</div>
                    </div>
                  </div>
                </div>
              ))}
              {!loading && !(dashboard?.neighborhoodTrends.length ?? 0) ? (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  Not enough history yet for neighborhood comparisons.
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Follow-Up Leakage</div>
                <p className="mt-2 text-sm text-slate-500">
                  Opportunities without next steps and follow-up that is already overdue.
                </p>
              </div>
              <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
                {(dashboard?.leakage.overdueCount ?? 0) + (dashboard?.leakage.staleOpportunityCount ?? 0)}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Overdue</div>
                <div className="mt-2 text-2xl font-semibold text-ink">{loading ? "…" : dashboard?.leakage.overdueCount ?? 0}</div>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Stale Opportunities</div>
                <div className="mt-2 text-2xl font-semibold text-ink">
                  {loading ? "…" : dashboard?.leakage.staleOpportunityCount ?? 0}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {(dashboard?.leakage.items ?? []).map((item) => (
                <div key={`${item.leakageReason}-${item.leadId}`} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-ink">{item.address}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {item.leakageReason === "stale_opportunity" ? "No next step set" : "Overdue follow-up"} ·{" "}
                    {item.leadStatus ?? "Unknown stage"}
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    Last activity: {formatDateTime(item.lastActivityAt)} · Next follow-up: {formatDateTime(item.nextFollowUpAt)}
                  </div>
                </div>
              ))}
              {!loading && !(dashboard?.leakage.items.length ?? 0) ? (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  No leakage signals right now.
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
