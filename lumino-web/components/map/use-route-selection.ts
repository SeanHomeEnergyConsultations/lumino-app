"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MapProperty } from "@/types/entities";

export function useRouteSelection(input: {
  routeSelectableItems: MapProperty[];
  activeRouteId: string | null;
}) {
  const { routeSelectableItems, activeRouteId } = input;
  const [routeSelectionMode, setRouteSelectionMode] = useState(false);
  const [selectedRouteLeadIds, setSelectedRouteLeadIds] = useState<string[]>([]);
  const [routeBuilderError, setRouteBuilderError] = useState<string | null>(null);

  const selectedRouteItems = useMemo(
    () => routeSelectableItems.filter((item) => item.leadId && selectedRouteLeadIds.includes(item.leadId)),
    [routeSelectableItems, selectedRouteLeadIds]
  );

  useEffect(() => {
    const visibleLeadIds = new Set(routeSelectableItems.map((item) => item.leadId).filter(Boolean) as string[]);
    setSelectedRouteLeadIds((current) => current.filter((leadId) => visibleLeadIds.has(leadId)));
  }, [routeSelectableItems]);

  useEffect(() => {
    if (!activeRouteId) return;
    setRouteSelectionMode(false);
    setSelectedRouteLeadIds([]);
    setRouteBuilderError(null);
  }, [activeRouteId]);

  const toggleSelectedRouteLead = useCallback((leadId: string) => {
    setSelectedRouteLeadIds((current) =>
      current.includes(leadId) ? current.filter((item) => item !== leadId) : [...current, leadId]
    );
  }, []);

  const clearSelectedRouteLeads = useCallback(() => {
    setSelectedRouteLeadIds([]);
  }, []);

  const closeRouteSelection = useCallback(() => {
    setRouteSelectionMode(false);
    setSelectedRouteLeadIds([]);
    setRouteBuilderError(null);
  }, []);

  const toggleRouteSelectionMode = useCallback(() => {
    setRouteBuilderError(null);
    setRouteSelectionMode((current) => {
      const next = !current;
      if (!next) {
        setSelectedRouteLeadIds([]);
      }
      return next;
    });
  }, []);

  return {
    routeSelectionMode,
    selectedRouteLeadIds,
    selectedRouteItems,
    routeBuilderError,
    setRouteBuilderError,
    toggleSelectedRouteLead,
    clearSelectedRouteLeads,
    closeRouteSelection,
    toggleRouteSelectionMode
  };
}
