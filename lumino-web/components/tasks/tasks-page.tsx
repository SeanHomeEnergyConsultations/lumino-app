"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useState } from "react";
import type { TaskBoardItem, TasksResponse } from "@/types/api";
import { authFetch, useAuth } from "@/lib/auth/client";

function formatDateTime(value: string | null) {
  if (!value) return "Unscheduled";
  return new Date(value).toLocaleString();
}

function TaskSection({
  title,
  description,
  items,
  emptyLabel
}: {
  title: string;
  description: string;
  items: TaskBoardItem[];
  emptyLabel: string;
}) {
  return (
    <section className="app-panel rounded-[2rem] border p-5">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">{title}</div>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
      </div>

      <div className="mt-4 space-y-3">
        {items.length ? (
          items.map((item) => (
            <div key={item.id} className="app-panel-soft rounded-3xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-ink">{item.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.address}</div>
                </div>
                <div className="app-chip rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                  {item.kind.replaceAll("_", " ")}
                </div>
              </div>

              <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Due</div>
                  <div className="mt-1">{formatDateTime(item.dueAt)}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Lead State</div>
                  <div className="mt-1">{item.leadStatus ?? "No lead state"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Area</div>
                  <div className="mt-1">{[item.city, item.state].filter(Boolean).join(", ") || "Unknown area"}</div>
                </div>
              </div>

              {item.notes ? <div className="mt-3 text-sm text-slate-600">{item.notes}</div> : null}

              <div className="mt-4 flex flex-wrap gap-2">
                {item.propertyId ? (
                  <>
                    <Link
                      href={`/properties/${item.propertyId}` as Route}
                      className="app-glass-button rounded-2xl px-4 py-2 text-sm font-semibold text-ink transition hover:bg-white/90"
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
                {item.leadId ? (
                  <Link
                    href="/queue"
                    className="app-glass-button rounded-2xl px-4 py-2 text-sm font-semibold text-ink transition hover:bg-white/90"
                  >
                    Queue
                  </Link>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <div className="app-panel-soft rounded-3xl border border-dashed p-4 text-sm text-slate-500">
            {emptyLabel}
          </div>
        )}
      </div>
    </section>
  );
}

export function TasksPage({ initialOwnerId = null }: { initialOwnerId?: string | null }) {
  const { session } = useAuth();
  const [board, setBoard] = useState<TasksResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadBoard = useCallback(async () => {
    if (!session?.access_token) return null;
    setLoading(true);
    try {
      const response = await authFetch(
        session.access_token,
        `/api/tasks${initialOwnerId ? `?ownerId=${encodeURIComponent(initialOwnerId)}` : ""}`
      );
      if (!response.ok) return null;
      const json = (await response.json()) as TasksResponse;
      setBoard(json);
      return json;
    } finally {
      setLoading(false);
    }
  }, [initialOwnerId, session?.access_token]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  return (
    <div className="p-4 md:p-6">
      <div className="app-panel rounded-[2rem] border p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Tasks</div>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Follow-up execution board</h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">
          Work every promised next step from one place, whether it came from a lead follow-up, appointment, or a manual task.
        </p>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          {[
            { label: "Overdue", value: board?.summary.overdue ?? 0 },
            { label: "Today", value: board?.summary.today ?? 0 },
            { label: "Upcoming", value: board?.summary.upcoming ?? 0 },
            { label: "Needs Attention", value: board?.summary.needsAttention ?? 0 }
          ].map((item) => (
            <div key={item.label} className="app-panel-soft rounded-3xl border p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">{item.label}</div>
              <div className="mt-2 text-3xl font-semibold text-ink">{loading ? "…" : item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-6">
        <TaskSection
          title="Overdue"
          description="Promises that should already have been touched again."
          items={board?.overdue ?? []}
          emptyLabel="No overdue tasks right now."
        />
        <TaskSection
          title="Today"
          description="Action items that should get completed before the day closes."
          items={board?.today ?? []}
          emptyLabel="Nothing due today."
        />
        <TaskSection
          title="Upcoming"
          description="Future work that is already scheduled and should stay visible."
          items={board?.upcoming ?? []}
          emptyLabel="No upcoming tasks yet."
        />
        <TaskSection
          title="Needs Attention"
          description="Active leads with no concrete next step scheduled yet."
          items={board?.needsAttention ?? []}
          emptyLabel="No orphaned opportunities right now."
        />
      </div>
    </div>
  );
}
