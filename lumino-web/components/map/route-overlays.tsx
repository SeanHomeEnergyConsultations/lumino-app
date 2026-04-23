"use client";

import type { ComponentType } from "react";
import { MapPinned, X } from "lucide-react";
import type { ActiveRouteRunResponse } from "@/types/api";
import type { MapProperty } from "@/types/entities";

export function ActiveRoutePanel({
  activeRoute,
  pendingRouteStops,
  nextStopDirectionsUrl,
  routeActionState,
  onOpenProperty,
  onOptimizeRemainingStops,
  onSkipRouteStop
}: {
  activeRoute: ActiveRouteRunResponse;
  pendingRouteStops: ActiveRouteRunResponse["stops"];
  nextStopDirectionsUrl: string | null;
  routeActionState: "idle" | "skipping" | "optimizing" | "building" | "error";
  onOpenProperty: (propertyId: string) => void;
  onOptimizeRemainingStops: () => void;
  onSkipRouteStop: () => void;
}) {
  return (
    <div className="absolute left-4 right-4 top-20 z-20 xl:left-4 xl:right-auto xl:w-[24rem]">
      <div className="app-panel rounded-[1.75rem] border p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Active Route</div>
            <div className="mt-2 text-lg font-semibold text-ink">
              {activeRoute.pendingStops} stop{activeRoute.pendingStops === 1 ? "" : "s"} left
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Stop {activeRoute.nextStop?.sequenceNumber ?? "—"} of {activeRoute.totalStops} · {activeRoute.completedStops} completed ·{" "}
              {activeRoute.skippedStops} skipped
            </div>
          </div>
          <div className="app-chip rounded-2xl px-3 py-2 text-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Next</div>
            <div className="mt-1 text-lg font-semibold text-ink">{activeRoute.nextStop?.sequenceNumber ?? "—"}</div>
          </div>
        </div>

        {activeRoute.nextStop ? (
          <>
            <div className="mt-4 rounded-[1.35rem] bg-[linear-gradient(135deg,#f8fafc_0%,#eef4ff_100%)] p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">Next Stop</div>
              <div className="mt-2 text-sm font-semibold text-ink">{activeRoute.nextStop.address}</div>
              <div className="mt-1 text-xs text-slate-500">
                {activeRoute.nextStop.homeownerName || activeRoute.nextStop.leadStatus || "Ready to work"}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!activeRoute.nextStop?.propertyId) return;
                  onOpenProperty(activeRoute.nextStop.propertyId);
                }}
                className="app-primary-button rounded-2xl px-4 py-2 text-sm font-semibold"
              >
                Open Stop
              </button>
              {nextStopDirectionsUrl ? (
                <a
                  href={nextStopDirectionsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="app-glass-button rounded-2xl px-4 py-2 text-sm font-semibold text-ink"
                >
                  Navigate
                </a>
              ) : (
                <div className="app-chip rounded-2xl border-dashed px-4 py-2 text-center text-sm font-semibold text-slate-400">
                  Directions unavailable
                </div>
              )}
              <button
                type="button"
                onClick={onOptimizeRemainingStops}
                disabled={routeActionState === "optimizing"}
                className="app-glass-button rounded-2xl px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
              >
                {routeActionState === "optimizing" ? "Optimizing..." : "Optimize Remaining"}
              </button>
              <button
                type="button"
                onClick={onSkipRouteStop}
                disabled={routeActionState === "skipping"}
                className="app-glass-button rounded-2xl px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-60"
              >
                {routeActionState === "skipping" ? "Skipping..." : "Skip"}
              </button>
            </div>
            <div className="mt-3 rounded-[1.15rem] border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Open the stop, log the outcome, and the route will advance automatically.
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {pendingRouteStops.slice(0, 6).map((stop) => (
                <button
                  key={stop.routeRunStopId}
                  type="button"
                  onClick={() => {
                    if (!stop.propertyId) return;
                    onOpenProperty(stop.propertyId);
                  }}
                  className={`min-w-[7rem] rounded-[1.15rem] border px-3 py-2 text-left transition ${
                    activeRoute.nextStop?.routeRunStopId === stop.routeRunStopId
                      ? "border-ink bg-ink text-white"
                      : "border-slate-200 bg-white text-ink"
                  }`}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">Stop {stop.sequenceNumber}</div>
                  <div className="mt-1 truncate text-sm font-semibold">{stop.address.split(",")[0]}</div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="mt-4 rounded-[1.35rem] bg-slate-50 p-4 text-sm text-slate-600">
            This route has no pending stops left.
          </div>
        )}
      </div>
    </div>
  );
}

export function RouteSelectionPanel({
  routeSelectableItems,
  selectedRouteLeadIds,
  selectedRouteItems,
  routeActionState,
  routeBuilderError,
  onCancel,
  onBuildRoute,
  onClear,
  onOpenProperty
}: {
  routeSelectableItems: MapProperty[];
  selectedRouteLeadIds: string[];
  selectedRouteItems: MapProperty[];
  routeActionState: "idle" | "skipping" | "optimizing" | "building" | "error";
  routeBuilderError: string | null;
  onCancel: () => void;
  onBuildRoute: () => void;
  onClear: () => void;
  onOpenProperty: (propertyId: string) => void;
}) {
  return (
    <div className="absolute left-4 right-4 top-20 z-20 xl:left-4 xl:right-auto xl:w-[24rem]">
      <div className="app-panel rounded-[1.75rem] border p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Route Selection</div>
            <div className="mt-2 text-lg font-semibold text-ink">
              {selectedRouteLeadIds.length} stop{selectedRouteLeadIds.length === 1 ? "" : "s"} selected
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Tap pins or list rows with active leads, then build the cleanest order from your current location.
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="app-glass-button rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600"
          >
            Cancel
          </button>
        </div>

        <div className="mt-4 rounded-[1.35rem] bg-[linear-gradient(135deg,#f8fafc_0%,#eef4ff_100%)] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">Ready in View</div>
          <div className="mt-2 text-sm font-semibold text-ink">
            {routeSelectableItems.length} mapped lead{routeSelectableItems.length === 1 ? "" : "s"} can be routed from this screen
          </div>
          <div className="mt-1 text-xs text-slate-500">
            If a property has no lead yet, work it first and it can join a route afterward.
          </div>
        </div>

        {selectedRouteItems.length ? (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {selectedRouteItems.slice(0, 6).map((item) => (
              <button
                key={item.leadId}
                type="button"
                onClick={() => onOpenProperty(item.propertyId)}
                className="min-w-[7rem] rounded-[1.15rem] border border-field bg-field/10 px-3 py-2 text-left text-ink"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-field">Selected</div>
                <div className="mt-1 truncate text-sm font-semibold">{item.address.split(",")[0]}</div>
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onBuildRoute}
            disabled={!selectedRouteLeadIds.length || routeActionState === "building"}
            className="app-primary-button rounded-2xl px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {routeActionState === "building" ? "Building..." : "Build Route"}
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={!selectedRouteLeadIds.length}
            className="app-glass-button rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
        <div className="mt-3 text-xs text-slate-500">
          {routeBuilderError ?? "This works best for due-now stops, revisits, and live opportunities already in the CRM."}
        </div>
      </div>
    </div>
  );
}

export function RouteSelectionToggle({
  routeSelectionMode,
  onToggle
}: {
  routeSelectionMode: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`absolute left-4 top-20 z-20 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-panel transition xl:left-auto xl:right-20 xl:top-4 ${
        routeSelectionMode ? "app-primary-button text-white" : "app-glass-button text-slate-700"
      }`}
    >
      <MapPinned className="h-4 w-4" />
      {routeSelectionMode ? "Close Route Select" : "Route Select"}
    </button>
  );
}

export function MobileSelectedPropertyChip({
  address,
  visual,
  onClear
}: {
  address: string;
  visual: { className: string; icon: ComponentType<{ className?: string; strokeWidth?: number }> } | null;
  onClear: () => void;
}) {
  return (
    <div className="absolute right-4 top-4 xl:hidden">
      <button
        type="button"
        onClick={onClear}
        className="app-glass-button flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-slate-700 shadow-panel"
      >
        {visual ? (
          <span className={`flex h-7 w-7 items-center justify-center rounded-full ${visual.className}`}>
            <visual.icon className="h-4 w-4" strokeWidth={2.2} />
          </span>
        ) : null}
        <span className="max-w-[10rem] truncate">{address}</span>
        <X className="h-4 w-4 text-slate-400" />
      </button>
    </div>
  );
}
