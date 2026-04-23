"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authFetch, useAuth } from "@/lib/auth/client";
import { parseDatasetEntitlementInput } from "@/lib/platform/dataset-entitlements";
import { ORGANIZATION_BILLING_PLANS } from "@/lib/platform/features";
import { formatDateTime } from "@/lib/format/date";
import type {
  OrganizationCreateResponse,
  PlatformDatasetItem,
  PlatformDatasetsResponse,
  PlatformOrganizationDatasetEntitlements,
  PlatformOrganizationOverviewItem,
  PlatformOverviewResponse,
  PlatformSecurityEventItem,
  PlatformSecurityEventsResponse
} from "@/types/api";

export type PlatformWorkspaceSurface = "organizations" | "datasets" | "security";

export type DatasetEntitlementDraft = {
  sold_properties: { cities: string; zips: string };
  solar_permits: { cities: string; zips: string };
  roofing_permits: { cities: string; zips: string };
};

export type DatasetEntitlementDraftKey = keyof DatasetEntitlementDraft;
export type DatasetEntitlementField = keyof DatasetEntitlementDraft[DatasetEntitlementDraftKey];

export type FeatureDraft = {
  name: string;
  slug: string;
  billingPlan: PlatformOrganizationOverviewItem["billingPlan"];
  enrichmentEnabled: boolean | null;
  priorityScoringEnabled: boolean | null;
  advancedImportsEnabled: boolean | null;
  securityConsoleEnabled: boolean | null;
  datasetEntitlements: DatasetEntitlementDraft;
};

type PlatformWorkspaceContextValue = {
  canMutate: boolean;
  loading: boolean;
  refreshing: boolean;
  message: string | null;
  error: string | null;
  items: PlatformOrganizationOverviewItem[];
  drafts: Record<string, FeatureDraft>;
  events: PlatformSecurityEventItem[];
  datasets: PlatformDatasetItem[];
  eventTypes: string[];
  expandedOrganizations: Record<string, boolean>;
  savingOrgId: string | null;
  navigatingOrgId: string | null;
  releasingDatasetId: string | null;
  sendingTestAlert: boolean;
  creatingOrganization: boolean;
  newOrganizationName: string;
  newOrganizationSlug: string;
  newOrganizationAppName: string;
  datasetTargets: Record<string, string>;
  selectedOrganizationId: string;
  selectedSeverity: string;
  selectedEventType: string;
  setSelectedOrganizationId: (value: string) => void;
  setSelectedSeverity: (value: string) => void;
  setSelectedEventType: (value: string) => void;
  setNewOrganizationName: (value: string) => void;
  setNewOrganizationSlug: (value: string) => void;
  setNewOrganizationAppName: (value: string) => void;
  toggleOrganization: (organizationId: string) => void;
  updateDraft: (organizationId: string, recipe: (current: FeatureDraft) => FeatureDraft) => void;
  setDatasetTarget: (datasetId: string, organizationId: string) => void;
  refreshWorkspace: () => Promise<void>;
  refreshSecurityEvents: () => Promise<void>;
  switchAndGo: (organizationId: string, href: string) => Promise<void>;
  saveOrganization: (item: PlatformOrganizationOverviewItem) => Promise<void>;
  createOrganization: () => Promise<void>;
  releaseDataset: (datasetId: string) => Promise<void>;
  revokeDataset: (datasetId: string, organizationId: string) => Promise<void>;
  sendTestSecurityAlert: () => Promise<void>;
};

const PlatformWorkspaceContext = createContext<PlatformWorkspaceContextValue | null>(null);

export function formatBillingPlan(plan: PlatformOrganizationOverviewItem["billingPlan"]) {
  if (plan === "free") return "Free";
  if (plan === "starter") return "Starter";
  if (plan === "pro") return "Pro";
  return "Intelligence";
}

export function getOrganizationSaveLabel(
  item: PlatformOrganizationOverviewItem,
  canMutate: boolean,
  saving: boolean
) {
  if (item.isPlatformSource) return "Platform Source Locked";
  if (!canMutate) return "Platform Owner Only";
  if (saving) return "Saving…";
  return "Save Plan & Features";
}

export function toneForDatasetStatus(label: PlatformDatasetItem["organizationStatuses"][number]["label"]) {
  if (label === "Platform Source") return "bg-slate-900 text-white";
  if (label === "Included by Intelligence") return "bg-emerald-100 text-emerald-700";
  if (label === "Marketplace Eligible") return "bg-sky-100 text-sky-700";
  return "bg-slate-200 text-slate-700";
}

export function summarizeEffectivePreset(item: PlatformOrganizationOverviewItem) {
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

export function effectivePresetBadges(item: PlatformOrganizationOverviewItem) {
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

function buildDraft(item: PlatformOrganizationOverviewItem): FeatureDraft {
  return {
    name: item.name,
    slug: item.slug ?? "",
    billingPlan: item.billingPlan,
    enrichmentEnabled: item.featureOverrides.enrichmentEnabled,
    priorityScoringEnabled: item.featureOverrides.priorityScoringEnabled,
    advancedImportsEnabled: item.featureOverrides.advancedImportsEnabled,
    securityConsoleEnabled: item.featureOverrides.securityConsoleEnabled,
    datasetEntitlements: entitlementsToDraft(item.datasetEntitlements)
  };
}

function buildInitialDrafts(items: PlatformOrganizationOverviewItem[]) {
  return Object.fromEntries(items.map((item) => [item.organizationId, buildDraft(item)])) as Record<string, FeatureDraft>;
}

function usePlatformWorkspaceController(): PlatformWorkspaceContextValue {
  const { session, appContext } = useAuth();
  const accessToken = session?.access_token ?? null;
  const canMutate = Boolean(appContext?.isPlatformOwner);

  const [items, setItems] = useState<PlatformOrganizationOverviewItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, FeatureDraft>>({});
  const [events, setEvents] = useState<PlatformSecurityEventItem[]>([]);
  const [datasets, setDatasets] = useState<PlatformDatasetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("all");
  const [selectedSeverity, setSelectedSeverity] = useState("all");
  const [selectedEventType, setSelectedEventType] = useState("all");
  const [savingOrgId, setSavingOrgId] = useState<string | null>(null);
  const [navigatingOrgId, setNavigatingOrgId] = useState<string | null>(null);
  const [releasingDatasetId, setReleasingDatasetId] = useState<string | null>(null);
  const [sendingTestAlert, setSendingTestAlert] = useState(false);
  const [creatingOrganization, setCreatingOrganization] = useState(false);
  const [newOrganizationName, setNewOrganizationName] = useState("");
  const [newOrganizationSlug, setNewOrganizationSlug] = useState("");
  const [newOrganizationAppName, setNewOrganizationAppName] = useState("");
  const [datasetTargets, setDatasetTargets] = useState<Record<string, string>>({});
  const [expandedOrganizations, setExpandedOrganizations] = useState<Record<string, boolean>>({});

  const readErrorMessage = useCallback(async (response: Response, fallback: string) => {
    try {
      const json = (await response.json()) as { error?: string };
      return json.error || fallback;
    } catch {
      return fallback;
    }
  }, []);

  const loadOverview = useCallback(async () => {
    if (!accessToken) return [];

    const response = await authFetch(accessToken, "/api/platform/overview", {
      cache: "no-store"
    });
    const json = (await response.json()) as PlatformOverviewResponse | { error?: string };
    if (!response.ok || !("items" in json)) {
      throw new Error(("error" in json && json.error) || "Failed to load platform overview.");
    }

    setItems(json.items);
    setDrafts(buildInitialDrafts(json.items));
    return json.items;
  }, [accessToken]);

  const loadSecurityEvents = useCallback(async () => {
    if (!accessToken) return;

    const params = new URLSearchParams();
    if (selectedOrganizationId !== "all") params.set("organizationId", selectedOrganizationId);
    if (selectedSeverity !== "all") params.set("severity", selectedSeverity);
    if (selectedEventType !== "all") params.set("eventType", selectedEventType);
    params.set("limit", "80");

    const response = await authFetch(accessToken, `/api/platform/security-events?${params.toString()}`, {
      cache: "no-store"
    });
    const json = (await response.json()) as PlatformSecurityEventsResponse | { error?: string };
    if (!response.ok || !("items" in json)) {
      throw new Error(("error" in json && json.error) || "Failed to load security events.");
    }

    setEvents(json.items);
  }, [accessToken, selectedEventType, selectedOrganizationId, selectedSeverity]);

  const loadDatasets = useCallback(
    async (organizationItems: PlatformOrganizationOverviewItem[] = items) => {
      if (!accessToken) return;

      const response = await authFetch(accessToken, "/api/platform/datasets", {
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
              organizationItems.find((organization) => organization.organizationId !== dataset.sourceOrganizationId)?.organizationId ?? "";
          }
        }
        return next;
      });
    },
    [accessToken, items]
  );

  const refreshWorkspace = useCallback(async () => {
    if (!accessToken) return;

    setRefreshing(true);
    setError(null);
    try {
      const organizationItems = await loadOverview();
      await Promise.all([loadSecurityEvents(), loadDatasets(organizationItems)]);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Failed to load platform controls.");
    } finally {
      setRefreshing(false);
    }
  }, [accessToken, loadDatasets, loadOverview, loadSecurityEvents]);

  const refreshSecurityEvents = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    await loadSecurityEvents();
  }, [accessToken, loadSecurityEvents]);

  useEffect(() => {
    if (!accessToken) return;

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
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    loadSecurityEvents().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Failed to refresh security events.");
    });
  }, [accessToken, loadSecurityEvents]);

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
    () => [...new Set(events.map((item) => item.eventType))].sort((left, right) => left.localeCompare(right)),
    [events]
  );

  const updateDraft = useCallback(
    (organizationId: string, recipe: (current: FeatureDraft) => FeatureDraft) => {
      setDrafts((current) => {
        const existing =
          current[organizationId] ??
          buildDraft(items.find((item) => item.organizationId === organizationId) ?? items[0]!);
        return {
          ...current,
          [organizationId]: recipe(existing)
        };
      });
    },
    [items]
  );

  const toggleOrganization = useCallback((organizationId: string) => {
    setExpandedOrganizations((current) => ({
      ...current,
      [organizationId]: !(current[organizationId] ?? false)
    }));
  }, []);

  const setDatasetTarget = useCallback((datasetId: string, organizationId: string) => {
    setDatasetTargets((current) => ({
      ...current,
      [datasetId]: organizationId
    }));
  }, []);

  const switchAndGo = useCallback(
    async (organizationId: string, href: string) => {
      if (!accessToken) return;

      setMessage(null);
      setError(null);
      setNavigatingOrgId(organizationId);

      try {
        const response = await authFetch(accessToken, "/api/platform/active-organization", {
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
    },
    [accessToken]
  );

  const saveOrganization = useCallback(
    async (item: PlatformOrganizationOverviewItem) => {
      if (!accessToken || !canMutate) return;

      const draft = drafts[item.organizationId];
      if (!draft) return;

      setSavingOrgId(item.organizationId);
      setMessage(null);
      setError(null);

      try {
        const [organizationResponse, featuresResponse, entitlementsResponse] = await Promise.all([
          authFetch(accessToken, `/api/platform/organizations/${item.organizationId}`, {
            method: "PATCH",
            body: JSON.stringify({
              name: draft.name,
              slug: draft.slug.trim() || null,
              billingPlan: draft.billingPlan
            })
          }),
          authFetch(accessToken, `/api/platform/organizations/${item.organizationId}/features`, {
            method: "PATCH",
            body: JSON.stringify({
              enrichmentEnabled: draft.enrichmentEnabled,
              priorityScoringEnabled: draft.priorityScoringEnabled,
              advancedImportsEnabled: draft.advancedImportsEnabled,
              securityConsoleEnabled: draft.securityConsoleEnabled
            })
          }),
          authFetch(accessToken, `/api/platform/organizations/${item.organizationId}/dataset-entitlements`, {
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

        const organizationItems = await loadOverview();
        await loadDatasets(organizationItems);
        if (selectedOrganizationId === item.organizationId || selectedOrganizationId === "all") {
          await loadSecurityEvents();
        }
        setMessage(`Updated ${item.name}.`);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "Failed to update organization.");
      } finally {
        setSavingOrgId(null);
      }
    },
    [accessToken, canMutate, drafts, loadDatasets, loadOverview, loadSecurityEvents, selectedOrganizationId]
  );

  const createOrganization = useCallback(async () => {
    if (!accessToken || !canMutate || !newOrganizationName.trim()) return;

    setCreatingOrganization(true);
    setMessage(null);
    setError(null);

    try {
      const response = await authFetch(accessToken, "/api/organizations", {
        method: "POST",
        body: JSON.stringify({
          name: newOrganizationName.trim(),
          slug: newOrganizationSlug.trim() || null,
          appName: newOrganizationAppName.trim() || null
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to create organization."));
      }

      const json = (await response.json()) as OrganizationCreateResponse;
      await loadOverview();
      setExpandedOrganizations((current) => ({
        ...current,
        [json.item.organizationId]: true
      }));
      setNewOrganizationName("");
      setNewOrganizationSlug("");
      setNewOrganizationAppName("");
      setMessage(`Created ${json.item.name}.`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create organization.");
    } finally {
      setCreatingOrganization(false);
    }
  }, [
    accessToken,
    canMutate,
    loadOverview,
    newOrganizationAppName,
    newOrganizationName,
    newOrganizationSlug,
    readErrorMessage
  ]);

  const releaseDataset = useCallback(
    async (datasetId: string) => {
      if (!accessToken) return;

      const organizationId = datasetTargets[datasetId];
      if (!organizationId) return;

      setReleasingDatasetId(datasetId);
      setMessage(null);
      setError(null);

      try {
        const response = await authFetch(accessToken, `/api/platform/datasets/${datasetId}/grants`, {
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

        const organizationItems = await loadOverview();
        await loadDatasets(organizationItems);
        setMessage("Granted dataset access to the selected organization.");
      } catch (releaseError) {
        setError(releaseError instanceof Error ? releaseError.message : "Failed to release dataset.");
      } finally {
        setReleasingDatasetId(null);
      }
    },
    [accessToken, datasetTargets, loadDatasets, loadOverview]
  );

  const revokeDataset = useCallback(
    async (datasetId: string, organizationId: string) => {
      if (!accessToken || !canMutate) return;

      setReleasingDatasetId(datasetId);
      setMessage(null);
      setError(null);
      try {
        const response = await authFetch(accessToken, `/api/platform/datasets/${datasetId}/grants`, {
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

        const organizationItems = await loadOverview();
        await loadDatasets(organizationItems);
        setMessage("Revoked dataset access for that organization.");
      } catch (revokeError) {
        setError(revokeError instanceof Error ? revokeError.message : "Failed to revoke dataset access.");
      } finally {
        setReleasingDatasetId(null);
      }
    },
    [accessToken, canMutate, loadDatasets, loadOverview]
  );

  const sendTestSecurityAlert = useCallback(async () => {
    if (!accessToken || !canMutate) return;

    setSendingTestAlert(true);
    setMessage(null);
    setError(null);

    try {
      const response = await authFetch(accessToken, "/api/platform/security-events", {
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
  }, [accessToken, canMutate, loadSecurityEvents]);

  return {
    canMutate,
    loading,
    refreshing,
    message,
    error,
    items,
    drafts,
    events,
    datasets,
    eventTypes,
    expandedOrganizations,
    savingOrgId,
    navigatingOrgId,
    releasingDatasetId,
    sendingTestAlert,
    creatingOrganization,
    newOrganizationName,
    newOrganizationSlug,
    newOrganizationAppName,
    datasetTargets,
    selectedOrganizationId,
    selectedSeverity,
    selectedEventType,
    setSelectedOrganizationId,
    setSelectedSeverity,
    setSelectedEventType,
    setNewOrganizationName,
    setNewOrganizationSlug,
    setNewOrganizationAppName,
    toggleOrganization,
    updateDraft,
    setDatasetTarget,
    refreshWorkspace,
    refreshSecurityEvents,
    switchAndGo,
    saveOrganization,
    createOrganization,
    releaseDataset,
    revokeDataset,
    sendTestSecurityAlert
  };
}

export function PlatformWorkspaceProvider({ children }: { children: ReactNode }) {
  const value = usePlatformWorkspaceController();
  return <PlatformWorkspaceContext.Provider value={value}>{children}</PlatformWorkspaceContext.Provider>;
}

export function usePlatformWorkspace() {
  const value = useContext(PlatformWorkspaceContext);
  if (!value) {
    throw new Error("usePlatformWorkspace must be used within PlatformWorkspaceProvider");
  }
  return value;
}

export { ORGANIZATION_BILLING_PLANS, formatDateTime };
