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
  Marker,
  NavigationControl,
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

function markerVisual(mapState: MapProperty["mapState"]) {
  switch (mapState) {
    case "not_home":
      return { className: "bg-slate-500 text-white", icon: DoorOpen };
    case "left_doorhanger":
      return { className: "bg-violet-600 text-white", icon: FileBadge2 };
    case "opportunity":
      return { className: "bg-field text-white", icon: Handshake };
    case "interested":
      return { className: "bg-field text-white", icon: Handshake };
    case "callback_requested":
      return { className: "bg-alert text-white", icon: PhoneCall };
    case "not_interested":
      return { className: "bg-orange-500 text-white", icon: XCircle };
    case "disqualified":
      return { className: "bg-zinc-700 text-white", icon: BadgeHelp };
    case "do_not_knock":
      return { className: "bg-danger text-white", icon: Ban };
    case "follow_up_overdue":
      return { className: "bg-rose-600 text-white", icon: Clock3 };
    case "appointment_set":
      return { className: "bg-sky-600 text-white", icon: CalendarCheck2 };
    case "customer":
      return { className: "bg-emerald-600 text-white", icon: UserRoundCheck };
    case "canvassed_with_lead":
      return { className: "bg-ink text-white", icon: House };
    case "canvassed":
      return { className: "bg-slate-600 text-white", icon: CircleDashed };
    case "imported_target":
      return { className: "bg-amber-500 text-white", icon: HelpCircle };
    default:
      return { className: "bg-slate-400 text-white", icon: House };
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

    const minLat = "getSouth" in concreteBounds ? concreteBounds.getSouth() : viewState.latitude - 0.08;
    const maxLat = "getNorth" in concreteBounds ? concreteBounds.getNorth() : viewState.latitude + 0.08;
    const minLng = "getWest" in concreteBounds ? concreteBounds.getWest() : viewState.longitude - 0.08;
    const maxLng = "getEast" in concreteBounds ? concreteBounds.getEast() : viewState.longitude + 0.08;

    const response = await authFetch(
      session.access_token,
      `/api/map/properties?minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}&limit=1000${
        ownerIdFilter ? `&ownerId=${encodeURIComponent(ownerIdFilter)}` : ""
      }${cityFilter ? `&city=${encodeURIComponent(cityFilter)}` : ""}${
        stateFilter ? `&state=${encodeURIComponent(stateFilter)}` : ""
      }${showTeamKnocks ? "&showTeamKnocks=1" : ""}`
    );
    if (!response.ok) return;
    const json = (await response.json()) as { items: MapProperty[]; features?: OrganizationFeatureAccess };
    setItems(json.items);
    if (json.features) {
      setFeatureAccess(json.features);
    }
  }, [
    cityFilter,
    ownerIdFilter,
    session?.access_token,
    showTeamKnocks,
    stateFilter,
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
        current.map((item) =>
          item.propertyId === propertyId
            ? {
                ...item,
                visitCount: item.visitCount + 1,
                lastVisitOutcome: outcome,
                mapState:
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
                                : "canvassed_with_lead"
              }
            : item
        )
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
          mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
          dragRotate={false}
          attributionControl={false}
        >
          <NavigationControl position="top-right" showCompass={false} />
          {filteredItems.map((item) => {
            const visual = markerVisual(item.mapState);
            const Icon = visual.icon;
            const badge = markerBadge(item);
            const routeSequence = activeRouteStopSequenceByPropertyId.get(item.propertyId);

            return (
              <Marker key={item.propertyId} latitude={item.lat} longitude={item.lng} anchor="center">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (routeSelectionMode && item.leadId) {
                      toggleSelectedRouteLead(item.leadId);
                      return;
                    }
                    openSelectedProperty(item.propertyId);
                  }}
                  title={`${item.address} · ${item.mapState}`}
                  className={`flex h-11 w-11 items-center justify-center rounded-full border-2 shadow-lg transition focus:outline-none focus:ring-2 focus:ring-ink/30 ${
                    routeSelectionMode && item.leadId && selectedRouteLeadIdSet.has(item.leadId)
                      ? "border-field bg-white scale-110"
                      : selectedPropertyId === item.propertyId
                        ? "border-ink bg-white scale-110"
                        : "border-white bg-white/95 hover:scale-105"
                  }`}
                >
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full ${visual.className}`}>
                    <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
                  </span>
                  {routeSequence ? (
                    <span className="absolute -left-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-bold text-white shadow">
                      {routeSequence}
                    </span>
                  ) : null}
                  {badge ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-slate-700 shadow">
                      {badge}
                    </span>
                  ) : null}
                </button>
              </Marker>
            );
          })}
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
