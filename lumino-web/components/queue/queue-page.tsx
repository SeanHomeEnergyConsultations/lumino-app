"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck2, Clock3, ListTodo, Sparkles, TriangleAlert } from "lucide-react";
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
  const [activeMobileSection, setActiveMobileSection] = useState<
    "dueNow" | "revisits" | "appointments" | "opportunities" | "needsAttention"
  >("dueNow");

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
      <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel md:p-6">
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

        <div className="mt-5 rounded-[1.6rem] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eef4ff_100%)] p-4 md:hidden">
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
          />
        ))}
      </div>
    </div>
  );
}
