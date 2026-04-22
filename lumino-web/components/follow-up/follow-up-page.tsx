"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck2, Clock3, ListTodo, Sparkles, TriangleAlert } from "lucide-react";
import { QueueSection } from "@/components/queue/queue-section";
import { authFetch, useAuth } from "@/lib/auth/client";
import type { CreateRouteRunResponse, RepQueueResponse, TaskBoardItem, TasksResponse } from "@/types/api";

function formatDateTime(value: string | null) {
  if (!value) return "Unscheduled";
  return new Date(value).toLocaleString();
}

function formatTaskNotes(value: string | null) {
  if (!value) return null;
  return value.replace(/^\[cadence:[^\]]+\]\s*/, "");
}

type FollowUpTaskSectionProps = {
  title: string;
  description: string;
  items: TaskBoardItem[];
  emptyLabel: string;
};

function FollowUpTaskSection({
  title,
  description,
  items,
  emptyLabel
}: FollowUpTaskSectionProps) {
  return (
    <section className="app-panel rounded-[2rem] border p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">{title}</div>
          <p className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.68)]">{description}</p>
        </div>
        <div className="app-chip rounded-full px-3 py-1 text-sm font-semibold text-slate-700">{items.length}</div>
      </div>

      <div className="mt-4 space-y-3">
        {items.length ? (
          items.map((item) => (
            <div key={item.id} className="app-panel-soft rounded-3xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-ink">{item.title}</div>
                  <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">{item.address}</div>
                </div>
                <div className="app-chip rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(var(--app-primary-rgb),0.72)]">
                  {item.kind.replaceAll("_", " ")}
                </div>
              </div>

              <div className="mt-4 grid gap-3 text-sm text-[rgba(var(--app-primary-rgb),0.72)] md:grid-cols-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[rgba(var(--app-primary-rgb),0.56)]">Due</div>
                  <div className="mt-1">{formatDateTime(item.dueAt)}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[rgba(var(--app-primary-rgb),0.56)]">Lead State</div>
                  <div className="mt-1">{item.leadStatus ?? "No lead state"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[rgba(var(--app-primary-rgb),0.56)]">Area</div>
                  <div className="mt-1">{[item.city, item.state].filter(Boolean).join(", ") || "Unknown area"}</div>
                </div>
              </div>

              {item.notes ? (
                <div className="mt-3 text-sm text-[rgba(var(--app-primary-rgb),0.72)]">{formatTaskNotes(item.notes)}</div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                {item.propertyId ? (
                  <>
                    <Link
                      href={`/properties/${item.propertyId}` as Route}
                      className="app-glass-button rounded-2xl px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-105"
                    >
                      Property
                    </Link>
                    <Link
                      href={`/map?propertyId=${item.propertyId}` as Route}
                      className="app-primary-button rounded-2xl px-4 py-2 text-sm font-semibold transition hover:brightness-110"
                    >
                      Open on Map
                    </Link>
                  </>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <div className="app-panel-soft rounded-3xl border border-dashed p-4 text-sm text-[rgba(var(--app-primary-rgb),0.6)]">
            {emptyLabel}
          </div>
        )}
      </div>
    </section>
  );
}

export function FollowUpPage({
  initialOwnerId = null,
  repName = null
}: {
  initialOwnerId?: string | null;
  repName?: string | null;
}) {
  const { session, appContext } = useAuth();
  const [queue, setQueue] = useState<RepQueueResponse | null>(null);
  const [board, setBoard] = useState<TasksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [ownerId] = useState<string | null>(initialOwnerId);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [routeState, setRouteState] = useState<"idle" | "locating" | "saving" | "error">("idle");
  const [routeError, setRouteError] = useState<string | null>(null);

  const canCreateRoute = !ownerId || ownerId === appContext?.appUser.id;

  const loadFollowUp = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const [queueResponse, tasksResponse] = await Promise.all([
        authFetch(
          session.access_token,
          `/api/queue/rep${ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : ""}`
        ),
        authFetch(
          session.access_token,
          `/api/tasks${ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : ""}`
        )
      ]);

      const queueJson = queueResponse.ok ? ((await queueResponse.json()) as RepQueueResponse) : null;
      const tasksJson = tasksResponse.ok ? ((await tasksResponse.json()) as TasksResponse) : null;
      setQueue(queueJson);
      setBoard(tasksJson);
    } finally {
      setLoading(false);
    }
  }, [ownerId, session?.access_token]);

  useEffect(() => {
    void loadFollowUp();
  }, [loadFollowUp]);

  useEffect(() => {
    const visibleLeadIds = new Set(
      [
        ...(queue?.dueNow ?? []),
        ...(queue?.appointments ?? []),
        ...(queue?.revisits ?? []),
        ...(queue?.opportunities ?? []),
        ...(queue?.needsAttention ?? [])
      ].map((item) => item.leadId)
    );
    setSelectedLeadIds((current) => current.filter((leadId) => visibleLeadIds.has(leadId)));
  }, [queue]);

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

  const summary = useMemo(
    () => ({
      doToday:
        (queue?.summary.dueNow ?? 0) +
        (queue?.summary.appointments ?? 0) +
        (board?.summary.overdue ?? 0) +
        (board?.summary.today ?? 0),
      atRisk:
        (queue?.summary.needsAttention ?? 0) +
        (queue?.summary.opportunities ?? 0) +
        (board?.summary.needsAttention ?? 0),
      comingUp:
        (queue?.summary.revisits ?? 0) +
        (board?.summary.upcoming ?? 0)
    }),
    [board?.summary.needsAttention, board?.summary.overdue, board?.summary.today, board?.summary.upcoming, queue?.summary.appointments, queue?.summary.dueNow, queue?.summary.needsAttention, queue?.summary.opportunities, queue?.summary.revisits]
  );

  return (
    <div className="p-4 md:p-6">
      <div className="app-panel rounded-[2rem] border p-5 md:p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Follow Up</div>
        <h1 className="mt-2 text-2xl font-semibold text-ink md:text-3xl">What needs your attention today</h1>
        <p className="mt-3 max-w-3xl text-sm text-[rgba(var(--app-primary-rgb),0.72)]">
          One workspace for the day’s appointments, promised next steps, revisits, and leads most likely to slip if you do nothing.
        </p>
        {repName ? (
          <div className="app-chip mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(var(--app-primary-rgb),0.72)]">
            Viewing {repName}&apos;s follow up
          </div>
        ) : null}

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {[
            {
              label: "Do Today",
              value: summary.doToday,
              detail: "Overdue items, due-now follow-ups, and today’s appointments",
              icon: Clock3
            },
            {
              label: "At Risk",
              value: summary.atRisk,
              detail: "Active leads with momentum but no solid next step",
              icon: TriangleAlert
            },
            {
              label: "Coming Up",
              value: summary.comingUp,
              detail: "Revisits and future tasks already on the books",
              icon: CalendarCheck2
            }
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="app-panel-soft rounded-3xl border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">{item.label}</div>
                  <Icon className="h-4 w-4 text-[rgba(var(--app-primary-rgb),0.56)]" />
                </div>
                <div className="mt-2 text-3xl font-semibold text-ink">{loading ? "…" : item.value}</div>
                <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">{item.detail}</div>
              </div>
            );
          })}
        </div>
      </div>

      {canCreateRoute ? (
        <div className="mt-6 rounded-[1.6rem] border border-[rgba(var(--app-primary-rgb),0.18)] bg-[linear-gradient(135deg,rgba(var(--app-primary-rgb),0.96)_0%,rgba(var(--app-primary-rgb),0.84)_52%,rgba(var(--app-accent-rgb),0.88)_100%)] p-4 text-white shadow-panel">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Route Builder</div>
              <div className="mt-2 text-lg font-semibold">
                {selectedLeadIds.length ? `${selectedLeadIds.length} lead${selectedLeadIds.length === 1 ? "" : "s"} selected` : "Select follow-up stops to build a route"}
              </div>
              <p className="mt-1 text-sm text-white/70">
                Build an optimized stop order from your current location and jump straight back onto the map.
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
              className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {routeState === "locating"
                ? "Getting location..."
                : routeState === "saving"
                  ? "Building route..."
                  : "Build Route"}
            </button>
            <div className="text-sm text-white/75">
              {routeError
                ? routeError
                : selectedLeadIds.length
                  ? "Only selected leads will be routed."
                  : "Pick leads from the sections below to include them."}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6">
        <section className="grid gap-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Do Today</div>
            <h2 className="mt-2 text-2xl font-semibold text-ink">Handle these before the day gets away from you</h2>
          </div>

          <QueueSection
            title="Due Now"
            description="Overdue follow-ups and time-sensitive lead work that should move first."
            items={queue?.dueNow ?? []}
            accessToken={session?.access_token ?? null}
            onUpdated={loadFollowUp}
            selectable={canCreateRoute}
            selectedLeadIds={new Set(selectedLeadIds)}
            onToggleSelected={toggleSelectedLead}
          />
          <QueueSection
            title="Appointments"
            description="Scheduled conversations and appointments that need to stay protected."
            items={queue?.appointments ?? []}
            accessToken={session?.access_token ?? null}
            onUpdated={loadFollowUp}
            selectable={canCreateRoute}
            selectedLeadIds={new Set(selectedLeadIds)}
            onToggleSelected={toggleSelectedLead}
          />
          <FollowUpTaskSection
            title="Tasks Due Today"
            description="Concrete actions already on your plate today, including anything overdue."
            items={[...(board?.overdue ?? []), ...(board?.today ?? [])]}
            emptyLabel="Nothing else is due today."
          />
        </section>

        <section className="grid gap-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">At Risk</div>
            <h2 className="mt-2 text-2xl font-semibold text-ink">These are the leads most likely to slip</h2>
          </div>

          <QueueSection
            title="Needs Attention"
            description="Good leads with no locked next step yet. These are the easiest to drop."
            items={queue?.needsAttention ?? []}
            accessToken={session?.access_token ?? null}
            onUpdated={loadFollowUp}
            selectable={canCreateRoute}
            selectedLeadIds={new Set(selectedLeadIds)}
            onToggleSelected={toggleSelectedLead}
          />
          <QueueSection
            title="Active Opportunities"
            description="Promising leads with momentum that still need you to keep pushing."
            items={queue?.opportunities ?? []}
            accessToken={session?.access_token ?? null}
            onUpdated={loadFollowUp}
            selectable={canCreateRoute}
            selectedLeadIds={new Set(selectedLeadIds)}
            onToggleSelected={toggleSelectedLead}
          />
          <FollowUpTaskSection
            title="Needs Next Step"
            description="Task-side follow-up gaps that need a real next action."
            items={board?.needsAttention ?? []}
            emptyLabel="No orphaned opportunities right now."
          />
        </section>

        <section className="grid gap-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Coming Up</div>
            <h2 className="mt-2 text-2xl font-semibold text-ink">Stay ahead of the next wave</h2>
          </div>

          <QueueSection
            title="Revisits"
            description="Doors worth working again based on past attempts and field timing."
            items={queue?.revisits ?? []}
            accessToken={session?.access_token ?? null}
            onUpdated={loadFollowUp}
            selectable={canCreateRoute}
            selectedLeadIds={new Set(selectedLeadIds)}
            onToggleSelected={toggleSelectedLead}
          />
          <FollowUpTaskSection
            title="Upcoming Tasks"
            description="Already scheduled work later today and beyond."
            items={board?.upcoming ?? []}
            emptyLabel="Nothing upcoming is scheduled yet."
          />
        </section>
      </div>
    </div>
  );
}
