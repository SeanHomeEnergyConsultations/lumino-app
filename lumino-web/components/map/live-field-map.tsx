"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  MapPinned,
  Map as MapIcon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PhoneCall,
  UserRoundCheck,
  X,
  XCircle
} from "lucide-react";
import Map, {
  Marker,
  NavigationControl,
  type MapLayerMouseEvent,
  type MapRef,
  type ViewStateChangeEvent
} from "react-map-gl/maplibre";
import type { ResolvePropertyResponse } from "@/types/api";
import type { LeadInput, MapProperty, OrganizationFeatureAccess, PropertyDetail, TaskInput } from "@/types/entities";
import { MapToolbar, type MapFilterKey } from "@/components/map/map-toolbar";
import { PropertyResultsPanel, mapStateVisual } from "@/components/map/property-results-panel";
import { PropertyDrawer } from "@/components/map/property-drawer";
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
  stateFilter = null
}: {
  initialItems: MapProperty[];
  initialSelectedPropertyId?: string | null;
  initialFilters?: MapFilterKey[];
  ownerIdFilter?: string | null;
  cityFilter?: string | null;
  stateFilter?: string | null;
}) {
  const { session, appContext } = useAuth();
  const isManager = useMemo(
    () => (appContext ? hasManagerAccess(appContext) : false),
    [appContext]
  );
  const mapRef = useRef<MapRef | null>(null);
  const hasAutoCenteredOnUserRef = useRef(false);
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
  const [isResultsPanelVisible, setIsResultsPanelVisible] = useState(true);
  const [isDrawerVisible, setIsDrawerVisible] = useState(true);
  const [mobileOpenNonce, setMobileOpenNonce] = useState(0);
  const [showTeamKnocks, setShowTeamKnocks] = useState(isManager);
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
    if (!session?.access_token || isResolvingTap) return;

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

  async function handleLogOutcome(outcome: string) {
    if (!selectedProperty || !session?.access_token) return;
    try {
      setIsSavingVisit(true);
      const propertyId = await ensurePersistedSelectedProperty();
      const response = await authFetch(session.access_token, "/api/visits", {
        method: "POST",
        body: JSON.stringify({
          propertyId,
          lat: selectedProperty.lat,
          lng: selectedProperty.lng,
          outcome
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
        showPriority={featureAccess.priorityScoringEnabled}
        className={`relative z-20 shrink-0 border-r border-slate-200/80 bg-white/80 backdrop-blur ${isResultsPanelVisible ? "hidden w-80 xl:block" : "hidden xl:hidden"}`}
      />

      <div className="relative flex-1 overflow-hidden bg-[linear-gradient(135deg,#f8fafc_0%,#e7eef9_100%)]">
        <div className="absolute left-4 top-4 z-20 hidden items-center gap-2 xl:flex">
          <button
            type="button"
            onClick={() => setIsResultsPanelVisible((current) => !current)}
            className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-sm font-semibold text-slate-700 shadow-panel transition hover:bg-white"
          >
            {isResultsPanelVisible ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            {isResultsPanelVisible ? "Hide List" : "Show List"}
          </button>
          <button
            type="button"
            onClick={() => setIsDrawerVisible((current) => !current)}
            className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-sm font-semibold text-slate-700 shadow-panel transition hover:bg-white"
          >
            {isDrawerVisible ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            {isDrawerVisible ? "Hide Details" : "Show Details"}
          </button>
        </div>

        <Map
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

            return (
              <Marker key={item.propertyId} latitude={item.lat} longitude={item.lng} anchor="center">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openSelectedProperty(item.propertyId);
                  }}
                  title={`${item.address} · ${item.mapState}`}
                  className={`flex h-11 w-11 items-center justify-center rounded-full border-2 shadow-lg transition focus:outline-none focus:ring-2 focus:ring-ink/30 ${
                    selectedPropertyId === item.propertyId ? "border-ink bg-white scale-110" : "border-white bg-white/95 hover:scale-105"
                  }`}
                >
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full ${visual.className}`}>
                    <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
                  </span>
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
                <div className="relative flex items-center gap-2 rounded-full border border-sky-200 bg-white/95 px-2 py-1 shadow-lg">
                  <span className="block h-4 w-4 rounded-full border-4 border-white bg-sky-500 shadow" />
                  <span className="text-xs font-semibold text-sky-700">You</span>
                </div>
              </div>
            </Marker>
          ) : null}
        </Map>

        <div className="absolute bottom-24 left-4 right-4 rounded-2xl border border-slate-200 bg-white/92 px-4 py-3 text-sm text-slate-600 shadow-panel sm:right-auto sm:rounded-full sm:py-2 xl:bottom-4">
          {isSavingVisit
            ? "Saving visit..."
            : isResolvingTap
              ? "Opening property..."
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
            className="absolute bottom-40 right-4 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-panel transition hover:bg-white sm:bottom-20"
            aria-label="Center on my location"
          >
            <LocateFixed className="h-5 w-5" />
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setIsResultsOpen(true)}
          className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-sm font-semibold text-slate-700 shadow-panel xl:hidden"
        >
          <MapIcon className="h-4 w-4" />
          List
        </button>
        {selectedMapItem ? (
          <div className="absolute right-4 top-4 xl:hidden">
            <button
              type="button"
              onClick={() => {
                setSelectedPropertyId(null);
                setSelectedProperty(null);
                setPropertyLoading(false);
              }}
              className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-2 text-sm font-semibold text-slate-700 shadow-panel"
            >
              {selectedVisual ? (
                <span className={`flex h-7 w-7 items-center justify-center rounded-full ${selectedVisual.className}`}>
                  <selectedVisual.icon className="h-4 w-4" strokeWidth={2.2} />
                </span>
              ) : null}
              <span className="max-w-[10rem] truncate">{selectedMapItem.address}</span>
              <X className="h-4 w-4 text-slate-400" />
            </button>
          </div>
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
            className="absolute inset-x-0 bottom-0 max-h-[70vh] rounded-t-[2rem] border border-slate-200 bg-white shadow-2xl"
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
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600"
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
              showPriority={featureAccess.priorityScoringEnabled}
              className="block max-h-[calc(70vh-4.5rem)] w-full overflow-y-auto bg-white"
              showHeader={false}
            />
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}
