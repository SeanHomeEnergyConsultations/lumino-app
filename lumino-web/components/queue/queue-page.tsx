"use client";

import { useCallback, useEffect, useState } from "react";
import type { RepQueueResponse } from "@/types/api";
import { QueueSection } from "@/components/queue/queue-section";
import { authFetch, useAuth } from "@/lib/auth/client";

export function QueuePage({
  initialOwnerId = null,
  repName = null
}: {
  initialOwnerId?: string | null;
  repName?: string | null;
}) {
  const { session } = useAuth();
  const [queue, setQueue] = useState<RepQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [ownerId] = useState<string | null>(initialOwnerId);

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

  return (
    <div className="p-4 md:p-6">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Rep Queue</div>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Daily follow-up command center</h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">
          Work the day from here when you are not actively walking the map. Everything below is meant to get you back into the right property with the right next step quickly.
        </p>
        {repName ? (
          <div className="mt-3 inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
            Viewing {repName}&apos;s queue
          </div>
        ) : null}

        <div className="mt-6 grid gap-3 md:grid-cols-5">
          {[
            { label: "Due Now", value: queue?.summary.dueNow ?? 0 },
            { label: "Revisits", value: queue?.summary.revisits ?? 0 },
            { label: "Appointments", value: queue?.summary.appointments ?? 0 },
            { label: "Opportunities", value: queue?.summary.opportunities ?? 0 },
            { label: "Needs Attention", value: queue?.summary.needsAttention ?? 0 }
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
          accessToken={session?.access_token ?? null}
          onUpdated={loadQueue}
        />
        <QueueSection
          title="Today’s Revisit Targets"
          description="Doors that were not home or received a doorhanger and should be worked again."
          items={queue?.revisits ?? []}
          accessToken={session?.access_token ?? null}
          onUpdated={loadQueue}
        />
        <QueueSection
          title="Appointments"
          description="Scheduled conversations and upcoming sales moments that need attention."
          items={queue?.appointments ?? []}
          accessToken={session?.access_token ?? null}
          onUpdated={loadQueue}
        />
        <QueueSection
          title="New Opportunities"
          description="Promising properties that already have momentum and should stay moving."
          items={queue?.opportunities ?? []}
          accessToken={session?.access_token ?? null}
          onUpdated={loadQueue}
        />
        <QueueSection
          title="Needs Attention"
          description="Opportunities with no next step yet. These are the ones most likely to leak if you do nothing."
          items={queue?.needsAttention ?? []}
          accessToken={session?.access_token ?? null}
          onUpdated={loadQueue}
        />
      </div>
    </div>
  );
}
