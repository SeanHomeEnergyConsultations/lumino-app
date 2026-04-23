"use client";

import {
  ChevronDown,
  LocateFixed,
  Map as MapIcon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen
} from "lucide-react";
import { PropertyResultsPanel } from "@/components/map/property-results-panel";
import type { MapProperty } from "@/types/entities";

export function MapPanelToggles({
  isResultsPanelVisible,
  isDrawerVisible,
  onToggleResultsPanel,
  onToggleDrawer
}: {
  isResultsPanelVisible: boolean;
  isDrawerVisible: boolean;
  onToggleResultsPanel: () => void;
  onToggleDrawer: () => void;
}) {
  return (
    <div className="absolute left-4 top-4 z-20 hidden items-center gap-2 xl:flex">
      <button
        type="button"
        onClick={onToggleResultsPanel}
        className="app-glass-button flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-slate-700 shadow-panel transition hover:bg-white/90"
        aria-pressed={isResultsPanelVisible}
        aria-label={isResultsPanelVisible ? "Hide property list" : "Show property list"}
      >
        {isResultsPanelVisible ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        {isResultsPanelVisible ? "Hide List" : "Show List"}
      </button>
      <button
        type="button"
        onClick={onToggleDrawer}
        className="app-glass-button flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-slate-700 shadow-panel transition hover:bg-white/90"
        aria-pressed={isDrawerVisible}
        aria-label={isDrawerVisible ? "Hide property details" : "Show property details"}
      >
        {isDrawerVisible ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        {isDrawerVisible ? "Hide Details" : "Show Details"}
      </button>
    </div>
  );
}

export function MapStatusOverlay({
  isSavingVisit,
  isResolvingTap,
  activeRoute,
  routeSelectionMode
}: {
  isSavingVisit: boolean;
  isResolvingTap: boolean;
  activeRoute: boolean;
  routeSelectionMode: boolean;
}) {
  return (
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
  );
}

export function MapCenterLocationButton({
  visible,
  onCenter
}: {
  visible: boolean;
  onCenter: () => void;
}) {
  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={onCenter}
      className="app-glass-button absolute bottom-40 right-4 flex h-11 w-11 items-center justify-center rounded-full text-slate-700 shadow-panel transition hover:bg-white/90 sm:bottom-20"
      aria-label="Center on my location"
    >
      <LocateFixed className="h-5 w-5" />
    </button>
  );
}

export function MapResultsSidebars({
  items,
  selectedPropertyId,
  onSelect,
  routeSelectionMode,
  selectedRouteLeadIds,
  onToggleRouteLead,
  showPriority,
  isResultsPanelVisible,
  isResultsOpen,
  onOpenResults,
  onCloseResults
}: {
  items: MapProperty[];
  selectedPropertyId: string | null;
  onSelect: (propertyId: string) => void;
  routeSelectionMode: boolean;
  selectedRouteLeadIds: Set<string>;
  onToggleRouteLead: (leadId: string) => void;
  showPriority: boolean;
  isResultsPanelVisible: boolean;
  isResultsOpen: boolean;
  onOpenResults: () => void;
  onCloseResults: () => void;
}) {
  return (
    <>
      <PropertyResultsPanel
        items={items}
        selectedPropertyId={selectedPropertyId}
        onSelect={onSelect}
        routeSelectionMode={routeSelectionMode}
        selectedRouteLeadIds={selectedRouteLeadIds}
        onToggleRouteLead={onToggleRouteLead}
        showPriority={showPriority}
        className={`app-sidebar-surface relative z-20 shrink-0 border-r ${isResultsPanelVisible ? "hidden w-80 xl:block" : "hidden xl:hidden"}`}
      />

      <button
        type="button"
        onClick={onOpenResults}
        className="app-glass-button absolute left-4 top-4 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-slate-700 shadow-panel xl:hidden"
        aria-expanded={isResultsOpen}
        aria-controls="mobile-property-results-sheet"
      >
        <MapIcon className="h-4 w-4" />
        List
      </button>

      {isResultsOpen ? (
        <div className="fixed inset-0 z-30 bg-slate-950/20 xl:hidden" onClick={onCloseResults}>
          <div
            id="mobile-property-results-sheet"
            className="app-panel absolute inset-x-0 bottom-0 max-h-[70vh] rounded-t-[2rem] border shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Nearby Targets</div>
                <div className="mt-1 text-sm text-slate-600">{items.length} properties in view</div>
              </div>
              <button
                type="button"
                onClick={onCloseResults}
                className="app-glass-button flex h-9 w-9 items-center justify-center rounded-full text-slate-600"
                aria-label="Hide nearby targets"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
            <PropertyResultsPanel
              items={items}
              selectedPropertyId={selectedPropertyId}
              onSelect={onSelect}
              routeSelectionMode={routeSelectionMode}
              selectedRouteLeadIds={selectedRouteLeadIds}
              onToggleRouteLead={onToggleRouteLead}
              showPriority={showPriority}
              className="block max-h-[calc(70vh-4.5rem)] w-full overflow-y-auto"
              showHeader={false}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
