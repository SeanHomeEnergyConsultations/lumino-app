"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck2, Clock3, ListTodo, Sparkles, TriangleAlert } from "lucide-react";
import type { CreateRouteRunResponse, RepQueueResponse } from "@/types/api";
import { QueueSection } from "@/components/queue/queue-section";
import { authFetch, useAuth } from "@/lib/auth/client";

export function QueuePage({
  initialOwnerId = null,
  repName = null
}: {
  initialOwnerId?: string | null;
  repName?: string | null;
}) {
  const { session, appContext } = useAuth();
  const [queue, setQueue] = useState<RepQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [ownerId] = useState<string | null>(initialOwnerId);
  const [activeMobileSection, setActiveMobileSection] = useState<
    "dueNow" | "revisits" | "appointments" | "opportunities" | "needsAttention"
  >("dueNow");
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [routeState, setRouteState] = useState<"idle" | "locating" | "saving" | "error">("idle");
  const [routeError, setRouteError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    if (!session?.access_token) return null;
    setLoading(true);
    try {
      const response = await authFetch(
        session.access_token,
        `/api/queue/rep${ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : ""}`
      );
      if (!response.ok) return null;
      const json = (await response.json()) as RepQueueResponse;
      setQueue(json);
      return json;
    } finally {
      setLoading(false);
    }
  }, [ownerId, session?.access_token]);

  useEffect(() => {
    let cancelled = false;
    loadQueue().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [loadQueue]);

  useEffect(() => {
    const visibleLeadIds = new Set(
      [
        ...(queue?.dueNow ?? []),
        ...(queue?.revisits ?? []),
        ...(queue?.appointments ?? []),
        ...(queue?.opportunities ?? []),
        ...(queue?.needsAttention ?? [])
      ].map((item) => item.leadId)
    );
    setSelectedLeadIds((current) => current.filter((leadId) => visibleLeadIds.has(leadId)));
  }, [queue]);

  const canCreateRoute =
    !ownerId || ownerId === appContext?.appUser.id;

  function toggleSelectedLead(leadId: string) {
    setSelectedLeadIds((current) =>
      current.includes(leadId) ? current.filter((item) => item !== leadId) : [...current, leadId]
    );
  }

  async function getCurrentPosition() {
    if (!navigator.geolocation) {
      throw new Error("Location access is not available on this device.");
    }

    return new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 15000
      });
    });
  }

  async function handleBuildRoute() {
    if (!session?.access_token || !selectedLeadIds.length) return;

    try {
      setRouteError(null);
      setRouteState("locating");
      const position = await getCurrentPosition();

      setRouteState("saving");
      const response = await authFetch(session.access_token, "/api/routes/run", {
        method: "POST",
        body: JSON.stringify({
          leadIds: selectedLeadIds,
          startedFromLat: position.coords.latitude,
          startedFromLng: position.coords.longitude,
          startedFromLabel: "Current Location",
          optimizationMode: "drive_time"
        })
      });

      const json = (await response.json()) as CreateRouteRunResponse | { error?: string };
      if (!response.ok) {
        throw new Error("error" in json && json.error ? json.error : "Failed to create route");
      }

      const nextUrl =
        "firstPropertyId" in json && json.firstPropertyId
          ? `/map?propertyId=${encodeURIComponent(json.firstPropertyId)}`
          : "/map";
      window.location.assign(nextUrl);
    } catch (error) {
      setRouteState("error");
      setRouteError(
        error instanceof Error
          ? error.message
          : "Could not build a route from your selected leads."
      );
      return;
    }

    setRouteState("idle");
  }

  const sections = [
    {
      key: "dueNow" as const,
      title: "Due Now",
      mobileLabel: "Now",
      description: "Overdue follow-ups and time-sensitive work that should be touched first.",
      items: queue?.dueNow ?? [],
      count: queue?.summary.dueNow ?? 0,
      icon: Clock3
    },
    {
      key: "revisits" as const,
      title: "Today's Revisit Targets",
      mobileLabel: "Revisits",
      description: "Doors that were not home or received a doorhanger and should be worked again.",
      items: queue?.revisits ?? [],
      count: queue?.summary.revisits ?? 0,
      icon: ListTodo
    },
    {
      key: "appointments" as const,
      title: "Appointments",
      mobileLabel: "Appts",
      description: "Scheduled conversations and upcoming sales moments that need attention.",
      items: queue?.appointments ?? [],
      count: queue?.summary.appointments ?? 0,
      icon: CalendarCheck2
    },
    {
      key: "opportunities" as const,
      title: "New Opportunities",
      mobileLabel: "Opps",
      description: "Promising properties that already have momentum and should stay moving.",
      items: queue?.opportunities ?? [],
      count: queue?.summary.opportunities ?? 0,
      icon: Sparkles
    },
    {
      key: "needsAttention" as const,
      title: "Needs Attention",
      mobileLabel: "Leaks",
      description: "Opportunities with no next step yet. These are the ones most likely to leak if you do nothing.",
      items: queue?.needsAttention ?? [],
      count: queue?.summary.needsAttention ?? 0,
      icon: TriangleAlert
    }
  ];

  const activeSection = sections.find((section) => section.key === activeMobileSection) ?? sections[0];

  return (
    <div className="p-4 md:p-6">
      <div className="app-panel rounded-[2rem] border p-5 md:p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Rep Queue</div>
        <h1 className="mt-2 text-2xl font-semibold text-ink md:text-3xl">Daily follow-up command center</h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">
          Work the day from here when you are not actively walking the map. On mobile, stay in one lane at a time and push the next best property back onto the map quickly.
        </p>
        {repName ? (
          <div className="mt-3 inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
            Viewing {repName}&apos;s queue
          </div>
        ) : null}

        <div className="mt-6 flex gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-5 md:overflow-visible md:pb-0">
          {sections.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setActiveMobileSection(item.key)}
              className={`min-w-[10rem] rounded-3xl border p-4 text-left transition md:min-w-0 ${
                activeMobileSection === item.key
                  ? "border-ink bg-ink text-white shadow-panel"
                  : "border-slate-200 bg-slate-50 text-ink"
              }`}
            >
              <div
                className={`text-xs font-semibold uppercase tracking-[0.16em] ${
                  activeMobileSection === item.key ? "text-white/70" : "text-mist"
                }`}
              >
                {item.title}
              </div>
              <div className="mt-2 text-3xl font-semibold">{loading ? "…" : item.count}</div>
            </button>
          ))}
        </div>

        <div className="app-panel-soft mt-5 rounded-[1.6rem] border p-4 md:hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Focus Lane</div>
              <div className="mt-2 text-lg font-semibold text-ink">{activeSection.title}</div>
              <p className="mt-1 text-sm text-slate-600">{activeSection.description}</p>
            </div>
            <div className="rounded-2xl bg-white px-3 py-2 text-center shadow-sm ring-1 ring-slate-200">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Live</div>
              <div className="mt-1 text-lg font-semibold text-ink">{loading ? "…" : activeSection.count}</div>
            </div>
          </div>
        </div>

        {canCreateRoute ? (
          <div className="mt-5 rounded-[1.6rem] border border-[rgba(var(--app-primary-rgb),0.18)] bg-[linear-gradient(135deg,rgba(var(--app-primary-rgb),0.96)_0%,rgba(var(--app-primary-rgb),0.84)_52%,rgba(var(--app-accent-rgb),0.88)_100%)] p-4 text-white shadow-panel">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Route Builder</div>
                <div className="mt-2 text-lg font-semibold">
                  {selectedLeadIds.length ? `${selectedLeadIds.length} lead${selectedLeadIds.length === 1 ? "" : "s"} selected` : "Select stops from your queue"}
                </div>
                <p className="mt-1 text-sm text-white/70">
                  Build an optimized stop order from your current location, then work it on the map.
                </p>
              </div>
              {selectedLeadIds.length ? (
                <button
                  type="button"
                  onClick={() => setSelectedLeadIds([])}
                  className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-white/80"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => void handleBuildRoute()}
                disabled={!selectedLeadIds.length || routeState === "locating" || routeState === "saving"}
                className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
              >
                {routeState === "locating"
                  ? "Getting location..."
                  : routeState === "saving"
                    ? "Building route..."
                    : "Build Route"}
              </button>
              <div className="text-xs text-white/70">
                {routeError
                  ? routeError
                  : "Best for today's revisits, overdue follow-ups, and fresh opportunities."}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-6 md:hidden">
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {sections.map((section) => {
            const Icon = section.icon;
            const active = activeMobileSection === section.key;
            return (
              <button
                key={section.key}
                type="button"
                onClick={() => setActiveMobileSection(section.key)}
                className={`flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? "border-ink bg-ink text-white shadow-panel"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                <Icon className="h-4 w-4" />
                {section.mobileLabel}
              </button>
            );
          })}
        </div>
        <QueueSection
          title={activeSection.title}
          description={activeSection.description}
          items={activeSection.items}
          accessToken={session?.access_token ?? null}
          onUpdated={loadQueue}
          selectable={canCreateRoute}
          selectedLeadIds={new Set(selectedLeadIds)}
          onToggleSelected={toggleSelectedLead}
        />
      </div>

      <div className="mt-6 hidden gap-6 md:grid">
        {sections.map((section) => (
          <QueueSection
            key={section.key}
            title={section.title}
            description={section.description}
            items={section.items}
            accessToken={session?.access_token ?? null}
            onUpdated={loadQueue}
            selectable={canCreateRoute}
            selectedLeadIds={new Set(selectedLeadIds)}
            onToggleSelected={toggleSelectedLead}
          />
        ))}
      </div>

      {canCreateRoute && selectedLeadIds.length ? (
        <div className="fixed inset-x-0 bottom-20 z-20 px-4 md:hidden">
          <div className="app-panel mx-auto flex max-w-md items-center justify-between gap-3 rounded-[1.4rem] border p-3 shadow-2xl">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">Route Ready</div>
              <div className="mt-1 text-sm font-semibold text-ink">
                {selectedLeadIds.length} stop{selectedLeadIds.length === 1 ? "" : "s"} selected
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleBuildRoute()}
              disabled={routeState === "locating" || routeState === "saving"}
              className="app-primary-button rounded-2xl px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            >
              {routeState === "locating"
                ? "Locating..."
                : routeState === "saving"
                  ? "Building..."
                  : "Build Route"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
