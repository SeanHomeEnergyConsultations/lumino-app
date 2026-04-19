"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, ExternalLink, RefreshCw, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { authFetch, useAuth } from "@/lib/auth/client";
import { ORGANIZATION_BILLING_PLANS } from "@/lib/platform/features";
import type {
  PlatformOrganizationOverviewItem,
  PlatformOverviewResponse,
  PlatformSecurityEventItem,
  PlatformSecurityEventsResponse
} from "@/types/api";

type FeatureDraft = {
  billingPlan: PlatformOrganizationOverviewItem["billingPlan"];
  enrichmentEnabled: boolean | null;
  priorityScoringEnabled: boolean | null;
  advancedImportsEnabled: boolean | null;
  securityConsoleEnabled: boolean | null;
};

function formatDateTime(value: string | null) {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString();
}

function buildInitialDrafts(items: PlatformOrganizationOverviewItem[]) {
  return Object.fromEntries(
    items.map((item) => [
      item.organizationId,
      {
        billingPlan: item.billingPlan,
        enrichmentEnabled: item.featureOverrides.enrichmentEnabled,
        priorityScoringEnabled: item.featureOverrides.priorityScoringEnabled,
        advancedImportsEnabled: item.featureOverrides.advancedImportsEnabled,
        securityConsoleEnabled: item.featureOverrides.securityConsoleEnabled
      } satisfies FeatureDraft
    ])
  ) as Record<string, FeatureDraft>;
}

export function PlatformControlCenterPage() {
  const { session, appContext } = useAuth();
  const canMutate = Boolean(appContext?.isPlatformOwner);
  const [items, setItems] = useState<PlatformOrganizationOverviewItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, FeatureDraft>>({});
  const [events, setEvents] = useState<PlatformSecurityEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>("all");
  const [selectedSeverity, setSelectedSeverity] = useState<string>("all");
  const [selectedEventType, setSelectedEventType] = useState<string>("all");
  const [savingOrgId, setSavingOrgId] = useState<string | null>(null);
  const [navigatingOrgId, setNavigatingOrgId] = useState<string | null>(null);

  async function loadOverview(showSpinner = false) {
    if (!session?.access_token) return;
    if (showSpinner) setLoading(true);
    setError(null);

    const response = await authFetch(session.access_token, "/api/platform/overview", {
      cache: "no-store"
    });
    const json = (await response.json()) as PlatformOverviewResponse | { error?: string };
    if (!response.ok || !("items" in json)) {
      throw new Error(("error" in json && json.error) || "Failed to load platform overview.");
    }

    setItems(json.items);
    setDrafts(buildInitialDrafts(json.items));
  }

  async function loadSecurityEvents() {
    if (!session?.access_token) return;
    const params = new URLSearchParams();
    if (selectedOrganizationId !== "all") params.set("organizationId", selectedOrganizationId);
    if (selectedSeverity !== "all") params.set("severity", selectedSeverity);
    if (selectedEventType !== "all") params.set("eventType", selectedEventType);
    params.set("limit", "80");

    const response = await authFetch(session.access_token, `/api/platform/security-events?${params.toString()}`, {
      cache: "no-store"
    });
    const json = (await response.json()) as PlatformSecurityEventsResponse | { error?: string };
    if (!response.ok || !("items" in json)) {
      throw new Error(("error" in json && json.error) || "Failed to load security events.");
    }

    setEvents(json.items);
  }

  useEffect(() => {
    if (!session?.access_token) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([loadOverview(), loadSecurityEvents()])
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load platform controls.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  useEffect(() => {
    if (!session?.access_token) return;
    loadSecurityEvents().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Failed to refresh security events.");
    });
  }, [selectedOrganizationId, selectedSeverity, selectedEventType, session?.access_token]);

  const eventTypes = useMemo(
    () => [...new Set(events.map((item) => item.eventType))].sort((a, b) => a.localeCompare(b)),
    [events]
  );

  async function switchAndGo(organizationId: string, href: string) {
    if (!session?.access_token) return;
    setMessage(null);
    setError(null);
    setNavigatingOrgId(organizationId);

    try {
      const response = await authFetch(session.access_token, "/api/platform/active-organization", {
        method: "PATCH",
        body: JSON.stringify({ organizationId })
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error || "Failed to switch organizations.");
      }
      window.location.assign(href);
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : "Failed to switch organizations.");
      setNavigatingOrgId(null);
    }
  }

  async function saveOrganization(item: PlatformOrganizationOverviewItem) {
    if (!session?.access_token || !canMutate) return;
    const draft = drafts[item.organizationId];
    if (!draft) return;
    setSavingOrgId(item.organizationId);
    setMessage(null);
    setError(null);

    try {
      const [organizationResponse, featuresResponse] = await Promise.all([
        authFetch(session.access_token, `/api/platform/organizations/${item.organizationId}`, {
          method: "PATCH",
          body: JSON.stringify({ billingPlan: draft.billingPlan })
        }),
        authFetch(session.access_token, `/api/platform/organizations/${item.organizationId}/features`, {
          method: "PATCH",
          body: JSON.stringify({
            enrichmentEnabled: draft.enrichmentEnabled,
            priorityScoringEnabled: draft.priorityScoringEnabled,
            advancedImportsEnabled: draft.advancedImportsEnabled,
            securityConsoleEnabled: draft.securityConsoleEnabled
          })
        })
      ]);

      const organizationJson = (await organizationResponse.json()) as { error?: string };
      const featuresJson = (await featuresResponse.json()) as { error?: string };
      if (!organizationResponse.ok) {
        throw new Error(organizationJson.error || "Failed to update billing plan.");
      }
      if (!featuresResponse.ok) {
        throw new Error(featuresJson.error || "Failed to update organization features.");
      }

      await loadOverview();
      if (selectedOrganizationId === item.organizationId || selectedOrganizationId === "all") {
        await loadSecurityEvents();
      }
      setMessage(`Updated ${item.name}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update organization.");
    } finally {
      setSavingOrgId(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-panel backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-mist">Platform</div>
            <h1 className="mt-3 text-3xl font-semibold text-ink">Control Center</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">
              Manage organizations, package premium intelligence, and watch high-signal security activity without dropping into SQL.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setError(null);
              Promise.all([loadOverview(true), loadSecurityEvents()]).catch((refreshError) => {
                setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh platform data.");
              }).finally(() => setLoading(false));
            }}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {message ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Organizations",
            value: items.length,
            detail: `${items.filter((item) => item.status === "active").length} active`
          },
          {
            label: "Active Team Members",
            value: items.reduce((sum, item) => sum + item.activeTeamMemberCount, 0),
            detail: `${items.reduce((sum, item) => sum + item.adminCount, 0)} admins`
          },
          {
            label: "Completed Imports",
            value: items.reduce((sum, item) => sum + item.completedImportCount, 0),
            detail: `${items.reduce((sum, item) => sum + item.importBatchCount, 0)} total batches`
          },
          {
            label: "Security Events",
            value: events.length,
            detail: `${events.filter((item) => item.severity === "high").length} high severity`
          }
        ].map((metric) => (
          <div key={metric.label} className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">{metric.label}</div>
            <div className="mt-3 text-3xl font-semibold text-ink">{loading ? "…" : metric.value}</div>
            <div className="mt-2 text-sm text-slate-500">{metric.detail}</div>
          </div>
        ))}
      </section>

      <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-panel backdrop-blur">
        <div className="flex items-center gap-3">
          <Building2 className="h-5 w-5 text-slate-500" />
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Organizations</div>
            <p className="mt-1 text-sm text-slate-500">
              Billing plans, feature flags, setup progress, and one-click entry into each org.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {loading ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
              Loading organizations…
            </div>
          ) : items.length ? (
            items.map((item) => {
              const draft = drafts[item.organizationId];
              return (
                <div key={item.organizationId} className="rounded-[1.75rem] border border-slate-200 bg-slate-50/90 p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-lg font-semibold text-ink">{item.name}</div>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                          item.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                        }`}>
                          {item.status}
                        </span>
                        <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
                          {item.billingPlan}
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-slate-500">
                        {item.appName}
                        {item.slug ? ` · ${item.slug}` : ""}
                      </div>
                      <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Team</div>
                          <div className="mt-1">{item.activeTeamMemberCount} active / {item.teamMemberCount} total</div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Imports</div>
                          <div className="mt-1">{item.completedImportCount} completed / {item.importBatchCount} total</div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Territories</div>
                          <div className="mt-1">{item.territoryCount}</div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Last Activity</div>
                          <div className="mt-1">{formatDateTime(item.lastActivityAt)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => switchAndGo(item.organizationId, "/dashboard")}
                        disabled={navigatingOrgId !== null}
                        className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                      >
                        {navigatingOrgId === item.organizationId ? "Switching…" : "Enter Org"}
                      </button>
                      <button
                        type="button"
                        onClick={() => switchAndGo(item.organizationId, "/team")}
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                      >
                        Open Team
                      </button>
                      <button
                        type="button"
                        onClick={() => switchAndGo(item.organizationId, "/imports")}
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                      >
                        Open Imports
                      </button>
                      <button
                        type="button"
                        onClick={() => switchAndGo(item.organizationId, "/dashboard")}
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                      >
                        Open Dashboard
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 xl:grid-cols-[1.2fr,1fr,1fr]">
                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Setup Checklist</div>
                      <div className="mt-3 space-y-3">
                        {[
                          {
                            label: "First admin invited",
                            done: item.checklist.firstAdminInvited,
                            href: "/team"
                          },
                          {
                            label: "Branding configured",
                            done: item.checklist.brandingConfigured,
                            href: "/team"
                          },
                          {
                            label: "First import completed",
                            done: item.checklist.firstImportCompleted,
                            href: "/imports"
                          },
                          {
                            label: "First territory created",
                            done: item.checklist.firstTerritoryCreated,
                            href: "/team"
                          }
                        ].map((check) => (
                          <div key={check.label} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2">
                            <div className="flex items-center gap-2 text-sm text-slate-700">
                              {check.done ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              ) : (
                                <ShieldAlert className="h-4 w-4 text-amber-600" />
                              )}
                              {check.label}
                            </div>
                            {!check.done ? (
                              <button
                                type="button"
                                onClick={() => switchAndGo(item.organizationId, check.href)}
                                className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 transition hover:text-ink"
                              >
                                Fix
                                <ExternalLink className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Plan & Packaging</div>
                      <div className="mt-3">
                        <label className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Billing Plan</label>
                        <select
                          value={draft?.billingPlan ?? item.billingPlan}
                          disabled={!canMutate}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [item.organizationId]: {
                                ...(current[item.organizationId] ?? buildInitialDrafts([item])[item.organizationId]),
                                billingPlan: event.target.value as PlatformOrganizationOverviewItem["billingPlan"]
                              }
                            }))
                          }
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                        >
                          {ORGANIZATION_BILLING_PLANS.map((plan) => (
                            <option key={plan} value={plan}>
                              {plan}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="mt-3 text-sm text-slate-500">
                        Effective preset:
                        <span className="ml-2 font-medium text-slate-700">
                          {item.effectiveFeatures.enrichmentEnabled ? "Enrichment" : "No enrichment"},{" "}
                          {item.effectiveFeatures.priorityScoringEnabled ? "Priority" : "No priority"},{" "}
                          {item.effectiveFeatures.advancedImportsEnabled ? "Advanced imports" : "Basic imports"}
                        </span>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-mist">
                        <Sparkles className="h-4 w-4" />
                        Feature Overrides
                      </div>
                      <div className="mt-3 space-y-3">
                        {[
                          ["enrichmentEnabled", "Enrichment"],
                          ["priorityScoringEnabled", "Priority Scoring"],
                          ["advancedImportsEnabled", "Advanced Imports"],
                          ["securityConsoleEnabled", "Security Console"]
                        ].map(([key, label]) => (
                          <div key={key} className="rounded-2xl bg-slate-50 px-3 py-2">
                            <div className="text-sm font-medium text-slate-700">{label}</div>
                            <div className="mt-2 flex gap-2">
                              {[
                                { value: "inherit", label: "Inherit" },
                                { value: "true", label: "On" },
                                { value: "false", label: "Off" }
                              ].map((option) => {
                                const currentValue = draft?.[key as keyof FeatureDraft];
                                const normalized =
                                  currentValue === null || currentValue === undefined
                                    ? "inherit"
                                    : String(currentValue);
                                const active = normalized === option.value;
                                return (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() =>
                                      canMutate &&
                                      setDrafts((current) => ({
                                        ...current,
                                        [item.organizationId]: {
                                          ...(current[item.organizationId] ?? buildInitialDrafts([item])[item.organizationId]),
                                          [key]:
                                            option.value === "inherit"
                                              ? null
                                              : option.value === "true"
                                                ? true
                                                : false
                                        }
                                      }))
                                    }
                                    disabled={!canMutate}
                                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] transition ${
                                      active
                                        ? "bg-ink text-white"
                                        : "border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
                                    }`}
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => saveOrganization(item)}
                      disabled={savingOrgId === item.organizationId || !canMutate}
                      className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:cursor-wait disabled:opacity-70"
                    >
                      {!canMutate ? "Platform Owner Only" : savingOrgId === item.organizationId ? "Saving…" : "Save Plan & Features"}
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
              No organizations found yet.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-panel backdrop-blur">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-slate-500" />
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Security Events</div>
            <p className="mt-1 text-sm text-slate-500">
              Triage the latest account, import, branding, and rate-limit events across the platform.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <select
            value={selectedOrganizationId}
            onChange={(event) => setSelectedOrganizationId(event.target.value)}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
          >
            <option value="all">All organizations</option>
            {items.map((item) => (
              <option key={item.organizationId} value={item.organizationId}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            value={selectedSeverity}
            onChange={(event) => setSelectedSeverity(event.target.value)}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
          >
            <option value="all">All severity</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="info">Info</option>
          </select>
          <select
            value={selectedEventType}
            onChange={(event) => setSelectedEventType(event.target.value)}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
          >
            <option value="all">All event types</option>
            {eventTypes.map((eventType) => (
              <option key={eventType} value={eventType}>
                {eventType}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-5 space-y-3">
          {events.length ? (
            events.map((event) => (
              <details key={event.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                          event.severity === "high"
                            ? "bg-rose-100 text-rose-700"
                            : event.severity === "medium"
                              ? "bg-amber-100 text-amber-700"
                              : event.severity === "low"
                                ? "bg-sky-100 text-sky-700"
                                : "bg-slate-200 text-slate-700"
                        }`}>
                          {event.severity}
                        </span>
                        <span className="text-sm font-semibold text-ink">{event.eventType}</span>
                      </div>
                      <div className="mt-2 text-sm text-slate-600">
                        {event.organizationName ?? "Platform"} · {event.actorName ?? event.actorEmail ?? "Unknown actor"}
                        {event.targetName || event.targetEmail
                          ? ` → ${event.targetName ?? event.targetEmail}`
                          : ""}
                      </div>
                    </div>
                    <div className="text-sm text-slate-500">{formatDateTime(event.createdAt)}</div>
                  </div>
                </summary>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-2xl bg-white p-3 text-sm text-slate-600">
                    <div><span className="font-semibold text-slate-800">Organization:</span> {event.organizationName ?? "Platform"}</div>
                    <div className="mt-1"><span className="font-semibold text-slate-800">Actor:</span> {event.actorName ?? event.actorEmail ?? "Unknown"}</div>
                    <div className="mt-1"><span className="font-semibold text-slate-800">Target:</span> {event.targetName ?? event.targetEmail ?? "None"}</div>
                    <div className="mt-1"><span className="font-semibold text-slate-800">IP:</span> {event.ipAddress ?? "Unknown"}</div>
                    <div className="mt-1 break-all"><span className="font-semibold text-slate-800">User Agent:</span> {event.userAgent ?? "Unknown"}</div>
                  </div>
                  <pre className="overflow-x-auto rounded-2xl bg-slate-950 p-3 text-xs text-slate-100">
                    {JSON.stringify(event.metadata, null, 2)}
                  </pre>
                </div>
              </details>
            ))
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
              No security events matched these filters.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
