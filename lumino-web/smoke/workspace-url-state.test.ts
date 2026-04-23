import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAppointmentsSearchParams,
  buildImportsSearchParams,
  buildLeadsSearchParams,
  buildResourcesSearchParams
} from "../components/shared/workspace-url-state.ts";

test("buildLeadsSearchParams persists non-default lead filters and clears defaults", () => {
  const params = new URLSearchParams(
    buildLeadsSearchParams({
      currentSearch: "q=old&status=New&ownerId=user-1&city=Boston&followUp=scheduled&appointment=scheduled",
      q: "",
      status: "all",
      ownerId: "all",
      city: "Cambridge",
      followUp: "overdue",
      appointment: "all"
    })
  );

  assert.equal(params.get("q"), null);
  assert.equal(params.get("status"), null);
  assert.equal(params.get("ownerId"), null);
  assert.equal(params.get("city"), "Cambridge");
  assert.equal(params.get("followUp"), "overdue");
  assert.equal(params.get("appointment"), null);
});

test("buildResourcesSearchParams keeps only active library filters", () => {
  const params = new URLSearchParams(
    buildResourcesSearchParams({
      currentSearch: "type=document&territory=old",
      type: "all",
      territory: "untagged"
    })
  );

  assert.equal(params.get("type"), null);
  assert.equal(params.get("territory"), "untagged");
});

test("buildImportsSearchParams ties assignment params to the chosen visibility mode", () => {
  const params = new URLSearchParams(
    buildImportsSearchParams({
      currentSearch: "visibility=team&teamId=team-1&userId=user-1",
      listType: "custom",
      visibilityScope: "assigned_user",
      assignedTeamId: "team-2",
      assignedUserId: "user-9"
    })
  );

  assert.equal(params.get("listType"), "custom");
  assert.equal(params.get("visibility"), "assigned_user");
  assert.equal(params.get("teamId"), null);
  assert.equal(params.get("userId"), "user-9");
});

test("buildAppointmentsSearchParams keeps calendar view and only stores anchor when it differs", () => {
  const params = new URLSearchParams(
    buildAppointmentsSearchParams({
      currentSearch: "",
      view: "month",
      date: "2026-04-23",
      anchor: "2026-05-01"
    })
  );

  assert.equal(params.get("view"), "month");
  assert.equal(params.get("date"), "2026-04-23");
  assert.equal(params.get("anchor"), "2026-05-01");

  const compactParams = new URLSearchParams(
    buildAppointmentsSearchParams({
      currentSearch: "view=month&date=2026-04-23&anchor=2026-04-23",
      view: "week",
      date: "2026-04-23",
      anchor: "2026-04-23"
    })
  );

  assert.equal(compactParams.get("view"), null);
  assert.equal(compactParams.get("date"), "2026-04-23");
  assert.equal(compactParams.get("anchor"), null);
});
