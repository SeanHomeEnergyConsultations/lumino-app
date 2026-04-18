"use client";

import { useEffect, useState } from "react";
import type { RepQueueResponse } from "@/types/api";
import { QueueSection } from "@/components/queue/queue-section";
import { authFetch, useAuth } from "@/lib/auth/client";

export function QueuePage() {
  const { session } = useAuth();
  const [queue, setQueue] = useState<RepQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.access_token) return;

    let cancelled = false;
    setLoading(true);
    authFetch(session.access_token, "/api/queue/rep")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as RepQueueResponse;
      })
      .then((json) => {
        if (!cancelled) {
          setQueue(json);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  return (
    <div className="p-4 md:p-6">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Rep Queue</div>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Daily follow-up command center</h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">
          Work the day from here when you are not actively walking the map. Everything below is meant to get you back into the right property with the right next step quickly.
        </p>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          {[
            { label: "Due Now", value: queue?.summary.dueNow ?? 0 },
            { label: "Revisits", value: queue?.summary.revisits ?? 0 },
            { label: "Appointments", value: queue?.summary.appointments ?? 0 },
            { label: "Opportunities", value: queue?.summary.opportunities ?? 0 }
          ].map((item) => (
            <div key={item.label} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">{item.label}</div>
              <div className="mt-2 text-3xl font-semibold text-ink">{loading ? "…" : item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-6">
        <QueueSection
          title="Due Now"
          description="Overdue follow-ups and time-sensitive work that should be touched first."
          items={queue?.dueNow ?? []}
        />
        <QueueSection
          title="Today’s Revisit Targets"
          description="Doors that were not home or received a doorhanger and should be worked again."
          items={queue?.revisits ?? []}
        />
        <QueueSection
          title="Appointments"
          description="Scheduled conversations and upcoming sales moments that need attention."
          items={queue?.appointments ?? []}
        />
        <QueueSection
          title="New Opportunities"
          description="Promising properties that need a real next step so they do not leak out of the funnel."
          items={queue?.opportunities ?? []}
        />
      </div>
    </div>
  );
}
