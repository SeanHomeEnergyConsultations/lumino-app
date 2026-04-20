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
import { useEffect, useMemo, useState } from "react";
import type { SearchResponse } from "@/types/api";
import type { MapProperty } from "@/types/entities";
import { authFetch, useAuth } from "@/lib/auth/client";

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

type ResultItem = {
  propertyId: string;
  address: string;
  subtitle: string;
  mapState?: MapProperty["mapState"];
  visitCount?: number;
  notHomeCount?: number;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  priorityScore?: number;
  priorityBand?: MapProperty["priorityBand"];
};

function identityKey(item: ResultItem) {
  const line1 = item.address.split(",")[0]?.trim().toLowerCase() ?? "";
  const city = (item.city ?? "").trim().toLowerCase();
  const state = (item.state ?? "").trim().toLowerCase();
  const postal = (item.postalCode ?? "").trim().toLowerCase();
  return [line1, city, state, postal].join("|");
}

export function PropertyResultsPanel({
  items,
  selectedPropertyId,
  onSelect,
  routeSelectionMode = false,
  selectedRouteLeadIds = new Set<string>(),
  onToggleRouteLead,
  className = "relative z-20 hidden w-80 shrink-0 border-r border-slate-200/80 bg-white/80 backdrop-blur xl:block",
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

  useEffect(() => {
    const trimmed = query.trim();
    if (!session?.access_token || trimmed.length < 2) {
      setRemoteResults([]);
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
        const nextResults = json.items
          .filter((item) => item.propertyId)
          .map((item) => ({
            propertyId: item.propertyId as string,
            address: item.kind === "property" ? item.title : item.subtitle,
            subtitle: item.kind === "property" ? item.subtitle : item.title
          }));
        setRemoteResults(nextResults);
      } finally {
        setSearchLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [query, session?.access_token]);

  const visibleItems = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const localMatches: ResultItem[] = !trimmed
      ? items.map((item) => ({
          propertyId: item.propertyId,
          address: item.address,
          subtitle: `${item.visitCount} visits${item.mapState === "not_home" && item.notHomeCount > 1 ? ` · ${item.notHomeCount} tries` : ""}`,
          mapState: item.mapState,
          visitCount: item.visitCount,
          notHomeCount: item.notHomeCount,
          city: item.city,
          state: item.state,
          postalCode: item.postalCode,
          priorityScore: item.priorityScore,
          priorityBand: item.priorityBand
        }))
      : items
          .filter((item) =>
            [item.address, item.city, item.state, item.postalCode]
              .filter(Boolean)
              .some((value) => value?.toLowerCase().includes(trimmed))
          )
          .map((item) => ({
            propertyId: item.propertyId,
            address: item.address,
            subtitle: `${item.visitCount} visits${item.mapState === "not_home" && item.notHomeCount > 1 ? ` · ${item.notHomeCount} tries` : ""}`,
            mapState: item.mapState,
            visitCount: item.visitCount,
            notHomeCount: item.notHomeCount,
            city: item.city,
            state: item.state,
            postalCode: item.postalCode,
            priorityScore: item.priorityScore,
            priorityBand: item.priorityBand
          }));

    const dedupedLocalMatches = Array.from(
      localMatches.reduce((map, item) => {
        const key = identityKey(item);
        const existing = map.get(key);
        const currentScore =
          (item.priorityScore ?? 0) +
          (item.visitCount ?? 0) +
          (item.mapState === "imported_target" ? 5 : 0);
        const existingScore =
          existing
            ? (existing.priorityScore ?? 0) +
              (existing.visitCount ?? 0) +
              (existing.mapState === "imported_target" ? 5 : 0)
            : -1;

        if (!existing || currentScore >= existingScore) {
          map.set(key, item);
        }
        return map;
      }, new Map<string, ResultItem>()).values()
    );

    if (!trimmed) return dedupedLocalMatches;

    const merged = new Map<string, ResultItem>();
    for (const item of dedupedLocalMatches) merged.set(identityKey(item), item);
    for (const item of remoteResults) {
      const key = identityKey(item);
      if (!merged.has(key)) {
        merged.set(key, item);
      }
    }
    return Array.from(merged.values()).sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
  }, [items, query, remoteResults]);

  return (
    <aside className={className}>
      {showHeader ? (
        <div className="border-b border-slate-200/80 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Nearby Targets</div>
        <div className="mt-1 text-sm text-slate-600">{items.length} properties in view</div>
        {routeSelectionMode ? (
          <div className="mt-2 rounded-2xl border border-ink/10 bg-ink px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white">
            Route selection on · tap pins or list rows to build a run
          </div>
        ) : null}
        <div className="mt-3 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a property from your list"
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
            />
          </div>
        </div>
      ) : null}
      <div className="max-h-[calc(100vh-8rem)] space-y-2 overflow-y-auto p-3">
        {searchLoading ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-3 text-sm text-slate-500">
            Searching properties…
          </div>
        ) : visibleItems.length ? (
          visibleItems.map((item) => {
            const matchingMapItem = items.find((candidate) => candidate.propertyId === item.propertyId) ?? null;
            const visual = matchingMapItem ? mapStateVisual(matchingMapItem.mapState) : mapStateVisual("imported_target");
            const Icon = visual.icon;
            const isRouteEligible = Boolean(matchingMapItem?.leadId);
            const isRouteSelected = Boolean(matchingMapItem?.leadId && selectedRouteLeadIds.has(matchingMapItem.leadId));

            return (
              <button
                key={item.propertyId}
                type="button"
                onClick={() => {
                  if (routeSelectionMode && matchingMapItem?.leadId) {
                    onToggleRouteLead?.(matchingMapItem.leadId);
                    return;
                  }
                  onSelect(item.propertyId);
                }}
                className={`w-full rounded-2xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-ink/30 ${
                  routeSelectionMode && isRouteSelected
                    ? "border-field bg-field/10 shadow-panel"
                    : selectedPropertyId === item.propertyId
                    ? "border-ink bg-ink text-white shadow-panel"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                }`}
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
          })
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 p-3 text-sm text-slate-500">
            {query.trim().length >= 2 ? "No matching properties found." : "No nearby properties yet."}
          </div>
        )}
      </div>
    </aside>
  );
}
