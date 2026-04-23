import type { MapFilterKey } from "./map-toolbar";

export function buildMapSearchParams(input: {
  currentSearch: string;
  selectedPropertyId: string | null;
  activeFilters: MapFilterKey[];
  isResultsPanelVisible: boolean;
  isDrawerVisible: boolean;
  showTeamKnocks: boolean;
}) {
  const params = new URLSearchParams(input.currentSearch);

  if (input.selectedPropertyId) {
    params.set("propertyId", input.selectedPropertyId);
  } else {
    params.delete("propertyId");
  }

  if (input.activeFilters.length && !(input.activeFilters.length === 1 && input.activeFilters[0] === "all")) {
    params.set("filters", input.activeFilters.join(","));
  } else {
    params.delete("filters");
  }

  if (input.isResultsPanelVisible) {
    params.set("list", "1");
  } else {
    params.delete("list");
  }

  if (!input.isDrawerVisible) {
    params.set("drawer", "0");
  } else {
    params.delete("drawer");
  }

  if (input.showTeamKnocks) {
    params.set("team", "1");
  } else {
    params.delete("team");
  }

  return params.toString();
}
