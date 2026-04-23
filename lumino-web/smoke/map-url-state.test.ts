import assert from "node:assert/strict";
import test from "node:test";
import { buildMapSearchParams } from "../components/map/map-url-state.ts";

test("buildMapSearchParams keeps existing location filters and persists map UI state", () => {
  const result = buildMapSearchParams({
    currentSearch: "city=Boston&state=MA",
    selectedPropertyId: "prop_123",
    activeFilters: ["not_home", "appointment_set"],
    isResultsPanelVisible: true,
    isDrawerVisible: false,
    showTeamKnocks: true
  });

  const params = new URLSearchParams(result);
  assert.equal(params.get("city"), "Boston");
  assert.equal(params.get("state"), "MA");
  assert.equal(params.get("propertyId"), "prop_123");
  assert.equal(params.get("filters"), "not_home,appointment_set");
  assert.equal(params.get("list"), "1");
  assert.equal(params.get("drawer"), "0");
  assert.equal(params.get("team"), "1");
});

test("buildMapSearchParams clears default-only map state from the URL", () => {
  const result = buildMapSearchParams({
    currentSearch: "propertyId=old&filters=all&list=1&drawer=0&team=1",
    selectedPropertyId: null,
    activeFilters: ["all"],
    isResultsPanelVisible: false,
    isDrawerVisible: true,
    showTeamKnocks: false
  });

  const params = new URLSearchParams(result);
  assert.equal(params.get("propertyId"), null);
  assert.equal(params.get("filters"), null);
  assert.equal(params.get("list"), null);
  assert.equal(params.get("drawer"), null);
  assert.equal(params.get("team"), null);
});
