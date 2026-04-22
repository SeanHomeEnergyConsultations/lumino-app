"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, ChevronDown, ExternalLink, RefreshCw, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { authFetch, useAuth } from "@/lib/auth/client";
import { AppBrandingEditor } from "@/components/platform/app-branding-editor";
import { parseDatasetEntitlementInput } from "@/lib/platform/dataset-entitlements";
import { ORGANIZATION_BILLING_PLANS } from "@/lib/platform/features";
import type {
  PlatformDatasetItem,
  PlatformDatasetsResponse,
  PlatformOrganizationDatasetEntitlements,
  PlatformOrganizationOverviewItem,
  PlatformOverviewResponse,
  PlatformSecurityEventItem,
  PlatformSecurityEventsResponse
} from "@/types/api";

type DatasetEntitlementDraft = {
  sold_properties: { cities: string; zips: string };
  solar_permits: { cities: string; zips: string };
  roofing_permits: { cities: string; zips: string };
};

type FeatureDraft = {
  name: string;
  slug: string;
  billingPlan: PlatformOrganizationOverviewItem["billingPlan"];
  enrichmentEnabled: boolean | null;
  priorityScoringEnabled: boolean | null;
  advancedImportsEnabled: boolean | null;
  securityConsoleEnabled: boolean | null;
  datasetEntitlements: DatasetEntitlementDraft;
};

function formatBillingPlan(plan: PlatformOrganizationOverviewItem["billingPlan"]) {
  if (plan === "free") return "Free";
  if (plan === "starter") return "Starter";
  if (plan === "pro") return "Pro";
  return "Intelligence";
}

function getOrganizationSaveLabel(item: PlatformOrganizationOverviewItem, canMutate: boolean, saving: boolean) {
  if (item.isPlatformSource) return "Platform Source Locked";
  if (!canMutate) return "Platform Owner Only";
  if (saving) return "Saving…";
  return "Save Plan & Features";
}

function formatDateTime(value: string | null) {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString();
}

function entitlementsToDraft(input: PlatformOrganizationDatasetEntitlements): DatasetEntitlementDraft {
  return {
    sold_properties: {
      cities: input.sold_properties.cities.join(", "),
      zips: input.sold_properties.zips.join(", ")
    },
    solar_permits: {
      cities: input.solar_permits.cities.join(", "),
      zips: input.solar_permits.zips.join(", ")
    },
    roofing_permits: {
      cities: input.roofing_permits.cities.join(", "),
      zips: input.roofing_permits.zips.join(", ")
    }
  };
}

function draftToEntitlements(input: DatasetEntitlementDraft): PlatformOrganizationDatasetEntitlements {
  return {
    sold_properties: {
      cities: parseDatasetEntitlementInput(input.sold_properties.cities, "city"),
      zips: parseDatasetEntitlementInput(input.sold_properties.zips, "zip")
    },
    solar_permits: {
      cities: parseDatasetEntitlementInput(input.solar_permits.cities, "city"),
      zips: parseDatasetEntitlementInput(input.solar_permits.zips, "zip")
    },
    roofing_permits: {
      cities: parseDatasetEntitlementInput(input.roofing_permits.cities, "city"),
      zips: parseDatasetEntitlementInput(input.roofing_permits.zips, "zip")
    }
  };
}

function buildInitialDrafts(items: PlatformOrganizationOverviewItem[]) {
  return Object.fromEntries(
    items.map((item) => [
      item.organizationId,
      {
        name: item.name,
        slug: item.slug ?? "",
        billingPlan: item.billingPlan,
        enrichmentEnabled: item.featureOverrides.enrichmentEnabled,
        priorityScoringEnabled: item.featureOverrides.priorityScoringEnabled,
        advancedImportsEnabled: item.featureOverrides.advancedImportsEnabled,
        securityConsoleEnabled: item.featureOverrides.securityConsoleEnabled,
        datasetEntitlements: entitlementsToDraft(item.datasetEntitlements)
      } satisfies FeatureDraft
    ])
  ) as Record<string, FeatureDraft>;
}

function toneForDatasetStatus(label: PlatformDatasetItem["organizationStatuses"][number]["label"]) {
  if (label === "Platform Source") return "bg-slate-900 text-white";
  if (label === "Included by Intelligence") return "bg-emerald-100 text-emerald-700";
  if (label === "Marketplace Eligible") return "bg-sky-100 text-sky-700";
  return "bg-slate-200 text-slate-700";
}

function summarizeEffectivePreset(item: PlatformOrganizationOverviewItem) {
  if (item.isPlatformSource) {
    return "Platform source with every premium data and intelligence feature enabled.";
  }
  if (item.billingPlan === "intelligence") {
    return "Low-cost upload plus premium enrichment, bulk solar, clustering, marketplace, and planning.";
  }
  if (item.billingPlan === "pro") {
    return "Low-cost upload workflow with teams, tasks, territories, and solar-related access, but no premium enrichment.";
  }
  if (item.billingPlan === "starter") {
    return "Low-cost upload workflow with core CRM and appointments only.";
  }
  return "Entry workflow with low-cost uploads and no premium enrichment.";
}

function effectivePresetBadges(item: PlatformOrganizationOverviewItem) {
  const features = item.effectiveFeatures;
  return [
    features.selfImportsEnabled ? "Upload-first imports" : "No imports",
    features.importEnrichmentEnabled ? "Premium enrichment" : "No premium enrichment",
    features.bulkSolarEnrichmentEnabled ? "Bulk solar" : "No bulk solar",
    features.clusterAnalysisEnabled ? "Cluster analysis" : "No clustering",
    features.premiumRoutingInsightsEnabled ? "Routing insights" : "No routing insights",
    features.datasetMarketplaceEnabled ? "Marketplace" : "No marketplace"
  ];
}

export function PlatformControlCenterPage() {
  const { session, appContext } = useAuth();
  const canMutate = Boolean(appContext?.isPlatformOwner);
  const [items, setItems] = useState<PlatformOrganizationOverviewItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, FeatureDraft>>({});
  const [events, setEvents] = useState<PlatformSecurityEventItem[]>([]);
  const [datasets, setDatasets] = useState<PlatformDatasetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>("all");
  const [selectedSeverity, setSelectedSeverity] = useState<string>("all");
  const [selectedEventType, setSelectedEventType] = useState<string>("all");
  const [savingOrgId, setSavingOrgId] = useState<string | null>(null);
  const [navigatingOrgId, setNavigatingOrgId] = useState<string | null>(null);
  const [releasingDatasetId, setReleasingDatasetId] = useState<string | null>(null);
  const [sendingTestAlert, setSendingTestAlert] = useState(false);
  const [datasetTargets, setDatasetTargets] = useState<Record<string, string>>({});
  const [expandedSections, setExpandedSections] = useState({
    organizations: true,
    datasets: false,
    security: false
  });
  const [expandedOrganizations, setExpandedOrganizations] = useState<Record<string, boolean>>({});

  function jumpToSection(sectionId: string) {
    if (sectionId === "platform-organizations") {
      setExpandedSections((current) => ({ ...current, organizations: true }));
    } else if (sectionId === "platform-datasets") {
      setExpandedSections((current) => ({ ...current, datasets: true }));
    } else if (sectionId === "platform-security-events") {
      setExpandedSections((current) => ({ ...current, security: true }));
    }
    if (typeof document === "undefined") return;
    window.setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
  }

  function toggleOrganization(organizationId: string) {
    setExpandedOrganizations((current) => ({
      ...current,
      [organizationId]: !(current[organizationId] ?? false)
    }));
  }

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

  async function loadDatasets() {
    if (!session?.access_token) return;
    const response = await authFetch(session.access_token, "/api/platform/datasets", {
      cache: "no-store"
    });
    const json = (await response.json()) as PlatformDatasetsResponse | { error?: string };
    if (!response.ok || !("items" in json)) {
      throw new Error(("error" in json && json.error) || "Failed to load platform datasets.");
    }

    setDatasets(json.items);
    setDatasetTargets((current) => {
      const next = { ...current };
      for (const dataset of json.items) {
        if (!next[dataset.datasetId]) {
          next[dataset.datasetId] =
            items.find((organization) => organization.organizationId !== dataset.sourceOrganizationId)?.organizationId ?? "";
        }
      }
      return next;
    });
  }

  useEffect(() => {
    if (!session?.access_token) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([loadOverview(), loadSecurityEvents(), loadDatasets()])
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

  useEffect(() => {
    if (!items.length || !datasets.length) return;
    setDatasetTargets((current) => {
      const next = { ...current };
      let changed = false;
      for (const dataset of datasets) {
        if (!next[dataset.datasetId]) {
          const fallbackTarget = items.find((organization) => organization.organizationId !== dataset.sourceOrganizationId)?.organizationId;
          if (fallbackTarget) {
            next[dataset.datasetId] = fallbackTarget;
            changed = true;
          }
        }
      }
      return changed ? next : current;
    });
  }, [datasets, items]);

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
      const [organizationResponse, featuresResponse, entitlementsResponse] = await Promise.all([
        authFetch(session.access_token, `/api/platform/organizations/${item.organizationId}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: draft.name,
            slug: draft.slug.trim() || null,
            billingPlan: draft.billingPlan
          })
        }),
        authFetch(session.access_token, `/api/platform/organizations/${item.organizationId}/features`, {
          method: "PATCH",
          body: JSON.stringify({
            enrichmentEnabled: draft.enrichmentEnabled,
            priorityScoringEnabled: draft.priorityScoringEnabled,
            advancedImportsEnabled: draft.advancedImportsEnabled,
            securityConsoleEnabled: draft.securityConsoleEnabled
          })
        }),
        authFetch(session.access_token, `/api/platform/organizations/${item.organizationId}/dataset-entitlements`, {
          method: "PATCH",
          body: JSON.stringify(draftToEntitlements(draft.datasetEntitlements))
        })
      ]);

      const organizationJson = (await organizationResponse.json()) as { error?: string };
      const featuresJson = (await featuresResponse.json()) as { error?: string };
      const entitlementsJson = (await entitlementsResponse.json()) as { error?: string };
      if (!organizationResponse.ok) {
        throw new Error(organizationJson.error || "Failed to update billing plan.");
      }
      if (!featuresResponse.ok) {
        throw new Error(featuresJson.error || "Failed to update organization features.");
      }
      if (!entitlementsResponse.ok) {
        throw new Error(entitlementsJson.error || "Failed to update marketplace entitlements.");
      }

      await Promise.all([loadOverview(), loadDatasets()]);
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

  async function releaseDataset(datasetId: string) {
    if (!session?.access_token) return;
    const organizationId = datasetTargets[datasetId];
    if (!organizationId) return;
    setReleasingDatasetId(datasetId);
    setMessage(null);
    setError(null);

    try {
      const response = await authFetch(session.access_token, `/api/platform/datasets/${datasetId}/grants`, {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          visibilityScope: "organization"
        })
      });
      const json = await response.json().catch(() => ({ error: "Failed to release dataset." }));
      if (!response.ok) {
        throw new Error(json.error || "Failed to release dataset.");
      }

      await Promise.all([loadOverview(), loadDatasets()]);
      setMessage("Granted dataset access to the selected organization.");
    } catch (releaseError) {
      setError(releaseError instanceof Error ? releaseError.message : "Failed to release dataset.");
    } finally {
      setReleasingDatasetId(null);
    }
  }

  async function revokeDataset(datasetId: string, organizationId: string) {
    if (!session?.access_token || !canMutate) return;
    setReleasingDatasetId(datasetId);
    setMessage(null);
    setError(null);
    try {
      const response = await authFetch(session.access_token, `/api/platform/datasets/${datasetId}/grants`, {
        method: "PATCH",
        body: JSON.stringify({
          organizationId,
          status: "revoked",
          visibilityScope: "organization"
        })
      });
      const json = await response.json().catch(() => ({ error: "Failed to revoke dataset access." }));
      if (!response.ok) {
        throw new Error(json.error || "Failed to revoke dataset access.");
      }
      await Promise.all([loadOverview(), loadDatasets()]);
      setMessage("Revoked dataset access for that organization.");
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Failed to revoke dataset access.");
    } finally {
      setReleasingDatasetId(null);
    }
  }

  async function sendTestSecurityAlert() {
    if (!session?.access_token || !canMutate) return;
    setSendingTestAlert(true);
    setMessage(null);
    setError(null);

    try {
      const response = await authFetch(session.access_token, "/api/platform/security-events", {
        method: "POST"
      });
      const json = (await response.json().catch(() => ({ error: "Failed to send test alert." }))) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error || "Failed to send test alert.");
      }

      await loadSecurityEvents();
      setMessage("Sent a controlled high-severity test alert. Check Slack and the security event feed.");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to send test alert.");
    } finally {
      setSendingTestAlert(false);
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
              Promise.all([loadOverview(true), loadSecurityEvents(), loadDatasets()]).catch((refreshError) => {
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

      {canMutate ? <AppBrandingEditor /> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Organizations",
            value: items.length,
            detail: `${items.filter((item) => item.status === "active").length} active`,
            targetId: "platform-organizations"
          },
          {
            label: "Active Team Members",
            value: items.reduce((sum, item) => sum + item.activeTeamMemberCount, 0),
            detail: `${items.reduce((sum, item) => sum + item.adminCount, 0)} admins`,
            targetId: "platform-organizations"
          },
          {
            label: "Completed Imports",
            value: items.reduce((sum, item) => sum + item.completedImportCount, 0),
            detail: `${items.reduce((sum, item) => sum + item.importBatchCount, 0)} total batches`,
            targetId: "platform-organizations"
          },
          {
            label: "Security Events",
            value: events.length,
            detail: `${events.filter((item) => item.severity === "high").length} high severity`,
            targetId: "platform-security-events"
          }
        ].map((metric) => (
          <button
            key={metric.label}
            type="button"
            onClick={() => jumpToSection(metric.targetId)}
            className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 text-left shadow-panel backdrop-blur transition hover:border-slate-300 hover:bg-slate-50"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">{metric.label}</div>
            <div className="mt-3 text-3xl font-semibold text-ink">{loading ? "…" : metric.value}</div>
            <div className="mt-2 text-sm text-slate-500">{metric.detail}</div>
          </button>
        ))}
      </section>

      <section
        id="platform-organizations"
        className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-panel backdrop-blur"
      >
        <button
          type="button"
          onClick={() => setExpandedSections((current) => ({ ...current, organizations: !current.organizations }))}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-3">
            <Building2 className="h-5 w-5 text-slate-500" />
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Organizations</div>
              <p className="mt-1 text-sm text-slate-500">
                Billing plans, feature flags, setup progress, and one-click entry into each org.
              </p>
            </div>
          </div>
          <ChevronDown
            className={`h-5 w-5 text-slate-400 transition ${expandedSections.organizations ? "rotate-180" : ""}`}
          />
        </button>

        {expandedSections.organizations ? (
          <div className="mt-5 space-y-4">
            {loading ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                Loading organizations…
              </div>
            ) : items.length ? (
              items.map((item) => {
              const draft = drafts[item.organizationId];
              const platformLocked = item.isPlatformSource;
              const isExpanded = expandedOrganizations[item.organizationId] ?? false;
              return (
                <div key={item.organizationId} className="rounded-[1.75rem] border border-slate-200 bg-slate-50/90 p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <button
                      type="button"
                      onClick={() => toggleOrganization(item.organizationId)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-lg font-semibold text-ink">{item.name}</div>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                          item.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                        }`}>
                          {item.status}
                        </span>
                        <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
                          {formatBillingPlan(item.billingPlan)}
                        </span>
                        {item.isPlatformSource ? (
                          <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
                            Platform Source
                          </span>
                        ) : null}
                        <ChevronDown
                          className={`ml-auto h-5 w-5 text-slate-400 transition ${isExpanded ? "rotate-180" : ""}`}
                        />
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
                    </button>

                    <div className="flex flex-wrap gap-2 xl:pl-4">
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

                  {isExpanded ? (
                  <>
                  {item.isPlatformSource ? (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600">
                      This organization is locked as the platform source org. Shared datasets are published from here, and customer plan controls do not apply.
                    </div>
                  ) : null}

                  <div className="mt-5 grid gap-4 xl:grid-cols-[1fr,1fr,1fr,1fr,1.1fr]">
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
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Organization</div>
                      <div className="mt-3 space-y-3">
                        <div>
                          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Name</label>
                          <input
                            type="text"
                            value={draft?.name ?? item.name}
                            disabled={!canMutate}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [item.organizationId]: {
                                  ...(current[item.organizationId] ?? buildInitialDrafts([item])[item.organizationId]),
                                  name: event.target.value
                                }
                              }))
                            }
                            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Slug</label>
                          <input
                            type="text"
                            value={draft?.slug ?? item.slug ?? ""}
                            disabled={!canMutate}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [item.organizationId]: {
                                  ...(current[item.organizationId] ?? buildInitialDrafts([item])[item.organizationId]),
                                  slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-")
                                }
                              }))
                            }
                            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Plan & Packaging</div>
                      <div className="mt-3">
                        <label className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Billing Plan</label>
                        <select
                          value={draft?.billingPlan ?? item.billingPlan}
                          disabled={!canMutate || platformLocked}
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
                              {formatBillingPlan(plan)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="mt-3 text-sm text-slate-500">
                        Effective preset:
                        <span className="ml-2 font-medium text-slate-700">
                          {item.effectiveFeatures.importEnrichmentEnabled ? "Premium enrichment" : "Upload-first only"},{" "}
                          {item.effectiveFeatures.bulkSolarEnrichmentEnabled ? "Bulk solar" : "No bulk solar"},{" "}
                          {item.effectiveFeatures.datasetMarketplaceEnabled ? "Marketplace" : "No marketplace"}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        {summarizeEffectivePreset(item)}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {effectivePresetBadges(item).map((badge) => (
                          <div
                            key={badge}
                            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600"
                          >
                            {badge}
                          </div>
                        ))}
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
                                      !platformLocked &&
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
                                    disabled={!canMutate || platformLocked}
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

                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Marketplace Access</div>
                      <div className="mt-2 text-xs text-slate-500">
                        Owner-managed city and zip entitlements for sold homes and permit datasets.
                      </div>
                      <div className="mt-3 space-y-3">
                        {[
                          ["sold_properties", "Sold Homes"],
                          ["solar_permits", "Solar Permits"],
                          ["roofing_permits", "Roofing Permits"]
                        ].map(([datasetType, label]) => (
                          <div key={datasetType} className="rounded-2xl bg-slate-50 px-3 py-3">
                            <div className="text-sm font-medium text-slate-700">{label}</div>
                            <div className="mt-3 space-y-2">
                              <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-mist">
                                Cities
                                <textarea
                                  disabled={!canMutate || platformLocked}
                                  value={draft?.datasetEntitlements[datasetType as keyof DatasetEntitlementDraft].cities ?? ""}
                                  onChange={(event) =>
                                    setDrafts((current) => ({
                                      ...current,
                                      [item.organizationId]: {
                                        ...(current[item.organizationId] ?? buildInitialDrafts([item])[item.organizationId]),
                                        datasetEntitlements: {
                                          ...(current[item.organizationId]?.datasetEntitlements ??
                                            buildInitialDrafts([item])[item.organizationId].datasetEntitlements),
                                          [datasetType]: {
                                            ...((current[item.organizationId]?.datasetEntitlements ??
                                              buildInitialDrafts([item])[item.organizationId].datasetEntitlements)[
                                              datasetType as keyof DatasetEntitlementDraft
                                            ]),
                                            cities: event.target.value
                                          }
                                        }
                                      }
                                    }))
                                  }
                                  placeholder="Framingham, Worcester"
                                  rows={3}
                                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-700"
                                />
                              </label>
                              <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-mist">
                                Zip Codes
                                <textarea
                                  disabled={!canMutate || platformLocked}
                                  value={draft?.datasetEntitlements[datasetType as keyof DatasetEntitlementDraft].zips ?? ""}
                                  onChange={(event) =>
                                    setDrafts((current) => ({
                                      ...current,
                                      [item.organizationId]: {
                                        ...(current[item.organizationId] ?? buildInitialDrafts([item])[item.organizationId]),
                                        datasetEntitlements: {
                                          ...(current[item.organizationId]?.datasetEntitlements ??
                                            buildInitialDrafts([item])[item.organizationId].datasetEntitlements),
                                          [datasetType]: {
                                            ...((current[item.organizationId]?.datasetEntitlements ??
                                              buildInitialDrafts([item])[item.organizationId].datasetEntitlements)[
                                              datasetType as keyof DatasetEntitlementDraft
                                            ]),
                                            zips: event.target.value
                                          }
                                        }
                                      }
                                    }))
                                  }
                                  placeholder="01701, 01826"
                                  rows={3}
                                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-700"
                                />
                              </label>
                              <div className="text-[11px] normal-case tracking-normal text-slate-500">
                                Enter multiple values separated by commas or new lines.
                              </div>
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
                      disabled={savingOrgId === item.organizationId || !canMutate || platformLocked}
                      className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:cursor-wait disabled:opacity-70"
                    >
                      {getOrganizationSaveLabel(item, canMutate, savingOrgId === item.organizationId)}
                    </button>
                  </div>
                  </>
                  ) : null}
                </div>
              );
              })
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                No organizations found yet.
              </div>
            )}
          </div>
        ) : null}
      </section>

      <section
        id="platform-datasets"
        className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-panel backdrop-blur"
      >
        <button
          type="button"
          onClick={() => setExpandedSections((current) => ({ ...current, datasets: !current.datasets }))}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-slate-500" />
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Shared Datasets</div>
              <p className="mt-1 text-sm text-slate-500">
                Publish and analyze once in the platform source org, then grant active access to customer orgs without cloning or reanalyzing batches.
              </p>
            </div>
          </div>
          <ChevronDown
            className={`h-5 w-5 text-slate-400 transition ${expandedSections.datasets ? "rotate-180" : ""}`}
          />
        </button>

        {expandedSections.datasets ? (
          <div className="mt-5 space-y-4">
            {datasets.length ? (
              datasets.map((dataset) => {
              const availableTargets = items.filter((item) => item.organizationId !== dataset.sourceOrganizationId);
              const targetOrganizationId =
                datasetTargets[dataset.datasetId] ?? availableTargets[0]?.organizationId ?? "";

              return (
                <div key={dataset.datasetId} className="rounded-[1.75rem] border border-slate-200 bg-slate-50/90 p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-lg font-semibold text-ink">{dataset.name}</div>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                          dataset.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"
                        }`}>
                          {dataset.status}
                        </span>
                        <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
                          {dataset.listType.replaceAll("_", " ")}
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-slate-500">
                        Source org: {dataset.sourceOrganizationName} · {dataset.rowCount} rows
                      </div>
                      {dataset.description ? (
                        <div className="mt-2 text-sm text-slate-600">{dataset.description}</div>
                      ) : null}
                    </div>

                    <div className="min-w-[18rem] rounded-3xl border border-slate-200 bg-white p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Grant Access</div>
                      <div className="mt-3 flex flex-col gap-3">
                        <select
                          value={targetOrganizationId}
                          disabled={!canMutate || !availableTargets.length}
                          onChange={(event) =>
                            setDatasetTargets((current) => ({
                              ...current,
                              [dataset.datasetId]: event.target.value
                            }))
                          }
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
                                : grant.assignedUserName ?? "assigned user"}
                            {" · "}
                            {grant.status}
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
                      {dataset.organizationStatuses.map((status) => {
                        return (
                          <span
                            key={`${dataset.datasetId}-${status.organizationId}`}
                            className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] ${toneForDatasetStatus(status.label)}`}
                          >
                            {status.organizationName} · {status.label}
                            {status.matchingTargetCount > 0 ? ` · ${status.matchingTargetCount} targets` : ""}
                          </span>
                        );
                      })}
                    </div>
                    {(dataset.coverage.cities.length || dataset.coverage.zips.length) ? (
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
        ) : null}
      </section>

      <section
        id="platform-security-events"
        className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-panel backdrop-blur"
      >
        <button
          type="button"
          onClick={() => setExpandedSections((current) => ({ ...current, security: !current.security }))}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-slate-500" />
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Security Events</div>
              <p className="mt-1 text-sm text-slate-500">
                Triage the latest account, import, branding, and rate-limit events across the platform.
              </p>
            </div>
          </div>
          <ChevronDown
            className={`h-5 w-5 text-slate-400 transition ${expandedSections.security ? "rotate-180" : ""}`}
          />
        </button>

        {expandedSections.security ? (
          <>
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

        {canMutate ? (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => {
                void sendTestSecurityAlert();
              }}
              disabled={sendingTestAlert}
              className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ShieldAlert className="h-4 w-4" />
              {sendingTestAlert ? "Sending Test Alert…" : "Send Test Alert"}
            </button>
          </div>
        ) : null}

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
          </>
        ) : null}
      </section>
    </div>
  );
}
