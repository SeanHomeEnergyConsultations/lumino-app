"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { formatDateTime, usePlatformWorkspace } from "@/components/platform/platform-workspace-context";

export function PlatformSecuritySurface() {
  const {
    canMutate,
    events,
    eventTypes,
    items,
    selectedEventType,
    selectedOrganizationId,
    selectedSeverity,
    sendingTestAlert,
    setSelectedEventType,
    setSelectedOrganizationId,
    setSelectedSeverity,
    sendTestSecurityAlert
  } = usePlatformWorkspace();

  return (
    <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-panel backdrop-blur">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-slate-500" />
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Security Events</div>
          <p className="mt-1 text-sm text-slate-500">
            Triage the latest account, import, branding, and rate-limit events across the platform.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <select
          value={selectedOrganizationId}
          onChange={(event) => setSelectedOrganizationId(event.target.value)}
          className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
        >
          <option value="all">All organizations</option>
          {items.map((item) => (
            <option key={item.organizationId} value={item.organizationId}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          value={selectedSeverity}
          onChange={(event) => setSelectedSeverity(event.target.value)}
          className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
        >
          <option value="all">All severity</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="info">Info</option>
        </select>
        <select
          value={selectedEventType}
          onChange={(event) => setSelectedEventType(event.target.value)}
          className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
        >
          <option value="all">All event types</option>
          {eventTypes.map((eventType) => (
            <option key={eventType} value={eventType}>
              {eventType}
            </option>
          ))}
        </select>
      </div>

      {canMutate ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => void sendTestSecurityAlert()}
            disabled={sendingTestAlert}
            className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ShieldAlert className="h-4 w-4" />
            {sendingTestAlert ? "Sending Test Alert…" : "Send Test Alert"}
          </button>
        </div>
      ) : null}

      <div className="mt-5 space-y-3">
        {events.length ? (
          events.map((event) => (
            <details key={event.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <summary className="cursor-pointer list-none">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                          event.severity === "high"
                            ? "bg-rose-100 text-rose-700"
                            : event.severity === "medium"
                              ? "bg-amber-100 text-amber-700"
                              : event.severity === "low"
                                ? "bg-sky-100 text-sky-700"
                                : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {event.severity}
                      </span>
                      <span className="text-sm font-semibold text-ink">{event.eventType}</span>
                    </div>
                    <div className="mt-2 text-sm text-slate-600">
                      {event.organizationName ?? "Platform"} · {event.actorName ?? event.actorEmail ?? "Unknown actor"}
                      {event.targetName || event.targetEmail ? ` → ${event.targetName ?? event.targetEmail}` : ""}
                    </div>
                  </div>
                  <div className="text-sm text-slate-500">{formatDateTime(event.createdAt)}</div>
                </div>
              </summary>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded-2xl bg-white p-3 text-sm text-slate-600">
                  <div>
                    <span className="font-semibold text-slate-800">Organization:</span> {event.organizationName ?? "Platform"}
                  </div>
                  <div className="mt-1">
                    <span className="font-semibold text-slate-800">Actor:</span> {event.actorName ?? event.actorEmail ?? "Unknown"}
                  </div>
                  <div className="mt-1">
                    <span className="font-semibold text-slate-800">Target:</span> {event.targetName ?? event.targetEmail ?? "None"}
                  </div>
                  <div className="mt-1">
                    <span className="font-semibold text-slate-800">IP:</span> {event.ipAddress ?? "Unknown"}
                  </div>
                  <div className="mt-1 break-all">
                    <span className="font-semibold text-slate-800">User Agent:</span> {event.userAgent ?? "Unknown"}
                  </div>
                </div>
                <pre className="overflow-x-auto rounded-2xl bg-slate-950 p-3 text-xs text-slate-100">
                  {JSON.stringify(event.metadata, null, 2)}
                </pre>
              </div>
            </details>
          ))
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
            No security events matched these filters.
          </div>
        )}
      </div>
    </section>
  );
}
