function withParams(currentSearch: string) {
  return new URLSearchParams(currentSearch);
}

export function buildLeadsSearchParams(input: {
  currentSearch: string;
  q: string;
  status: string;
  ownerId: string;
  city: string;
  followUp: string;
  appointment: string;
}) {
  const params = withParams(input.currentSearch);
  const trimmed = input.q.trim();
  trimmed ? params.set("q", trimmed) : params.delete("q");
  input.status !== "all" ? params.set("status", input.status) : params.delete("status");
  input.ownerId !== "all" ? params.set("ownerId", input.ownerId) : params.delete("ownerId");
  input.city !== "all" ? params.set("city", input.city) : params.delete("city");
  input.followUp !== "all" ? params.set("followUp", input.followUp) : params.delete("followUp");
  input.appointment !== "all" ? params.set("appointment", input.appointment) : params.delete("appointment");
  return params.toString();
}

export function buildResourcesSearchParams(input: {
  currentSearch: string;
  type: string;
  territory: string;
}) {
  const params = withParams(input.currentSearch);
  input.type !== "all" ? params.set("type", input.type) : params.delete("type");
  input.territory !== "all" ? params.set("territory", input.territory) : params.delete("territory");
  return params.toString();
}

export function buildImportsSearchParams(input: {
  currentSearch: string;
  listType: string;
  visibilityScope: string;
  assignedTeamId: string;
  assignedUserId: string;
}) {
  const params = withParams(input.currentSearch);
  input.listType !== "general_canvass_list" ? params.set("listType", input.listType) : params.delete("listType");
  input.visibilityScope !== "organization" ? params.set("visibility", input.visibilityScope) : params.delete("visibility");
  input.visibilityScope === "team" && input.assignedTeamId
    ? params.set("teamId", input.assignedTeamId)
    : params.delete("teamId");
  input.visibilityScope === "assigned_user" && input.assignedUserId
    ? params.set("userId", input.assignedUserId)
    : params.delete("userId");
  if (input.visibilityScope !== "assigned_user") params.delete("userId");
  if (input.visibilityScope !== "team") params.delete("teamId");
  return params.toString();
}

export function buildAppointmentsSearchParams(input: {
  currentSearch: string;
  view: string;
  date: string;
  anchor: string;
}) {
  const params = withParams(input.currentSearch);
  input.view !== "week" ? params.set("view", input.view) : params.delete("view");
  input.date ? params.set("date", input.date) : params.delete("date");
  input.anchor && input.anchor !== input.date ? params.set("anchor", input.anchor) : params.delete("anchor");
  return params.toString();
}
