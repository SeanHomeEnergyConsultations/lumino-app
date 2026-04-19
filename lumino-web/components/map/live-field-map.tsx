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
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PhoneCall,
  UserRoundCheck,
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
import type { LeadInput, MapProperty, PropertyDetail, TaskInput } from "@/types/entities";
import { MapToolbar, type MapFilterKey } from "@/components/map/map-toolbar";
import { PropertyResultsPanel, mapStateVisual } from "@/components/map/property-results-panel";
import { PropertyDrawer } from "@/components/map/property-drawer";
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
  stateFilter = null
}: {
  initialItems: MapProperty[];
  initialSelectedPropertyId?: string | null;
  initialFilters?: MapFilterKey[];
  ownerIdFilter?: string | null;
  cityFilter?: string | null;
  stateFilter?: string | null;
}) {
  const { session } = useAuth();
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

  const selectedMapItem = useMemo(
    () => items.find((item) => item.propertyId === selectedPropertyId) ?? null,
    [items, selectedPropertyId]
  );

  const filteredItems = useMemo(() => {
    if (activeFilters.includes("all")) return items;
    return items.filter((item) => {
      if (item.mapState !== "canvassed_with_lead" && activeFilters.includes(item.mapState as MapFilterKey)) return true;
      return false;
    });
  }, [activeFilters, items]);

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
      `/api/map/properties?minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}&limit=250${
        ownerIdFilter ? `&ownerId=${encodeURIComponent(ownerIdFilter)}` : ""
      }${cityFilter ? `&city=${encodeURIComponent(cityFilter)}` : ""}${
        stateFilter ? `&state=${encodeURIComponent(stateFilter)}` : ""
      }`
    );
    if (!response.ok) return;
    const json = (await response.json()) as { items: MapProperty[] };
    setItems(json.items);
  }

  useEffect(() => {
    void loadPropertiesForViewport(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token, ownerIdFilter, cityFilter, stateFilter]);

  useEffect(() => {
    if (!session?.access_token || !selectedPropertyId) {
      setPropertyLoading(false);
      setSelectedProperty(null);
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

  async function handleMapTap(event: MapLayerMouseEvent) {
    if (!session?.access_token || isResolvingTap) return;
    if (typeof window !== "undefined" && window.innerWidth < 1280 && selectedPropertyId) {
      setSelectedPropertyId(null);
      setSelectedProperty(null);
      setIsResultsOpen(false);
      return;
    }

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
      setSelectedPropertyId(json.propertyId);
      setIsDrawerVisible(true);
      await refreshSelectedProperty(json.propertyId);
    } finally {
      setIsResolvingTap(false);
    }
  }

  async function handleLogOutcome(outcome: string) {
    if (!selectedMapItem || !session?.access_token) return;
    try {
      setIsSavingVisit(true);
      const response = await authFetch(session.access_token, "/api/visits", {
        method: "POST",
        body: JSON.stringify({
          propertyId: selectedMapItem.propertyId,
          lat: selectedMapItem.lat,
          lng: selectedMapItem.lng,
          outcome
        })
      });

      if (!response.ok) return;

      setItems((current) =>
        current.map((item) =>
          item.propertyId === selectedMapItem.propertyId
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
      await refreshSelectedProperty(selectedMapItem.propertyId);
    } finally {
      setIsSavingVisit(false);
    }
  }

  async function handleSaveLead(input: LeadInput) {
    if (!session?.access_token) return;
    const response = await authFetch(session.access_token, "/api/leads", {
      method: "POST",
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      throw new Error("Failed to save lead");
    }

    await refreshSelectedProperty(input.propertyId);
  }

  async function handleCreateTask(input: TaskInput) {
    if (!session?.access_token) return;
    const response = await authFetch(session.access_token, "/api/tasks", {
      method: "POST",
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      throw new Error("Failed to save task");
    }

    if (input.propertyId) {
      await refreshSelectedProperty(input.propertyId);
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

      const withoutAll = current.filter((item) => item !== "all");
      const exists = withoutAll.includes(filter);
      const next = exists ? withoutAll.filter((item) => item !== filter) : [...withoutAll, filter];
      return next.length ? next : ["all"];
    });
  }

  const selectedVisual = selectedMapItem ? mapStateVisual(selectedMapItem.mapState) : null;

  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] flex-col">
      <MapToolbar activeFilters={activeFilters} onToggle={handleToggleFilter} />

      <div className="flex min-h-0 flex-1">
      <PropertyResultsPanel
        items={filteredItems}
        selectedPropertyId={selectedPropertyId}
        onSelect={(propertyId) => {
          setSelectedPropertyId(propertyId);
          setIsDrawerVisible(true);
        }}
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
                    setSelectedPropertyId(item.propertyId);
                    setIsDrawerVisible(true);
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
                <span className="absolute inset-0 rounded-full bg-sky-500/30 animate-ping" />
                <span className="relative block h-5 w-5 rounded-full border-4 border-white bg-sky-500 shadow-lg" />
              </div>
            </Marker>
          ) : null}
        </Map>

        <div className="absolute bottom-4 left-4 rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm text-slate-600 shadow-panel">
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
            className="absolute bottom-20 right-4 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-panel transition hover:bg-white"
            aria-label="Center on my location"
          >
            <LocateFixed className="h-5 w-5" />
          </button>
        ) : null}

        {selectedMapItem ? (
          <div className="absolute right-4 top-4 rounded-2xl border border-slate-200 bg-white/92 px-4 py-3 text-sm text-slate-700 shadow-panel xl:hidden">
            <div className="flex items-center gap-3">
              {selectedVisual ? (
                <span className={`flex h-8 w-8 items-center justify-center rounded-full ${selectedVisual.className}`}>
                  <selectedVisual.icon className="h-4 w-4" strokeWidth={2.2} />
                </span>
              ) : null}
              <div>
                <div className="font-semibold text-ink">{selectedMapItem.address}</div>
                <div className="mt-1 text-xs text-slate-500">{selectedMapItem.visitCount} visits</div>
              </div>
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setIsResultsOpen(true)}
          className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-sm font-semibold text-slate-700 shadow-panel xl:hidden"
        >
          <MapPinned className="h-4 w-4" />
          Nearby
        </button>
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
