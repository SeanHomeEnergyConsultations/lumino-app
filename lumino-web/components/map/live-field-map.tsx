"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import Map, {
  Marker,
  NavigationControl,
  type MapLayerMouseEvent,
  type MapRef,
  type ViewStateChangeEvent
} from "react-map-gl/maplibre";
import type { ResolvePropertyResponse } from "@/types/api";
import type { LeadInput, MapProperty, PropertyDetail } from "@/types/entities";
import { MapToolbar, type MapFilterKey } from "@/components/map/map-toolbar";
import { PropertyResultsPanel } from "@/components/map/property-results-panel";
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
  initialSelectedPropertyId = null
}: {
  initialItems: MapProperty[];
  initialSelectedPropertyId?: string | null;
}) {
  const { session } = useAuth();
  const mapRef = useRef<MapRef | null>(null);
  const [items, setItems] = useState(initialItems);
  const [activeFilters, setActiveFilters] = useState<MapFilterKey[]>(["all"]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(initialSelectedPropertyId);
  const [selectedProperty, setSelectedProperty] = useState<PropertyDetail | null>(null);
  const [propertyLoading, setPropertyLoading] = useState(false);
  const [viewState, setViewState] = useState(DEFAULT_CENTER);
  const [isSavingVisit, setIsSavingVisit] = useState(false);
  const [isResolvingTap, setIsResolvingTap] = useState(false);

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
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setViewState((current) => ({
          ...current,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          zoom: 14
        }));
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 }
    );
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
      `/api/map/properties?minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}&limit=250`
    );
    if (!response.ok) return;
    const json = (await response.json()) as { items: MapProperty[] };
    setItems(json.items);
  }

  useEffect(() => {
    void loadPropertiesForViewport(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

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

  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] flex-col">
      <MapToolbar activeFilters={activeFilters} onToggle={handleToggleFilter} />

      <div className="flex min-h-0 flex-1">
      <PropertyResultsPanel items={filteredItems} selectedPropertyId={selectedPropertyId} onSelect={setSelectedPropertyId} />

      <div className="relative flex-1 overflow-hidden bg-[linear-gradient(135deg,#f8fafc_0%,#e7eef9_100%)]">
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
        </Map>

        <div className="absolute bottom-4 left-4 rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm text-slate-600 shadow-panel">
          {isSavingVisit
            ? "Saving visit..."
            : isResolvingTap
              ? "Opening property..."
              : "Pan the map, tap any property, log the outcome"}
        </div>

        {selectedMapItem ? (
          <div className="absolute right-4 top-4 rounded-2xl border border-slate-200 bg-white/92 px-4 py-3 text-sm text-slate-700 shadow-panel xl:hidden">
            <div className="font-semibold text-ink">{selectedMapItem.address}</div>
            <div className="mt-1 text-xs text-slate-500">
              {selectedMapItem.mapState} · {selectedMapItem.visitCount} visits
            </div>
          </div>
        ) : null}
      </div>

      <PropertyDrawer
        property={selectedProperty}
        loading={propertyLoading}
        savingVisit={isSavingVisit}
        onLogOutcome={handleLogOutcome}
        onSaveLead={handleSaveLead}
        isOpen={Boolean(selectedPropertyId)}
        onDismiss={() => {
          setSelectedPropertyId(null);
          setSelectedProperty(null);
          setPropertyLoading(false);
        }}
      />
      </div>
    </div>
  );
}
