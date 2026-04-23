"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeHelp,
  Ban,
  CalendarCheck2,
  CircleDashed,
  Clock3,
  DoorOpen,
  FileBadge2,
  Handshake,
  HelpCircle,
  House,
  PhoneCall,
  UserRoundCheck,
  XCircle
} from "lucide-react";
import MapView, {
  Layer,
  Marker,
  NavigationControl,
  Source,
  type LayerProps,
  type MapLayerMouseEvent,
  type MapRef,
  type ViewStateChangeEvent
} from "react-map-gl/maplibre";
import type { ActiveRouteRunResponse } from "@/types/api";
import type { LeadInput, MapProperty, OrganizationFeatureAccess, TaskInput } from "@/types/entities";
import { MapToolbar, type MapFilterKey } from "@/components/map/map-toolbar";
import { mapStateVisual } from "@/components/map/property-results-panel";
import { PropertyDrawer } from "@/components/map/property-drawer";
import {
  MapCenterLocationButton,
  MapPanelToggles,
  MapResultsSidebars,
  MapStatusOverlay
} from "@/components/map/map-screen-overlays";
import {
  ActiveRoutePanel,
  MobileSelectedPropertyChip,
  RouteSelectionPanel,
  RouteSelectionToggle
} from "@/components/map/route-overlays";
import { useLiveLocation } from "@/components/map/use-live-location";
import { useMapPropertySelection } from "@/components/map/use-map-property-selection";
import { useRouteSelection } from "@/components/map/use-route-selection";
import { buildMapSearchParams } from "@/components/map/map-url-state";
import { trackAppEvent } from "@/lib/analytics/app-events";
import { hasManagerAccess } from "@/lib/auth/permissions";
import { authFetch, useAuth } from "@/lib/auth/client";

type MapPointVisual = {
  color: string;
  textColor: string;
  label: string;
};

const PROPERTY_SOURCE_ID = "map-properties";
const CLUSTER_CIRCLE_LAYER_ID = "map-property-clusters";
const CLUSTER_COUNT_LAYER_ID = "map-property-cluster-count";
const PROPERTY_SELECTION_HALO_LAYER_ID = "map-property-selection-halo";
const PROPERTY_POINT_LAYER_ID = "map-property-points";
const PROPERTY_LABEL_LAYER_ID = "map-property-labels";
const INTERACTIVE_LAYER_IDS = [CLUSTER_CIRCLE_LAYER_ID, PROPERTY_POINT_LAYER_ID];

function markerVisual(mapState: MapProperty["mapState"]): MapPointVisual {
  switch (mapState) {
    case "not_home":
      return { color: "#64748b", textColor: "#ffffff", label: "NH" };
    case "left_doorhanger":
      return { color: "#7c3aed", textColor: "#ffffff", label: "DH" };
    case "opportunity":
      return { color: "#0f8f6f", textColor: "#ffffff", label: "OP" };
    case "interested":
      return { color: "#0f8f6f", textColor: "#ffffff", label: "IN" };
    case "callback_requested":
      return { color: "#d97706", textColor: "#ffffff", label: "CB" };
    case "not_interested":
      return { color: "#ea580c", textColor: "#ffffff", label: "NI" };
    case "disqualified":
      return { color: "#3f3f46", textColor: "#ffffff", label: "DQ" };
    case "do_not_knock":
      return { color: "#b91c1c", textColor: "#ffffff", label: "DN" };
    case "follow_up_overdue":
      return { color: "#e11d48", textColor: "#ffffff", label: "FU" };
    case "appointment_set":
      return { color: "#0284c7", textColor: "#ffffff", label: "AP" };
    case "customer":
      return { color: "#059669", textColor: "#ffffff", label: "CU" };
    case "canvassed_with_lead":
      return { color: "#0f172a", textColor: "#ffffff", label: "LD" };
    case "canvassed":
      return { color: "#475569", textColor: "#ffffff", label: "CV" };
    case "imported_target":
      return { color: "#d97706", textColor: "#ffffff", label: "IM" };
    default:
      return { color: "#94a3b8", textColor: "#ffffff", label: "HM" };
  }
}

function markerBadge(item: MapProperty) {
  if (item.mapState === "not_home" && item.notHomeCount > 1) {
    return Math.min(item.notHomeCount, 9);
  }
  return null;
}

const DEFAULT_CENTER = {
  latitude: 42.1637,
  longitude: -71.8023,
  zoom: 12
};

type NumericBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

function toNumericBounds(
  bounds: maplibregl.LngLatBoundsLike | { getSouth: () => number; getNorth: () => number; getWest: () => number; getEast: () => number },
  fallback: { latitude: number; longitude: number }
): NumericBounds {
  if ("getSouth" in bounds) {
    return {
      minLat: bounds.getSouth(),
      maxLat: bounds.getNorth(),
      minLng: bounds.getWest(),
      maxLng: bounds.getEast()
    };
  }

  return {
    minLat: fallback.latitude - 0.08,
    maxLat: fallback.latitude + 0.08,
    minLng: fallback.longitude - 0.08,
    maxLng: fallback.longitude + 0.08
  };
}

function expandBounds(bounds: NumericBounds, multiplier = 1.35): NumericBounds {
  const latPadding = ((bounds.maxLat - bounds.minLat) * (multiplier - 1)) / 2 || 0.03;
  const lngPadding = ((bounds.maxLng - bounds.minLng) * (multiplier - 1)) / 2 || 0.03;
  return {
    minLat: bounds.minLat - latPadding,
    maxLat: bounds.maxLat + latPadding,
    minLng: bounds.minLng - lngPadding,
    maxLng: bounds.maxLng + lngPadding
  };
}

function boundsContainBounds(outer: NumericBounds | null, inner: NumericBounds) {
  if (!outer) return false;
  return (
    inner.minLat >= outer.minLat &&
    inner.maxLat <= outer.maxLat &&
    inner.minLng >= outer.minLng &&
    inner.maxLng <= outer.maxLng
  );
}

function isItemWithinBounds(item: MapProperty, bounds: NumericBounds) {
  return (
    item.lat >= bounds.minLat &&
    item.lat <= bounds.maxLat &&
    item.lng >= bounds.minLng &&
    item.lng <= bounds.maxLng
  );
}

export function LiveFieldMap({
  initialItems,
  initialSelectedPropertyId = null,
  initialFilters = ["all"],
  ownerIdFilter = null,
  cityFilter = null,
  stateFilter = null,
  initialAddressSearch = null
}: {
  initialItems: MapProperty[];
  initialSelectedPropertyId?: string | null;
  initialFilters?: MapFilterKey[];
  ownerIdFilter?: string | null;
  cityFilter?: string | null;
  stateFilter?: string | null;
  initialAddressSearch?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { session, appContext } = useAuth();
  const hasExplicitTeamParam = searchParams.get("team") !== null;
  const isManager = useMemo(
    () => (appContext ? hasManagerAccess(appContext) : false),
    [appContext]
  );
  const mapRef = useRef<MapRef | null>(null);
  const itemCacheRef = useRef(new Map(initialItems.map((item) => [item.propertyId, item])));
  const loadedBoundsRef = useRef<NumericBounds | null>(null);
  const loadedQueryKeyRef = useRef<string | null>(null);
  const loadRequestIdRef = useRef(0);
  const [items, setItems] = useState(initialItems);
  const [activeFilters, setActiveFilters] = useState<MapFilterKey[]>(initialFilters);
  const [viewState, setViewState] = useState(DEFAULT_CENTER);
  const [isSavingVisit, setIsSavingVisit] = useState(false);
  const [isResultsOpen, setIsResultsOpen] = useState(searchParams.get("list") === "1");
  const [isResultsPanelVisible, setIsResultsPanelVisible] = useState(searchParams.get("list") === "1");
  const [isDrawerVisible, setIsDrawerVisible] = useState(searchParams.get("drawer") !== "0");
  const [showTeamKnocks, setShowTeamKnocks] = useState(searchParams.get("team") === "1");
  const [activeRoute, setActiveRoute] = useState<ActiveRouteRunResponse | null>(null);
  const [routeActionState, setRouteActionState] = useState<
    "idle" | "skipping" | "optimizing" | "building" | "error"
  >("idle");
  const [featureAccess, setFeatureAccess] = useState<OrganizationFeatureAccess>({
    mapEnabled: true,
    doorKnockingEnabled: true,
    visitLoggingEnabled: true,
    leadsEnabled: false,
    crmEnabled: false,
    appointmentsEnabled: false,
    selfImportsEnabled: false,
    enrichmentEnabled: false,
    priorityScoringEnabled: false,
    advancedImportsEnabled: false,
    tasksEnabled: false,
    teamManagementEnabled: false,
    territoriesEnabled: false,
    solarCheckEnabled: false,
    importEnrichmentEnabled: false,
    bulkSolarEnrichmentEnabled: false,
    clusterAnalysisEnabled: false,
    premiumRoutingInsightsEnabled: false,
    datasetMarketplaceEnabled: false,
    territoryPlanningEnabled: false,
    securityConsoleEnabled: false
  });
  const viewportQueryKey = `${ownerIdFilter ?? ""}|${cityFilter ?? ""}|${stateFilter ?? ""}|${showTeamKnocks ? "team" : "self"}`;

  useEffect(() => {
    itemCacheRef.current = new Map(initialItems.map((item) => [item.propertyId, item]));
    setItems(initialItems);
    loadedBoundsRef.current = null;
    loadedQueryKeyRef.current = null;
  }, [initialItems]);

  const filteredItems = useMemo(() => {
    if (activeFilters.includes("all")) return items;
    return items.filter((item) => {
      if (featureAccess.priorityScoringEnabled && activeFilters.includes("high_priority") && item.priorityBand === "high") {
        return true;
      }
      if (item.mapState !== "canvassed_with_lead" && activeFilters.includes(item.mapState as MapFilterKey)) return true;
      return false;
    });
  }, [activeFilters, featureAccess.priorityScoringEnabled, items]);

  const activeRouteStopSequenceByPropertyId = useMemo(() => {
    const next = new Map<string, number>();
    for (const stop of activeRoute?.stops ?? []) {
      if (stop.propertyId && stop.stopStatus === "pending") {
        next.set(stop.propertyId, stop.sequenceNumber);
      }
    }
    return next;
  }, [activeRoute]);

  const routeSelectableItems = useMemo(
    () => filteredItems.filter((item) => Boolean(item.leadId)),
    [filteredItems]
  );
  const {
    routeSelectionMode,
    selectedRouteLeadIds,
    selectedRouteItems,
    routeBuilderError,
    setRouteBuilderError,
    toggleSelectedRouteLead,
    clearSelectedRouteLeads,
    closeRouteSelection,
    toggleRouteSelectionMode
  } = useRouteSelection({
    routeSelectableItems,
    activeRouteId: activeRoute?.routeRunId ?? null
  });
  const userLocation = useLiveLocation({
    onFirstFix: (location) => {
      setViewState((current) => ({
        ...current,
        latitude: location.latitude,
        longitude: location.longitude,
        zoom: Math.max(current.zoom, 18)
      }));
    }
  });

  useEffect(() => {
    setActiveFilters(initialFilters.length ? initialFilters : ["all"]);
  }, [initialFilters]);

  useEffect(() => {
    if (!hasExplicitTeamParam) {
      setShowTeamKnocks(isManager);
    }
  }, [hasExplicitTeamParam, isManager]);

  useEffect(() => {
    if (featureAccess.priorityScoringEnabled) return;
    setActiveFilters((current) => {
      const next = current.filter((filter) => filter !== "high_priority");
      return next.length ? next : ["all"];
    });
  }, [featureAccess.priorityScoringEnabled]);

  const loadActiveRoute = useCallback(async () => {
    if (!session?.access_token) {
      setActiveRoute(null);
      return null;
    }

    const response = await authFetch(session.access_token, "/api/routes/active");
    if (!response.ok) {
      setActiveRoute(null);
      return null;
    }

    const json = (await response.json()) as ActiveRouteRunResponse | null;
    setActiveRoute(json);
    return json;
  }, [session?.access_token]);

  async function getCurrentPosition() {
    if (!navigator.geolocation) {
      throw new Error("Location access is not available on this device.");
    }

    return new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, (error) => {
        reject(new Error(error.message || "Location access was blocked for route planning."));
      }, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 15000
      });
    });
  }

  function getMapCenterOrigin() {
    return {
      latitude: viewState.latitude,
      longitude: viewState.longitude
    };
  }

  const loadPropertiesForViewport = useCallback(async (bounds?: maplibregl.LngLatBoundsLike | null) => {
    if (!session?.access_token) return;

    const concreteBounds =
      bounds ||
      mapRef.current?.getBounds() || {
        getSouth: () => viewState.latitude - 0.08,
        getNorth: () => viewState.latitude + 0.08,
        getWest: () => viewState.longitude - 0.08,
        getEast: () => viewState.longitude + 0.08
      };
    const currentBounds = toNumericBounds(concreteBounds, {
      latitude: viewState.latitude,
      longitude: viewState.longitude
    });
    const requestBounds = expandBounds(currentBounds);

    if (loadedQueryKeyRef.current !== viewportQueryKey) {
      itemCacheRef.current = new Map();
      loadedBoundsRef.current = null;
      loadedQueryKeyRef.current = viewportQueryKey;
    }

    if (boundsContainBounds(loadedBoundsRef.current, currentBounds)) {
      setItems(Array.from(itemCacheRef.current.values()).filter((item) => isItemWithinBounds(item, loadedBoundsRef.current!)));
      return;
    }

    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;

    const response = await authFetch(
      session.access_token,
      `/api/map/properties?minLat=${requestBounds.minLat}&maxLat=${requestBounds.maxLat}&minLng=${requestBounds.minLng}&maxLng=${requestBounds.maxLng}&limit=1000${
        ownerIdFilter ? `&ownerId=${encodeURIComponent(ownerIdFilter)}` : ""
      }${cityFilter ? `&city=${encodeURIComponent(cityFilter)}` : ""}${
        stateFilter ? `&state=${encodeURIComponent(stateFilter)}` : ""
      }${showTeamKnocks ? "&showTeamKnocks=1" : ""}`
    );
    if (!response.ok) return;
    const json = (await response.json()) as { items: MapProperty[]; features?: OrganizationFeatureAccess };
    if (requestId !== loadRequestIdRef.current) return;
    for (const item of json.items) {
      itemCacheRef.current.set(item.propertyId, item);
    }
    loadedBoundsRef.current = requestBounds;
    setItems(Array.from(itemCacheRef.current.values()).filter((item) => isItemWithinBounds(item, requestBounds)));
    if (json.features) {
      setFeatureAccess(json.features);
    }
  }, [
    cityFilter,
    ownerIdFilter,
    session?.access_token,
    showTeamKnocks,
    stateFilter,
    viewportQueryKey,
    viewState.latitude,
    viewState.longitude
  ]);

  const reloadViewportProperties = useCallback(
    () => loadPropertiesForViewport(mapRef.current?.getBounds() ?? null),
    [loadPropertiesForViewport]
  );

  const {
    selectedPropertyId,
    selectedProperty,
    propertyLoading,
    isResolvingTap,
    mobileOpenNonce,
    openSelectedProperty,
    closeSelectedProperty,
    refreshSelectedProperty,
    ensurePersistedSelectedProperty,
    handleMapTap: resolveMapTap
  } = useMapPropertySelection({
    accessToken: session?.access_token,
    initialSelectedPropertyId,
    initialAddressSearch,
    featureAccess,
    reloadViewportProperties,
    onFeatureAccess: setFeatureAccess,
    setViewState
  });

  const selectedMapItem = useMemo(
    () => items.find((item) => item.propertyId === selectedPropertyId) ?? null,
    [items, selectedPropertyId]
  );
  const selectedRouteLeadIdSet = useMemo(() => new Set(selectedRouteLeadIds), [selectedRouteLeadIds]);
  const propertyFeatureCollection = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: filteredItems.map((item) => {
      const visual = markerVisual(item.mapState);
      const routeSequence = activeRouteStopSequenceByPropertyId.get(item.propertyId) ?? null;
      const badge = markerBadge(item);

      return {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [item.lng, item.lat] as [number, number]
        },
        properties: {
          propertyId: item.propertyId,
          leadId: item.leadId,
          address: item.address,
          mapState: item.mapState,
          markerColor: visual.color,
          markerTextColor: visual.textColor,
          markerLabel: routeSequence ? null : badge ? String(badge) : visual.label,
          isSelected: selectedPropertyId === item.propertyId ? 1 : 0,
          isRouteSelected:
            routeSelectionMode && item.leadId && selectedRouteLeadIdSet.has(item.leadId) ? 1 : 0,
          routeSequence,
          routeSequenceLabel: routeSequence ? String(routeSequence) : null
        }
      };
    })
  }), [
    activeRouteStopSequenceByPropertyId,
    filteredItems,
    routeSelectionMode,
    selectedPropertyId,
    selectedRouteLeadIdSet
  ]);

  useEffect(() => {
    if (selectedPropertyId) {
      setIsDrawerVisible(true);
    }
  }, [selectedPropertyId]);

  useEffect(() => {
    void loadPropertiesForViewport(null);
  }, [loadPropertiesForViewport]);

  useEffect(() => {
    void loadActiveRoute();
  }, [loadActiveRoute]);

  useEffect(() => {
    if (selectedPropertyId || !activeRoute?.nextStop?.propertyId || !session?.access_token) return;
    openSelectedProperty(activeRoute.nextStop.propertyId);
    void refreshSelectedProperty(activeRoute.nextStop.propertyId);
  }, [activeRoute?.nextStop?.propertyId, openSelectedProperty, refreshSelectedProperty, selectedPropertyId, session?.access_token]);

  async function handleMapTap(event: MapLayerMouseEvent) {
    const topFeature = event.features?.[0];

    if (topFeature?.properties?.cluster) {
      const clusterId = Number(topFeature.properties.cluster_id);
      const map = mapRef.current?.getMap();
      const source = map?.getSource(PROPERTY_SOURCE_ID) as
        | (maplibregl.GeoJSONSource & {
            getClusterExpansionZoom?: (
              clusterId: number,
              callback: (error: Error | null, zoom: number) => void
            ) => void;
          })
        | undefined;

      const coordinates = (topFeature.geometry as { coordinates?: [number, number] } | undefined)?.coordinates;
      if (source?.getClusterExpansionZoom && coordinates) {
        source.getClusterExpansionZoom(clusterId, (error, zoom) => {
          if (error) return;
          map?.easeTo({
            center: coordinates,
            zoom: Math.min(zoom, 19),
            duration: 420
          });
        });
        return;
      }
    }

    const propertyId =
      typeof topFeature?.properties?.propertyId === "string" ? topFeature.properties.propertyId : null;
    const leadId = typeof topFeature?.properties?.leadId === "string" ? topFeature.properties.leadId : null;

    if (propertyId) {
      if (routeSelectionMode && leadId) {
        toggleSelectedRouteLead(leadId);
        return;
      }
      openSelectedProperty(propertyId);
      return;
    }

    if (routeSelectionMode) return;
    await resolveMapTap(event.lngLat.lat, event.lngLat.lng);
  }

  async function handleLogOutcome(outcome: string) {
    if (!selectedProperty || !session?.access_token) return;
    const matchingRouteStop =
      selectedProperty.propertyId && activeRoute?.nextStop?.propertyId === selectedProperty.propertyId
        ? activeRoute.nextStop
        : null;
    try {
      setIsSavingVisit(true);
      const propertyId = await ensurePersistedSelectedProperty();
      const response = await authFetch(session.access_token, "/api/visits", {
        method: "POST",
        body: JSON.stringify({
          propertyId,
          lat: selectedProperty.lat,
          lng: selectedProperty.lng,
          outcome,
          routeRunId: matchingRouteStop ? activeRoute?.routeRunId ?? null : null,
          routeRunStopId: matchingRouteStop?.routeRunStopId ?? null
        })
      });

      if (!response.ok) return;

      setItems((current) =>
        current.map((item) => {
          if (item.propertyId !== propertyId) return item;
          const nextMapState: MapProperty["mapState"] =
            outcome === "opportunity"
              ? "opportunity"
              : outcome === "not_home"
                ? "not_home"
                : outcome === "left_doorhanger"
                  ? "left_doorhanger"
                  : outcome === "callback_requested"
                    ? "callback_requested"
                    : outcome === "do_not_knock"
                      ? "do_not_knock"
                      : outcome === "interested"
                        ? "interested"
                        : outcome === "disqualified"
                          ? "disqualified"
                          : outcome === "not_interested"
                            ? "not_interested"
                            : outcome === "appointment_set"
                              ? "appointment_set"
                              : "canvassed_with_lead";
          const nextItem = {
            ...item,
            visitCount: item.visitCount + 1,
            lastVisitOutcome: outcome,
            mapState: nextMapState
          };
          itemCacheRef.current.set(propertyId, nextItem);
          return nextItem;
        })
      );
      await refreshSelectedProperty(propertyId);
      const refreshedRoute = await loadActiveRoute();
      trackAppEvent("map.visit_logged", {
        outcome,
        propertyId,
        viaRoute: Boolean(matchingRouteStop)
      });
      if (refreshedRoute?.nextStop?.propertyId && refreshedRoute.nextStop.propertyId !== propertyId) {
        openSelectedProperty(refreshedRoute.nextStop.propertyId);
        await refreshSelectedProperty(refreshedRoute.nextStop.propertyId);
      }
    } finally {
      setIsSavingVisit(false);
    }
  }

  async function handleSaveLead(input: LeadInput) {
    if (!session?.access_token) return;
    const propertyId = await ensurePersistedSelectedProperty();
    const response = await authFetch(session.access_token, "/api/leads", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        propertyId
      })
    });

    if (!response.ok) {
      throw new Error("Failed to save lead");
    }

    await refreshSelectedProperty(propertyId);
  }

  async function handleCreateTask(input: TaskInput) {
    if (!session?.access_token) return;
    const propertyId = selectedProperty?.lat && selectedProperty?.lng
      ? await ensurePersistedSelectedProperty()
      : input.propertyId ?? null;
    const response = await authFetch(session.access_token, "/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        propertyId
      })
    });

    if (!response.ok) {
      throw new Error("Failed to save task");
    }

    if (propertyId) {
      await refreshSelectedProperty(propertyId);
    }
  }

  async function handleBuildRouteFromMapSelection() {
    if (!session?.access_token || !selectedRouteLeadIds.length) return;

    try {
      setRouteActionState("building");
      setRouteBuilderError(null);
      const position = await getCurrentPosition().catch(() => null);
      const origin = position
        ? {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            label: "Current Location"
          }
        : userLocation
          ? {
              latitude: userLocation.latitude,
              longitude: userLocation.longitude,
              label: "Current Location"
            }
          : {
              ...getMapCenterOrigin(),
              label: "Map Center"
            };
      const response = await authFetch(session.access_token, "/api/routes/run", {
        method: "POST",
        body: JSON.stringify({
          leadIds: selectedRouteLeadIds,
          startedFromLat: origin.latitude,
          startedFromLng: origin.longitude,
          startedFromLabel: origin.label,
          optimizationMode: "drive_time"
        })
      });

      const json = (await response.json()) as { routeRunId?: string; firstPropertyId?: string | null; error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "Failed to build route from map selection.");
      }

      closeRouteSelection();
      setRouteBuilderError(
        origin.label === "Map Center"
          ? "Route built from the current map view because browser location was unavailable."
          : null
      );
      await loadActiveRoute();
      trackAppEvent("map.route_built", {
        selectedLeads: selectedRouteLeadIds.length,
        origin: origin.label
      });

      if (json.firstPropertyId) {
        openSelectedProperty(json.firstPropertyId);
        await refreshSelectedProperty(json.firstPropertyId);
      }
    } catch (error) {
      setRouteBuilderError(
        error instanceof Error ? error.message : "Could not build a route from the current selection."
      );
      setRouteActionState("error");
      return;
    }

    setRouteActionState("idle");
  }

  async function handleOptimizeRemainingStops() {
    if (!session?.access_token || !activeRoute?.routeRunId) return;

    try {
      setRouteActionState("optimizing");
      setRouteBuilderError(null);
      const nextStop = activeRoute.nextStop;
      const nextStopOrigin =
        nextStop && nextStop.lat !== null && nextStop.lng !== null
          ? {
              latitude: nextStop.lat,
              longitude: nextStop.lng
            }
          : null;

      const origin =
        userLocation ??
        (nextStopOrigin ??
          (activeRoute.startedFromLat !== null && activeRoute.startedFromLng !== null
            ? {
                latitude: activeRoute.startedFromLat,
                longitude: activeRoute.startedFromLng
              }
            : null));

      if (!origin) {
        throw new Error("We need a current location before re-optimizing the remaining route.");
      }

      const response = await authFetch(
        session.access_token,
        `/api/routes/run/${activeRoute.routeRunId}/optimize`,
        {
          method: "PATCH",
          body: JSON.stringify({
            originLat: origin.latitude,
            originLng: origin.longitude,
            optimizationMode: activeRoute.optimizationMode
          })
        }
      );

      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "Could not optimize the remaining route.");
      }

      const refreshedRoute = await loadActiveRoute();
      trackAppEvent("map.route_optimized", {
        pendingStops: activeRoute.pendingStops
      });
      if (refreshedRoute?.nextStop?.propertyId) {
        openSelectedProperty(refreshedRoute.nextStop.propertyId);
        await refreshSelectedProperty(refreshedRoute.nextStop.propertyId);
      }
    } catch (error) {
      setRouteBuilderError(
        error instanceof Error ? error.message : "Could not optimize the remaining route."
      );
      setRouteActionState("error");
      return;
    }

    setRouteActionState("idle");
  }

  async function handleSkipRouteStop() {
    if (!session?.access_token || !activeRoute?.nextStop) return;
    try {
      setRouteActionState("skipping");
      const response = await authFetch(
        session.access_token,
        `/api/routes/run/${activeRoute.routeRunId}/stops/${activeRoute.nextStop.routeRunStopId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            action: "skip",
            skippedReason: "Skipped from active route"
          })
        }
      );

      if (!response.ok) {
        throw new Error("Failed to skip route stop");
      }

      const refreshedRoute = await loadActiveRoute();
      trackAppEvent("map.route_stop_skipped", {
        routeRunId: activeRoute.routeRunId,
        routeRunStopId: activeRoute.nextStop.routeRunStopId
      });
      if (refreshedRoute?.nextStop?.propertyId) {
        openSelectedProperty(refreshedRoute.nextStop.propertyId);
        await refreshSelectedProperty(refreshedRoute.nextStop.propertyId);
      } else {
        closeSelectedProperty();
      }
      setRouteActionState("idle");
    } catch {
      setRouteActionState("error");
    }
  }

  function handleMoveEnd(event: ViewStateChangeEvent) {
    setViewState(event.viewState);
    void loadPropertiesForViewport(event.target.getBounds());
  }

  function handleToggleFilter(filter: MapFilterKey) {
    setActiveFilters((current) => {
      if (filter === "all") {
        return ["all"];
      }

      if (filter === "high_priority" && !featureAccess.priorityScoringEnabled) {
        return current;
      }

      const withoutAll = current.filter((item) => item !== "all");
      const exists = withoutAll.includes(filter);
      const next = exists ? withoutAll.filter((item) => item !== filter) : [...withoutAll, filter];
      return next.length ? next : ["all"];
    });
  }

  const handleSelectProperty = useCallback(
    (propertyId: string) => {
      openSelectedProperty(propertyId);
      setIsResultsOpen(false);
    },
    [openSelectedProperty]
  );

  const handleCenterOnLocation = useCallback(() => {
    if (!userLocation) return;
    setViewState((current) => ({
      ...current,
      latitude: userLocation.latitude,
      longitude: userLocation.longitude,
      zoom: Math.max(current.zoom, 18)
    }));
  }, [userLocation]);

  const selectedVisual = selectedMapItem ? mapStateVisual(selectedMapItem.mapState) : null;
  const pendingRouteStops = activeRoute?.stops.filter((stop) => stop.stopStatus === "pending") ?? [];
  const isListVisible = isResultsPanelVisible || isResultsOpen;
  const clusterCircleLayer = useMemo<LayerProps>(
    () => ({
      id: CLUSTER_CIRCLE_LAYER_ID,
      type: "circle" as const,
      filter: ["has", "point_count"] as const,
      paint: {
        "circle-color": [
          "step",
          ["get", "point_count"],
          "rgba(15, 23, 42, 0.9)",
          12,
          "rgba(3, 105, 161, 0.92)",
          40,
          "rgba(15, 118, 110, 0.94)"
        ],
        "circle-radius": [
          "step",
          ["get", "point_count"],
          19,
          12,
          24,
          40,
          30
        ],
        "circle-stroke-color": "rgba(255,255,255,0.96)",
        "circle-stroke-width": 3,
        "circle-opacity": 0.98
      }
    } as LayerProps),
    []
  );
  const clusterCountLayer = useMemo<LayerProps>(
    () => ({
      id: CLUSTER_COUNT_LAYER_ID,
      type: "symbol" as const,
      filter: ["has", "point_count"] as const,
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["Open Sans Bold"],
        "text-size": 11
      },
      paint: {
        "text-color": "#ffffff"
      }
    } as LayerProps),
    []
  );
  const propertySelectionHaloLayer = useMemo<LayerProps>(
    () => ({
      id: PROPERTY_SELECTION_HALO_LAYER_ID,
      type: "circle" as const,
      filter: [
        "all",
        ["!", ["has", "point_count"]],
        ["any", ["==", ["get", "isSelected"], 1], ["==", ["get", "isRouteSelected"], 1]]
      ] as const,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          16,
          16,
          20
        ],
        "circle-color": "rgba(255,255,255,0.98)",
        "circle-stroke-color": [
          "case",
          ["==", ["get", "isSelected"], 1],
          "#0f172a",
          "#0f8f6f"
        ],
        "circle-stroke-width": 2,
        "circle-opacity": 0.98
      }
    } as LayerProps),
    []
  );
  const propertyPointLayer = useMemo<LayerProps>(
    () => ({
      id: PROPERTY_POINT_LAYER_ID,
      type: "circle" as const,
      filter: ["!", ["has", "point_count"]] as const,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          9,
          14,
          10.5,
          18,
          12
        ],
        "circle-color": ["get", "markerColor"],
        "circle-stroke-color": "rgba(255,255,255,0.96)",
        "circle-stroke-width": 2,
        "circle-opacity": 0.98
      }
    } as LayerProps),
    []
  );
  const propertyLabelLayer = useMemo<LayerProps>(
    () => ({
      id: PROPERTY_LABEL_LAYER_ID,
      type: "symbol" as const,
      filter: ["!", ["has", "point_count"]] as const,
      layout: {
        "text-field": ["coalesce", ["get", "routeSequenceLabel"], ["get", "markerLabel"]],
        "text-font": ["Open Sans Bold"],
        "text-size": 9,
        "text-allow-overlap": true,
        "text-ignore-placement": true
      },
      paint: {
        "text-color": ["get", "markerTextColor"]
      }
    } as LayerProps),
    []
  );
  const nextStopDirectionsUrl = activeRoute?.nextStop
    ? (() => {
        const params = new URLSearchParams({
          api: "1",
          destination: activeRoute.nextStop.address
        });
        if (userLocation) {
          params.set("origin", `${userLocation.latitude},${userLocation.longitude}`);
        } else if (
          activeRoute.startedFromLat !== null &&
          activeRoute.startedFromLng !== null
        ) {
          params.set("origin", `${activeRoute.startedFromLat},${activeRoute.startedFromLng}`);
        }
        return `https://www.google.com/maps/dir/?${params.toString()}`;
      })()
    : null;

  useEffect(() => {
    const nextSearch = buildMapSearchParams({
      currentSearch: searchParams.toString(),
      selectedPropertyId,
      activeFilters,
      isResultsPanelVisible: isListVisible,
      isDrawerVisible,
      showTeamKnocks
    });
    const currentSearch = searchParams.toString();
    if (nextSearch === currentSearch) return;
    router.replace((nextSearch ? `${pathname}?${nextSearch}` : pathname) as Route, { scroll: false });
  }, [
    activeFilters,
    isDrawerVisible,
    isListVisible,
    pathname,
    router,
    searchParams,
    selectedPropertyId,
    showTeamKnocks
  ]);

  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] flex-col">
      <MapToolbar
        activeFilters={activeFilters}
        onToggle={handleToggleFilter}
        showTeamKnocks={showTeamKnocks}
        onToggleTeamKnocks={() => setShowTeamKnocks((current) => !current)}
        canToggleTeamKnocks={!isManager}
        showPriorityFilter={featureAccess.priorityScoringEnabled}
      />

      <div className="flex min-h-0 flex-1">
        <MapResultsSidebars
          items={filteredItems}
          selectedPropertyId={selectedPropertyId}
          onSelect={handleSelectProperty}
          routeSelectionMode={routeSelectionMode}
          selectedRouteLeadIds={selectedRouteLeadIdSet}
          onToggleRouteLead={toggleSelectedRouteLead}
          showPriority={featureAccess.priorityScoringEnabled}
          isResultsPanelVisible={isResultsPanelVisible}
          isResultsOpen={isResultsOpen}
          onOpenResults={() => setIsResultsOpen(true)}
          onCloseResults={() => setIsResultsOpen(false)}
        />

        <div className="relative flex-1 overflow-hidden bg-[linear-gradient(135deg,rgba(var(--app-surface-rgb),0.44)_0%,rgba(var(--app-background-accent-rgb),0.58)_100%)]">
          <MapPanelToggles
            isResultsPanelVisible={isResultsPanelVisible}
            isDrawerVisible={isDrawerVisible}
            onToggleResultsPanel={() => setIsResultsPanelVisible((current) => !current)}
            onToggleDrawer={() => setIsDrawerVisible((current) => !current)}
          />

        {activeRoute ? (
          <ActiveRoutePanel
            activeRoute={activeRoute}
            pendingRouteStops={pendingRouteStops}
            nextStopDirectionsUrl={nextStopDirectionsUrl}
            routeActionState={routeActionState}
            onOpenProperty={(propertyId) => {
              openSelectedProperty(propertyId);
              void refreshSelectedProperty(propertyId);
            }}
            onOptimizeRemainingStops={() => void handleOptimizeRemainingStops()}
            onSkipRouteStop={() => void handleSkipRouteStop()}
          />
        ) : routeSelectionMode ? (
          <RouteSelectionPanel
            routeSelectableItems={routeSelectableItems}
            selectedRouteLeadIds={selectedRouteLeadIds}
            selectedRouteItems={selectedRouteItems}
            routeActionState={routeActionState}
            routeBuilderError={routeBuilderError}
            onCancel={closeRouteSelection}
            onBuildRoute={() => void handleBuildRouteFromMapSelection()}
            onClear={clearSelectedRouteLeads}
            onOpenProperty={openSelectedProperty}
          />
        ) : null}

        <MapView
          ref={mapRef}
          {...viewState}
          onMove={(event) => setViewState(event.viewState)}
          onMoveEnd={handleMoveEnd}
          onClick={handleMapTap}
          interactiveLayerIds={INTERACTIVE_LAYER_IDS}
          mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
          dragRotate={false}
          attributionControl={false}
        >
          <NavigationControl position="top-right" showCompass={false} />
          <Source
            id={PROPERTY_SOURCE_ID}
            type="geojson"
            data={propertyFeatureCollection}
            cluster
            clusterMaxZoom={15}
            clusterRadius={54}
          >
            <Layer {...clusterCircleLayer} />
            <Layer {...clusterCountLayer} />
            <Layer {...propertySelectionHaloLayer} />
            <Layer {...propertyPointLayer} />
            <Layer {...propertyLabelLayer} />
          </Source>
          {userLocation ? (
            <Marker latitude={userLocation.latitude} longitude={userLocation.longitude} anchor="center">
              <div className="relative">
                <span className="absolute -inset-3 rounded-full bg-sky-500/20" />
                <span className="absolute -inset-1 rounded-full bg-sky-500/25 animate-ping" />
                <div className="app-glass-button relative flex items-center rounded-full p-1 shadow-lg">
                  <span className="block h-4 w-4 rounded-full border-4 border-white bg-sky-500 shadow" />
                </div>
              </div>
            </Marker>
          ) : null}
        </MapView>

          <MapStatusOverlay
            isSavingVisit={isSavingVisit}
            isResolvingTap={isResolvingTap}
            activeRoute={Boolean(activeRoute)}
            routeSelectionMode={routeSelectionMode}
          />
          <MapCenterLocationButton visible={Boolean(userLocation)} onCenter={handleCenterOnLocation} />
          {!activeRoute ? <RouteSelectionToggle routeSelectionMode={routeSelectionMode} onToggle={toggleRouteSelectionMode} /> : null}
          {selectedMapItem ? (
            <MobileSelectedPropertyChip
              address={selectedMapItem.address}
              visual={selectedVisual}
              onClear={closeSelectedProperty}
            />
          ) : null}
        </div>

        <PropertyDrawer
          property={selectedProperty}
          loading={propertyLoading}
          savingVisit={isSavingVisit}
          onLogOutcome={handleLogOutcome}
          onSaveLead={handleSaveLead}
          onCreateTask={handleCreateTask}
          desktopVisible={isDrawerVisible}
          onCloseDesktop={() => setIsDrawerVisible(false)}
          isOpen={Boolean(selectedPropertyId)}
          mobileOpenNonce={mobileOpenNonce}
          onDismiss={closeSelectedProperty}
        />
      </div>
    </div>
  );
}
