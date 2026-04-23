"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
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
  LocateFixed,
  Map as MapIcon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
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
import type { ActiveRouteRunResponse, ResolvePropertyResponse } from "@/types/api";
import type { LeadInput, MapProperty, OrganizationFeatureAccess, PropertyDetail, TaskInput } from "@/types/entities";
import { MapToolbar, type MapFilterKey } from "@/components/map/map-toolbar";
import { PropertyResultsPanel, mapStateVisual } from "@/components/map/property-results-panel";
import { PropertyDrawer } from "@/components/map/property-drawer";
import {
  ActiveRoutePanel,
  MobileSelectedPropertyChip,
  RouteSelectionPanel,
  RouteSelectionToggle
} from "@/components/map/route-overlays";
import { useRouteSelection } from "@/components/map/use-route-selection";
import { hasManagerAccess } from "@/lib/auth/permissions";
import { authFetch, useAuth } from "@/lib/auth/client";

function previewSelectionKey(lat: number, lng: number) {
  return `preview:${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function buildPreviewPropertyDetail(input: {
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  lat: number;
  lng: number;
  featureAccess: OrganizationFeatureAccess;
}): PropertyDetail {
  return {
    propertyId: previewSelectionKey(input.lat, input.lng),
    address: input.address,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    lat: input.lat,
    lng: input.lng,
    mapState: "unworked_property",
    followUpState: "none",
    visitCount: 0,
    notHomeCount: 0,
    lastVisitOutcome: null,
    lastVisitedAt: null,
    leadId: null,
    leadStatus: null,
    ownerId: null,
    firstName: null,
    lastName: null,
    phone: null,
    email: null,
    leadNotes: null,
    leadNextFollowUpAt: null,
    appointmentAt: null,
    priorityScore: 0,
    priorityBand: "low",
    prioritySummary: "This location has not been saved yet. Log an outcome or save contact data to keep it.",
    featureAccess: input.featureAccess,
    recentVisits: [],
    recentActivities: [],
    facts: {
      beds: null,
      baths: null,
      squareFeet: null,
      lotSizeSqft: null,
      yearBuilt: null,
      lastSaleDate: null,
      lastSalePrice: null,
      propertyType: null,
      listingStatus: null,
      saleType: null,
      daysOnMarket: null,
      hoaMonthly: null,
      dataCompletenessScore: null,
      solarFitScore: null,
      roofCapacityScore: null,
      roofComplexityScore: null,
      estimatedSystemCapacityKw: null,
      estimatedYearlyEnergyKwh: null,
      solarImageryQuality: null,
      propertyPriorityScore: null,
      propertyPriorityLabel: null
    },
    enrichments: [],
    sourceRecords: [],
    isPreview: true
  };
}

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
  const { session, appContext } = useAuth();
  const isManager = useMemo(
    () => (appContext ? hasManagerAccess(appContext) : false),
    [appContext]
  );
  const mapRef = useRef<MapRef | null>(null);
  const hasAutoCenteredOnUserRef = useRef(false);
  const hasHandledInitialAddressSearchRef = useRef(false);
  const [items, setItems] = useState(initialItems);
  const [activeFilters, setActiveFilters] = useState<MapFilterKey[]>(initialFilters);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(initialSelectedPropertyId);
  const [selectedProperty, setSelectedProperty] = useState<PropertyDetail | null>(null);
  const [propertyLoading, setPropertyLoading] = useState(false);
  const [viewState, setViewState] = useState(DEFAULT_CENTER);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isSavingVisit, setIsSavingVisit] = useState(false);
  const [isResolvingTap, setIsResolvingTap] = useState(false);
  const [isResultsOpen, setIsResultsOpen] = useState(false);
  const [isResultsPanelVisible, setIsResultsPanelVisible] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [mobileOpenNonce, setMobileOpenNonce] = useState(0);
  const [showTeamKnocks, setShowTeamKnocks] = useState(isManager);
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

  const selectedMapItem = useMemo(
    () => items.find((item) => item.propertyId === selectedPropertyId) ?? null,
    [items, selectedPropertyId]
  );

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

  useEffect(() => {
    setSelectedPropertyId(initialSelectedPropertyId);
  }, [initialSelectedPropertyId]);

  useEffect(() => {
    if (selectedPropertyId) {
      setIsDrawerVisible(true);
    }
  }, [selectedPropertyId]);

  useEffect(() => {
    setActiveFilters(initialFilters.length ? initialFilters : ["all"]);
  }, [initialFilters]);

  useEffect(() => {
    setShowTeamKnocks(isManager);
  }, [isManager]);

  useEffect(() => {
    if (featureAccess.priorityScoringEnabled) return;
    setActiveFilters((current) => {
      const next = current.filter((filter) => filter !== "high_priority");
      return next.length ? next : ["all"];
    });
  }, [featureAccess.priorityScoringEnabled]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    const success = (position: GeolocationPosition) => {
      const nextLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
      setUserLocation(nextLocation);
      if (!hasAutoCenteredOnUserRef.current) {
        hasAutoCenteredOnUserRef.current = true;
        setViewState((current) => ({
          ...current,
          latitude: nextLocation.latitude,
          longitude: nextLocation.longitude,
          zoom: Math.max(current.zoom, 18)
        }));
      }
    };

    navigator.geolocation.getCurrentPosition(success, () => undefined, {
      enableHighAccuracy: true,
      maximumAge: 30000,
      timeout: 10000
    });

    const watchId = navigator.geolocation.watchPosition(success, () => undefined, {
      enableHighAccuracy: true,
      maximumAge: 15000,
      timeout: 10000
    });

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

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

  async function loadPropertiesForViewport(bounds?: maplibregl.LngLatBoundsLike | null) {
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
  }

  useEffect(() => {
    void loadPropertiesForViewport(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token, ownerIdFilter, cityFilter, stateFilter, showTeamKnocks]);

  useEffect(() => {
    void loadActiveRoute();
  }, [loadActiveRoute]);

  useEffect(() => {
    if (!session?.access_token || !selectedPropertyId) {
      setPropertyLoading(false);
      if (!selectedProperty?.isPreview) {
        setSelectedProperty(null);
      }
      return;
    }

    if (selectedPropertyId.startsWith("preview:")) {
      setPropertyLoading(false);
      return;
    }

    let cancelled = false;
    setPropertyLoading(true);
    authFetch(session.access_token, `/api/properties/${selectedPropertyId}`)
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { item: PropertyDetail };
      })
      .then((json) => {
        if (!cancelled) {
          setSelectedProperty(json?.item ?? null);
          if (json?.item?.featureAccess) {
            setFeatureAccess(json.item.featureAccess);
          }
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPropertyLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPropertyId, session?.access_token]);

  useEffect(() => {
    if (!selectedProperty?.lat || !selectedProperty?.lng) return;

    setViewState((current) => ({
      ...current,
      latitude: selectedProperty.lat ?? current.latitude,
      longitude: selectedProperty.lng ?? current.longitude,
      zoom: Math.max(current.zoom, 16)
    }));
  }, [selectedProperty?.lat, selectedProperty?.lng]);

  useEffect(() => {
    if (selectedPropertyId || !activeRoute?.nextStop?.propertyId || !session?.access_token) return;
    openSelectedProperty(activeRoute.nextStop.propertyId);
    void refreshSelectedProperty(activeRoute.nextStop.propertyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoute?.nextStop?.propertyId, selectedPropertyId, session?.access_token]);

  async function refreshSelectedProperty(propertyId: string) {
    if (!session?.access_token) return;

    const [detailResponse] = await Promise.all([
      authFetch(session.access_token, `/api/properties/${propertyId}`),
      loadPropertiesForViewport(mapRef.current?.getBounds() ?? null)
    ]);

    if (detailResponse.ok) {
      const detailJson = (await detailResponse.json()) as { item: PropertyDetail };
      setSelectedProperty(detailJson.item);
    }
  }

  function openSelectedProperty(propertyId: string) {
    setSelectedPropertyId(propertyId);
    setIsDrawerVisible(true);
    setMobileOpenNonce((current) => current + 1);
  }

  async function ensurePersistedSelectedProperty() {
    if (!session?.access_token || !selectedProperty?.lat || !selectedProperty?.lng) {
      throw new Error("This property location could not be saved.");
    }

    if (!selectedProperty.isPreview && selectedPropertyId && !selectedPropertyId.startsWith("preview:")) {
      return selectedPropertyId;
    }

    const response = await authFetch(session.access_token, "/api/properties/resolve?commit=1", {
      method: "POST",
      body: JSON.stringify({
        lat: selectedProperty.lat,
        lng: selectedProperty.lng
      })
    });

    if (!response.ok) {
      throw new Error("Failed to save property location.");
    }

    const json = (await response.json()) as ResolvePropertyResponse;
    if (!json.propertyId) {
      throw new Error("Could not persist property location.");
    }

    setSelectedPropertyId(json.propertyId);
    await refreshSelectedProperty(json.propertyId);
    return json.propertyId;
  }

  async function handleMapTap(event: MapLayerMouseEvent) {
    if (!session?.access_token || isResolvingTap || routeSelectionMode) return;

    try {
      setIsResolvingTap(true);
      const response = await authFetch(session.access_token, "/api/properties/resolve", {
        method: "POST",
        body: JSON.stringify({
          lat: event.lngLat.lat,
          lng: event.lngLat.lng
        })
      });

      if (!response.ok) return;
      const json = (await response.json()) as ResolvePropertyResponse;
      if (json.propertyId) {
        openSelectedProperty(json.propertyId);
        await refreshSelectedProperty(json.propertyId);
        return;
      }

      if (!json.preview) return;

      openSelectedProperty(previewSelectionKey(json.preview.lat, json.preview.lng));
      setSelectedProperty(buildPreviewPropertyDetail({
        ...json.preview,
        featureAccess
      }));
    } finally {
      setIsResolvingTap(false);
    }
  }

  async function handleAddressSearch(address: string) {
    if (!session?.access_token || isResolvingTap) return;

    try {
      setIsResolvingTap(true);
      const response = await authFetch(session.access_token, "/api/properties/resolve", {
        method: "POST",
        body: JSON.stringify({
          address
        })
      });

      if (!response.ok) return;
      const json = (await response.json()) as ResolvePropertyResponse;
      if (json.propertyId) {
        openSelectedProperty(json.propertyId);
        await refreshSelectedProperty(json.propertyId);
        return;
      }

      if (!json.preview) return;

      setViewState((current) => ({
        ...current,
        latitude: json.preview?.lat ?? current.latitude,
        longitude: json.preview?.lng ?? current.longitude,
        zoom: Math.max(current.zoom, 16)
      }));
      openSelectedProperty(previewSelectionKey(json.preview.lat, json.preview.lng));
      setSelectedProperty(
        buildPreviewPropertyDetail({
          ...json.preview,
          featureAccess
        })
      );
    } finally {
      setIsResolvingTap(false);
    }
  }

  useEffect(() => {
    const trimmed = initialAddressSearch?.trim();
    if (!session?.access_token || !trimmed || hasHandledInitialAddressSearchRef.current) return;
    hasHandledInitialAddressSearchRef.current = true;
    void handleAddressSearch(trimmed);
  }, [initialAddressSearch, session?.access_token]);

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
      if (refreshedRoute?.nextStop?.propertyId) {
        openSelectedProperty(refreshedRoute.nextStop.propertyId);
        await refreshSelectedProperty(refreshedRoute.nextStop.propertyId);
      } else {
        setSelectedPropertyId(null);
        setSelectedProperty(null);
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

  const selectedVisual = selectedMapItem ? mapStateVisual(selectedMapItem.mapState) : null;
  const pendingRouteStops = activeRoute?.stops.filter((stop) => stop.stopStatus === "pending") ?? [];
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
      <PropertyResultsPanel
        items={filteredItems}
        selectedPropertyId={selectedPropertyId}
        onSelect={(propertyId) => {
          openSelectedProperty(propertyId);
        }}
        routeSelectionMode={routeSelectionMode}
        selectedRouteLeadIds={new Set(selectedRouteLeadIds)}
        onToggleRouteLead={toggleSelectedRouteLead}
        showPriority={featureAccess.priorityScoringEnabled}
        className={`app-sidebar-surface relative z-20 shrink-0 border-r ${isResultsPanelVisible ? "hidden w-80 xl:block" : "hidden xl:hidden"}`}
      />

      <div className="relative flex-1 overflow-hidden bg-[linear-gradient(135deg,rgba(var(--app-surface-rgb),0.44)_0%,rgba(var(--app-background-accent-rgb),0.58)_100%)]">
        <div className="absolute left-4 top-4 z-20 hidden items-center gap-2 xl:flex">
          <button
            type="button"
            onClick={() => setIsResultsPanelVisible((current) => !current)}
            className="app-glass-button flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-slate-700 shadow-panel transition hover:bg-white/90"
          >
            {isResultsPanelVisible ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            {isResultsPanelVisible ? "Hide List" : "Show List"}
          </button>
          <button
            type="button"
            onClick={() => setIsDrawerVisible((current) => !current)}
            className="app-glass-button flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-slate-700 shadow-panel transition hover:bg-white/90"
          >
            {isDrawerVisible ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            {isDrawerVisible ? "Hide Details" : "Show Details"}
          </button>
        </div>

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
                    routeSelectionMode && item.leadId && selectedRouteLeadIds.includes(item.leadId)
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

        <div className="app-glass-button absolute bottom-24 left-4 right-4 rounded-2xl px-4 py-3 text-sm text-slate-600 shadow-panel sm:right-auto sm:rounded-full sm:py-2 xl:bottom-4">
          {isSavingVisit
            ? "Saving visit..."
            : isResolvingTap
              ? "Opening property..."
              : activeRoute
                ? "Active route live. Work the next stop, then keep moving."
                : routeSelectionMode
                  ? "Route selection is on. Tap route-ready pins to add them."
                  : "Pan the map, tap any property, log the outcome"}
        </div>
        {userLocation ? (
          <button
            type="button"
            onClick={() =>
              setViewState((current) => ({
                ...current,
                latitude: userLocation.latitude,
                longitude: userLocation.longitude,
                zoom: Math.max(current.zoom, 18)
              }))
            }
            className="app-glass-button absolute bottom-40 right-4 flex h-11 w-11 items-center justify-center rounded-full text-slate-700 shadow-panel transition hover:bg-white/90 sm:bottom-20"
            aria-label="Center on my location"
          >
            <LocateFixed className="h-5 w-5" />
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setIsResultsOpen(true)}
          className="app-glass-button absolute left-4 top-4 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-slate-700 shadow-panel xl:hidden"
        >
          <MapIcon className="h-4 w-4" />
          List
        </button>
        {!activeRoute ? <RouteSelectionToggle routeSelectionMode={routeSelectionMode} onToggle={toggleRouteSelectionMode} /> : null}
        {selectedMapItem ? (
          <MobileSelectedPropertyChip
            address={selectedMapItem.address}
            visual={selectedVisual}
            onClear={() => {
              setSelectedPropertyId(null);
              setSelectedProperty(null);
              setPropertyLoading(false);
            }}
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
        onDismiss={() => {
          setSelectedPropertyId(null);
          setSelectedProperty(null);
          setPropertyLoading(false);
        }}
      />
      {isResultsOpen ? (
        <div className="fixed inset-0 z-30 bg-slate-950/20 xl:hidden" onClick={() => setIsResultsOpen(false)}>
          <div
            className="app-panel absolute inset-x-0 bottom-0 max-h-[70vh] rounded-t-[2rem] border shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Nearby Targets</div>
                <div className="mt-1 text-sm text-slate-600">{filteredItems.length} properties in view</div>
              </div>
              <button
                type="button"
                onClick={() => setIsResultsOpen(false)}
                className="app-glass-button flex h-9 w-9 items-center justify-center rounded-full text-slate-600"
                aria-label="Hide nearby targets"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
            <PropertyResultsPanel
              items={filteredItems}
              selectedPropertyId={selectedPropertyId}
              onSelect={(propertyId) => {
                setSelectedPropertyId(propertyId);
                setIsResultsOpen(false);
              }}
              routeSelectionMode={routeSelectionMode}
              selectedRouteLeadIds={new Set(selectedRouteLeadIds)}
              onToggleRouteLead={toggleSelectedRouteLead}
              showPriority={featureAccess.priorityScoringEnabled}
              className="block max-h-[calc(70vh-4.5rem)] w-full overflow-y-auto"
              showHeader={false}
            />
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}
