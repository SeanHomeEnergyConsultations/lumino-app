"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch, useAuth } from "@/lib/auth/client";
import type {
  TerritoriesResponse,
  TerritoryDetailResponse,
  TerritoryListItem,
  TerritoryPropertyItem,
  TerritoryPropertySearchResponse
} from "@/types/api";

function statusPill(status: string) {
  return status === "active"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-slate-200 bg-slate-100 text-slate-600";
}

export function TerritoryAdminPage() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;

  const [territories, setTerritories] = useState<TerritoryListItem[]>([]);
  const [selectedTerritoryId, setSelectedTerritoryId] = useState<string | null>(null);
  const [selectedTerritory, setSelectedTerritory] = useState<TerritoryDetailResponse["item"] | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createStatus, setCreateStatus] = useState<"active" | "archived">("active");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [detailName, setDetailName] = useState("");
  const [detailStatus, setDetailStatus] = useState<"active" | "archived">("active");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<TerritoryPropertyItem[]>([]);
  const [searching, setSearching] = useState(false);

  const assignedPropertyIds = useMemo(
    () => new Set((selectedTerritory?.properties ?? []).map((item) => item.propertyId)),
    [selectedTerritory?.properties]
  );

  const loadTerritories = useCallback(async () => {
    if (!accessToken) return;

    setLoadingList(true);
    try {
      const response = await authFetch(accessToken, "/api/territories");
      if (!response.ok) throw new Error("Failed to load territories");
      const json = (await response.json()) as TerritoriesResponse;
      setTerritories(json.items);

      setSelectedTerritoryId((current) => current ?? json.items[0]?.territoryId ?? null);
    } finally {
      setLoadingList(false);
    }
  }, [accessToken]);

  const loadTerritoryDetail = useCallback(
    async (territoryId: string | null) => {
      if (!accessToken || !territoryId) {
        setSelectedTerritory(null);
        return;
      }

      setLoadingDetail(true);
      try {
        const response = await authFetch(accessToken, `/api/territories/${territoryId}`);
        if (!response.ok) throw new Error("Failed to load territory detail");
        const json = (await response.json()) as TerritoryDetailResponse;
        setSelectedTerritory(json.item);
        setDetailName(json.item.name);
        setDetailStatus(json.item.status as "active" | "archived");
      } finally {
        setLoadingDetail(false);
      }
    },
    [accessToken]
  );

  useEffect(() => {
    void loadTerritories();
  }, [loadTerritories]);

  useEffect(() => {
    void loadTerritoryDetail(selectedTerritoryId);
  }, [loadTerritoryDetail, selectedTerritoryId]);

  const runSearch = useCallback(
    async (term: string) => {
      if (!accessToken) return;
      const trimmed = term.trim();
      if (trimmed.length < 3) {
        setSearchResults([]);
        return;
      }

      setSearching(true);
      try {
        const response = await authFetch(
          accessToken,
          `/api/territories/property-search?q=${encodeURIComponent(trimmed)}`
        );
        if (!response.ok) throw new Error("Failed to search properties");
        const json = (await response.json()) as TerritoryPropertySearchResponse;
        setSearchResults(json.items);
      } finally {
        setSearching(false);
      }
    },
    [accessToken]
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      void runSearch(searchTerm);
    }, 250);

    return () => clearTimeout(timeout);
  }, [runSearch, searchTerm]);

  async function handleCreateTerritory() {
    if (!accessToken || !createName.trim()) return;

    setSaveState("saving");
    try {
      const response = await authFetch(accessToken, "/api/territories", {
        method: "POST",
        body: JSON.stringify({
          name: createName.trim(),
          status: createStatus
        })
      });

      if (!response.ok) throw new Error("Failed to create territory");

      const json = (await response.json()) as { territoryId: string };
      setCreateName("");
      setCreateStatus("active");
      await loadTerritories();
      setSelectedTerritoryId(json.territoryId);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  async function handleUpdateTerritory() {
    if (!accessToken || !selectedTerritoryId || !detailName.trim()) return;

    setSaveState("saving");
    try {
      const response = await authFetch(accessToken, `/api/territories/${selectedTerritoryId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: detailName.trim(),
          status: detailStatus
        })
      });

      if (!response.ok) throw new Error("Failed to update territory");

      await Promise.all([loadTerritories(), loadTerritoryDetail(selectedTerritoryId)]);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  async function handleAssignProperty(propertyId: string) {
    if (!accessToken || !selectedTerritoryId) return;

    setSaveState("saving");
    try {
      const response = await authFetch(
        accessToken,
        `/api/territories/${selectedTerritoryId}/properties`,
        {
          method: "POST",
          body: JSON.stringify({ propertyId })
        }
      );

      if (!response.ok) throw new Error("Failed to assign property");
      await Promise.all([loadTerritories(), loadTerritoryDetail(selectedTerritoryId)]);
      setSearchTerm("");
      setSearchResults([]);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  async function handleRemoveProperty(propertyId: string) {
    if (!accessToken || !selectedTerritoryId) return;

    setSaveState("saving");
    try {
      const response = await authFetch(
        accessToken,
        `/api/territories/${selectedTerritoryId}/properties`,
        {
          method: "DELETE",
          body: JSON.stringify({ propertyId })
        }
      );

      if (!response.ok) throw new Error("Failed to remove property");
      await Promise.all([loadTerritories(), loadTerritoryDetail(selectedTerritoryId)]);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <div className="p-4 md:p-6">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Territories</div>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Team coverage and assignment control</h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">
          Create territories, attach properties, and keep manager reporting grounded in a real coverage model.
        </p>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[22rem_1fr]">
        <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Territory List</div>
          <div className="mt-4 space-y-3">
            {loadingList ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                Loading territories...
              </div>
            ) : territories.length ? (
              territories.map((territory) => (
                <button
                  key={territory.territoryId}
                  type="button"
                  onClick={() => setSelectedTerritoryId(territory.territoryId)}
                  className={`w-full rounded-3xl border p-4 text-left transition ${
                    territory.territoryId === selectedTerritoryId
                      ? "border-ink bg-slate-950 text-white"
                      : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{territory.name}</div>
                      <div
                        className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                          territory.territoryId === selectedTerritoryId
                            ? "border-white/20 bg-white/10 text-white"
                            : statusPill(territory.status)
                        }`}
                      >
                        {territory.status}
                      </div>
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-[0.12em]">
                      {territory.propertyCount} props
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No territories yet. Create the first one below.
              </div>
            )}
          </div>

          <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-ink">Create territory</div>
            <input
              type="text"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="North Grafton"
              className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            />
            <select
              value={createStatus}
              onChange={(event) => setCreateStatus(event.target.value as "active" | "archived")}
              className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
            <button
              type="button"
              onClick={() => void handleCreateTerritory()}
              disabled={!accessToken || saveState === "saving" || !createName.trim()}
              className="mt-3 w-full rounded-2xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saveState === "saving" ? "Saving..." : "Create Territory"}
            </button>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          {!selectedTerritoryId ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
              Select a territory to edit assignments and property coverage.
            </div>
          ) : loadingDetail ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
              Loading territory details...
            </div>
          ) : selectedTerritory ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Territory Detail</div>
                  <h2 className="mt-2 text-2xl font-semibold text-ink">{selectedTerritory.name}</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    {selectedTerritory.propertyCount} assigned properties in this territory right now.
                  </p>
                </div>
                <div
                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${statusPill(selectedTerritory.status)}`}
                >
                  {selectedTerritory.status}
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-ink">Edit territory</div>
                  <input
                    type="text"
                    value={detailName}
                    onChange={(event) => setDetailName(event.target.value)}
                    className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
                  />
                  <select
                    value={detailStatus}
                    onChange={(event) => setDetailStatus(event.target.value as "active" | "archived")}
                    className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
                  >
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleUpdateTerritory()}
                    disabled={!accessToken || saveState === "saving" || !detailName.trim()}
                    className="mt-3 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Save Territory
                  </button>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-ink">Assign properties</div>
                  <p className="mt-1 text-xs text-slate-500">
                    Search by address and attach properties to this territory.
                  </p>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search an address"
                    className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
                  />
                  <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                    {searching ? (
                      <div className="text-sm text-slate-500">Searching...</div>
                    ) : searchTerm.trim().length < 3 ? (
                      <div className="text-sm text-slate-500">Type at least 3 characters to search.</div>
                    ) : searchResults.length ? (
                      searchResults.map((property) => (
                        <div
                          key={property.propertyId}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-ink">{property.address}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {[property.city, property.state].filter(Boolean).join(", ") || "Unknown area"}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={assignedPropertyIds.has(property.propertyId) || saveState === "saving"}
                            onClick={() => void handleAssignProperty(property.propertyId)}
                            className="rounded-2xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {assignedPropertyIds.has(property.propertyId) ? "Assigned" : "Add"}
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-slate-500">No matching properties found.</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-ink">Assigned properties</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Remove properties here if the territory needs to be cleaned up.
                    </div>
                  </div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    {selectedTerritory.properties.length} total
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {selectedTerritory.properties.length ? (
                    selectedTerritory.properties.map((property) => (
                      <div
                        key={property.propertyId}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-ink">{property.address}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {[property.city, property.state].filter(Boolean).join(", ") || "Unknown area"}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleRemoveProperty(property.propertyId)}
                          disabled={saveState === "saving"}
                          className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                      No properties assigned yet.
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 text-sm text-slate-500">
                {saveState === "saved"
                  ? "Saved."
                  : saveState === "error"
                    ? "Could not save the territory update."
                    : "Territory changes here feed manager drill-downs and territory health reporting."}
              </div>
            </>
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
              This territory could not be loaded.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
