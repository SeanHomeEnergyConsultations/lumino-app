"use client";

import Link from "next/link";
import type { RepQueueItem } from "@/types/api";

function formatDateTime(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleString();
}

export function QueueCard({ item }: { item: RepQueueItem }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink">{item.address}</div>
          <div className="mt-1 text-xs text-slate-500">
            {item.lastVisitOutcome ?? "No last outcome"} · {item.visitCount} visits
            {item.notHomeCount > 1 ? ` · ${item.notHomeCount} not-home tries` : ""}
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
          {item.leadStatus ?? "New"}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-500">
        <div>
          <div className="font-semibold text-slate-700">Last visit</div>
          <div className="mt-1">{formatDateTime(item.lastVisitedAt) ?? "Never"}</div>
        </div>
        <div>
          <div className="font-semibold text-slate-700">Next follow-up</div>
          <div className="mt-1">{formatDateTime(item.nextFollowUpAt) ?? "Not scheduled"}</div>
        </div>
        <div>
          <div className="font-semibold text-slate-700">Appointment</div>
          <div className="mt-1">{formatDateTime(item.appointmentAt) ?? "None"}</div>
        </div>
        <div>
          <div className="font-semibold text-slate-700">Location</div>
          <div className="mt-1">
            {[item.city, item.state].filter(Boolean).join(", ") || item.postalCode || "Unknown"}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Link
          href={`/map?propertyId=${item.propertyId}`}
          className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Open on Map
        </Link>
      </div>
    </div>
  );
}
