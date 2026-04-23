"use client";

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
  Search,
  UserRoundCheck,
  XCircle
} from "lucide-react";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { SearchResponse } from "@/types/api";
import type { MapProperty } from "@/types/entities";
import { trackAppEvent } from "@/lib/analytics/app-events";
import { authFetch, useAuth } from "@/lib/auth/client";
import {
  buildRemotePropertySearchResults,
  buildVisiblePropertyResults,
  DEFAULT_RESULTS_RENDER_COUNT,
  type ResultItem
} from "@/components/map/property-results-helpers";

export function mapStateVisual(mapState: MapProperty["mapState"]) {
  switch (mapState) {
    case "not_home":
      return { icon: DoorOpen, className: "bg-slate-100 text-slate-700" };
    case "left_doorhanger":
      return { icon: FileBadge2, className: "bg-violet-100 text-violet-700" };
    case "opportunity":
      return { icon: Handshake, className: "bg-field/15 text-field" };
    case "interested":
      return { icon: Handshake, className: "bg-field/15 text-field" };
    case "callback_requested":
      return { icon: PhoneCall, className: "bg-alert/15 text-alert" };
    case "not_interested":
      return { icon: XCircle, className: "bg-orange-100 text-orange-600" };
    case "disqualified":
      return { icon: BadgeHelp, className: "bg-zinc-200 text-zinc-700" };
    case "do_not_knock":
      return { icon: Ban, className: "bg-rose-100 text-rose-600" };
    case "follow_up_overdue":
      return { icon: Clock3, className: "bg-rose-100 text-rose-600" };
    case "appointment_set":
      return { icon: CalendarCheck2, className: "bg-sky-100 text-sky-700" };
    case "customer":
      return { icon: UserRoundCheck, className: "bg-emerald-100 text-emerald-700" };
    case "canvassed_with_lead":
      return { icon: House, className: "bg-slate-200 text-slate-800" };
    case "canvassed":
      return { icon: CircleDashed, className: "bg-slate-100 text-slate-600" };
    case "imported_target":
      return { icon: HelpCircle, className: "bg-amber-100 text-amber-700" };
    default:
      return { icon: House, className: "bg-slate-100 text-slate-600" };
  }
}

const SEARCH_CACHE_LIMIT = 12;

const PropertyResultRow = memo(function PropertyResultRow({
  item,
  matchingMapItem,
  routeSelectionMode,
  isRouteSelected,
  selectedPropertyId,
  onSelect,
  onToggleRouteLead,
  showPriority
}: {
  item: ResultItem;
  matchingMapItem: MapProperty | null;
  routeSelectionMode: boolean;
  isRouteSelected: boolean;
  selectedPropertyId: string | null;
  onSelect: (propertyId: string) => void;
  onToggleRouteLead?: (leadId: string) => void;
  showPriority: boolean;
}) {
  const visual = matchingMapItem ? mapStateVisual(matchingMapItem.mapState) : mapStateVisual("imported_target");
  const Icon = visual.icon;
  const isRouteEligible = Boolean(matchingMapItem?.leadId);

  return (
    <button
      type="button"
      onClick={() => {
        if (routeSelectionMode && matchingMapItem?.leadId) {
          onToggleRouteLead?.(matchingMapItem.leadId);
          return;
        }
        trackAppEvent("map.result_selected", {
          propertyId: item.propertyId,
          routeSelectionMode
        });
        onSelect(item.propertyId);
      }}
      className={`w-full rounded-2xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-ink/30 ${
        routeSelectionMode && isRouteSelected
          ? "border-field bg-field/10 shadow-panel"
          : selectedPropertyId === item.propertyId
            ? "border-ink bg-ink text-white shadow-panel"
            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}
      style={{ contentVisibility: "auto", containIntrinsicSize: "120px" }}
      aria-pressed={routeSelectionMode ? isRouteSelected : selectedPropertyId === item.propertyId}
    >
      <div className="flex items-start gap-3">
        {routeSelectionMode ? (
          <span
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold ${
              isRouteSelected
                ? "border-field bg-field text-white"
                : isRouteEligible
                  ? "border-slate-300 bg-white text-transparent"
                  : "border-slate-200 bg-slate-100 text-slate-300"
            }`}
          >
            ✓
          </span>
        ) : null}
        <span
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            routeSelectionMode && isRouteSelected
              ? "bg-field text-white"
              : selectedPropertyId === item.propertyId
                ? "bg-white/15 text-white"
                : visual.className
          }`}
        >
          <Icon className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{item.address}</div>
          <div className={`mt-1 text-xs ${selectedPropertyId === item.propertyId ? "text-slate-200" : "text-slate-500"}`}>
            {item.subtitle}
          </div>
          {routeSelectionMode ? (
            <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              {isRouteEligible
                ? isRouteSelected
                  ? "Selected for route"
                  : "Tap to add to route"
                : "Needs a lead before it can be routed"}
            </div>
          ) : null}
          {showPriority && item.priorityScore !== undefined ? (
            <div className="mt-2 flex items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                  selectedPropertyId === item.propertyId
                    ? "bg-white/15 text-white"
                    : item.priorityBand === "high"
                      ? "bg-emerald-100 text-emerald-700"
                      : item.priorityBand === "medium"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-slate-100 text-slate-600"
                }`}
              >
                {item.priorityBand ?? "low"} priority
              </span>
              <span className={`text-[11px] font-semibold ${selectedPropertyId === item.propertyId ? "text-slate-200" : "text-slate-500"}`}>
                {item.priorityScore}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
});

export function PropertyResultsPanel({
  items,
  selectedPropertyId,
  onSelect,
  routeSelectionMode = false,
  selectedRouteLeadIds = new Set<string>(),
  onToggleRouteLead,
  className = "app-sidebar-surface relative z-20 hidden w-80 shrink-0 border-r xl:block",
  showHeader = true,
  showPriority = true
}: {
  items: MapProperty[];
  selectedPropertyId: string | null;
  onSelect: (propertyId: string) => void;
  routeSelectionMode?: boolean;
  selectedRouteLeadIds?: Set<string>;
  onToggleRouteLead?: (leadId: string) => void;
  className?: string;
  showHeader?: boolean;
  showPriority?: boolean;
}) {
  const { session } = useAuth();
  const [query, setQuery] = useState("");
  const [remoteResults, setRemoteResults] = useState<ResultItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(DEFAULT_RESULTS_RENDER_COUNT);
  const searchCacheRef = useRef<Map<string, ResultItem[]>>(new Map());
  const deferredQuery = useDeferredValue(query);
  const trimmedQuery = deferredQuery.trim();
  const localItemByPropertyId = useMemo(
    () => new Map(items.map((item) => [item.propertyId, item])),
    [items]
  );

  useEffect(() => {
    setVisibleCount(DEFAULT_RESULTS_RENDER_COUNT);
  }, [trimmedQuery, items.length]);

  useEffect(() => {
    const trimmed = trimmedQuery;
    if (!session?.access_token || trimmed.length < 2) {
      setRemoteResults([]);
      setSearchLoading(false);
      return;
    }

    const cachedResults = searchCacheRef.current.get(trimmed);
    if (cachedResults) {
      setRemoteResults(cachedResults);
      setSearchLoading(false);
      return;
    }

    const timeout = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const response = await authFetch(
          session.access_token,
          `/api/search?q=${encodeURIComponent(trimmed)}`
        );
        if (!response.ok) {
          setRemoteResults([]);
          return;
        }
        const json = (await response.json()) as SearchResponse;
        const nextResults = buildRemotePropertySearchResults(json.items);
        trackAppEvent("map.results_searched", {
          queryLength: trimmed.length,
          results: nextResults.length
        });
        searchCacheRef.current.set(trimmed, nextResults);
        if (searchCacheRef.current.size > SEARCH_CACHE_LIMIT) {
          const oldestKey = searchCacheRef.current.keys().next().value;
          if (oldestKey) {
            searchCacheRef.current.delete(oldestKey);
          }
        }
        setRemoteResults(nextResults);
      } finally {
        setSearchLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [session?.access_token, trimmedQuery]);

  const visibleItems = useMemo(() => {
    return buildVisiblePropertyResults({
      items,
      query: trimmedQuery,
      remoteResults
    });
  }, [items, remoteResults, trimmedQuery]);
  const renderedItems = useMemo(
    () => visibleItems.slice(0, visibleCount),
    [visibleCount, visibleItems]
  );

  return (
    <aside className={className}>
      {showHeader ? (
        <div className="border-b border-slate-200/80 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Nearby Targets</div>
        <div className="mt-1 text-sm text-slate-600">{items.length} properties in view</div>
        {routeSelectionMode ? (
          <div className="mt-2 rounded-2xl border border-[rgba(var(--app-primary-rgb),0.14)] bg-[rgba(var(--app-primary-rgb),0.92)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white">
            Route selection on · tap pins or list rows to build a run
          </div>
        ) : null}
        <div className="app-chip mt-3 flex items-center gap-2 rounded-2xl px-3 py-2 shadow-sm">
          <Search className="h-4 w-4 text-slate-400" />
          <label className="sr-only" htmlFor="property-results-search">
            Search visible properties
          </label>
          <input
            id="property-results-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a property from your list"
            className="app-focus-ring w-full bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
            aria-describedby="property-results-count"
          />
          </div>
        </div>
      ) : null}
      <div className="max-h-[calc(100vh-8rem)] space-y-2 overflow-y-auto p-3">
        <div id="property-results-count" className="sr-only" aria-live="polite">
          {visibleItems.length} properties available in the results list.
        </div>
        {searchLoading ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-3 text-sm text-slate-500">
            Searching properties…
          </div>
        ) : visibleItems.length ? (
          <>
            {renderedItems.map((item) => {
              const matchingMapItem = localItemByPropertyId.get(item.propertyId) ?? null;
              const isRouteSelected = Boolean(matchingMapItem?.leadId && selectedRouteLeadIds.has(matchingMapItem.leadId));

              return (
                <PropertyResultRow
                  key={item.propertyId}
                  item={item}
                  matchingMapItem={matchingMapItem}
                  routeSelectionMode={routeSelectionMode}
                  isRouteSelected={isRouteSelected}
                  selectedPropertyId={selectedPropertyId}
                  onSelect={onSelect}
                  onToggleRouteLead={onToggleRouteLead}
                  showPriority={showPriority}
                />
              );
            })}
            {visibleItems.length > renderedItems.length ? (
              <button
                type="button"
                onClick={() => {
                  setVisibleCount((current) => current + DEFAULT_RESULTS_RENDER_COUNT);
                  trackAppEvent("map.results_expanded", {
                    totalResults: visibleItems.length
                  });
                }}
                className="app-focus-ring w-full rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Show {Math.min(DEFAULT_RESULTS_RENDER_COUNT, visibleItems.length - renderedItems.length)} more results
              </button>
            ) : null}
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 p-3 text-sm text-slate-500">
            {trimmedQuery.length >= 2 ? "No matching properties found." : "No nearby properties yet."}
          </div>
        )}
      </div>
    </aside>
  );
}
