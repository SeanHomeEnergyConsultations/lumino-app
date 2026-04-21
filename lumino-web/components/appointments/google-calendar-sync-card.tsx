"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CalendarSync, CheckCircle2, ExternalLink, Link2Off, TriangleAlert } from "lucide-react";
import { authFetch, useAuth } from "@/lib/auth/client";
import type {
  GoogleCalendarConflictCheckResponse,
  GoogleCalendarConnectResponse,
  GoogleCalendarConnectionStatusResponse
} from "@/types/api";

export function GoogleCalendarSyncCard({
  appointmentAt,
  returnTo = "/appointments",
  compact = false
}: {
  appointmentAt?: string | null;
  returnTo?: string;
  compact?: boolean;
}) {
  const { session } = useAuth();
  const [status, setStatus] = useState<GoogleCalendarConnectionStatusResponse["item"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyCheck, setBusyCheck] = useState<GoogleCalendarConflictCheckResponse | null>(null);
  const [actionState, setActionState] = useState<"idle" | "connecting" | "disconnecting" | "checking">("idle");
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const response = await authFetch(session.access_token, "/api/integrations/google-calendar");
      if (!response.ok) {
        setStatus(null);
        return;
      }
      const json = (await response.json()) as GoogleCalendarConnectionStatusResponse;
      setStatus(json.item);
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    setBusyCheck(null);
    setError(null);
  }, [appointmentAt]);

  async function handleConnect() {
    if (!session?.access_token) return;
    setActionState("connecting");
    setError(null);
    try {
      const response = await authFetch(session.access_token, "/api/integrations/google-calendar", {
        method: "POST",
        body: JSON.stringify({
          redirectPath: returnTo
        })
      });
      const json = (await response.json()) as GoogleCalendarConnectResponse | { error?: string };
      if (!response.ok || !("authUrl" in json)) {
        throw new Error(("error" in json && json.error) || "Failed to start Google Calendar connection.");
      }
      window.location.assign(json.authUrl);
    } catch (connectError) {
      setActionState("idle");
      setError(connectError instanceof Error ? connectError.message : "Could not start Google Calendar connection.");
    }
  }

  async function handleDisconnect() {
    if (!session?.access_token) return;
    setActionState("disconnecting");
    setError(null);
    try {
      const response = await authFetch(session.access_token, "/api/integrations/google-calendar", {
        method: "DELETE"
      });
      if (!response.ok) {
        throw new Error("Failed to disconnect Google Calendar.");
      }
      setBusyCheck(null);
      await loadStatus();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Could not disconnect Google Calendar.");
    } finally {
      setActionState("idle");
    }
  }

  async function handleCheckConflict() {
    if (!session?.access_token || !appointmentAt) return;
    setActionState("checking");
    setError(null);
    try {
      const response = await authFetch(session.access_token, "/api/integrations/google-calendar/freebusy", {
        method: "POST",
        body: JSON.stringify({
          startAt: new Date(appointmentAt).toISOString()
        })
      });
      const json = (await response.json()) as GoogleCalendarConflictCheckResponse | { error?: string };
      if (!response.ok || !("hasConflict" in json)) {
        throw new Error(("error" in json && json.error) || "Could not check Google Calendar conflicts.");
      }
      setBusyCheck(json);
    } catch (conflictError) {
      setError(conflictError instanceof Error ? conflictError.message : "Could not check Google Calendar conflicts.");
    } finally {
      setActionState("idle");
    }
  }

  return (
    <div className={`app-panel-soft rounded-[1.6rem] border p-4 ${compact ? "" : "shadow-panel"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Google Calendar</div>
          <div className="mt-2 text-base font-semibold text-ink">
            {status?.connected ? "Connected scheduling layer" : "Optional personal calendar sync"}
          </div>
        </div>
        <div className="app-glass-button rounded-2xl p-3 text-[rgba(var(--app-primary-rgb),0.72)]">
          <CalendarSync className="h-4 w-4" />
        </div>
      </div>

      <p className="mt-3 text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
        {status?.connected
          ? "Use Google free/busy to catch conflicts before you save an appointment, while Lumino stays your source of truth."
          : "Google Calendar is optional. Connect it when you want availability checks and automatic calendar posting."}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {status?.connected ? (
          <>
            <button
              type="button"
              onClick={() => void handleDisconnect()}
              disabled={actionState === "disconnecting"}
              className="app-glass-button flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-105 disabled:opacity-50"
            >
              <Link2Off className="h-4 w-4" />
              {actionState === "disconnecting" ? "Disconnecting..." : "Disconnect"}
            </button>
            <button
              type="button"
              onClick={() => void handleCheckConflict()}
              disabled={!appointmentAt || actionState === "checking"}
              className="app-primary-button flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition hover:brightness-105 disabled:opacity-50"
            >
              <CalendarClock className="h-4 w-4" />
              {actionState === "checking" ? "Checking..." : "Check conflicts"}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={!status?.configured || actionState === "connecting" || loading}
            className="app-primary-button flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition hover:brightness-105 disabled:opacity-50"
          >
            <ExternalLink className="h-4 w-4" />
            {actionState === "connecting" ? "Connecting..." : "Connect Google Calendar"}
          </button>
        )}
      </div>

      {!status?.configured && !loading ? (
        <div className="mt-3 rounded-2xl border border-dashed border-[rgba(var(--app-primary-rgb),0.14)] px-3 py-3 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">
          Google Calendar env vars are not configured yet, so connection is unavailable.
        </div>
      ) : null}

      {status?.connected ? (
        <div className="mt-3 rounded-2xl border border-[rgba(var(--app-primary-rgb),0.08)] bg-[rgba(var(--app-surface-rgb),0.42)] px-3 py-3 text-xs text-[rgba(var(--app-primary-rgb),0.62)]">
          {status.calendarEmail ? `Connected account: ${status.calendarEmail}` : "Connected to the rep's primary Google Calendar."}
          {status.lastSyncedAt ? ` Last sync: ${new Date(status.lastSyncedAt).toLocaleString()}.` : ""}
        </div>
      ) : null}

      {busyCheck ? (
        <div
          className={`mt-3 rounded-2xl px-3 py-3 text-sm ${
            busyCheck.hasConflict
              ? "bg-rose-500/14 text-rose-800 ring-1 ring-rose-500/18"
              : "bg-emerald-500/14 text-emerald-800 ring-1 ring-emerald-500/18"
          }`}
        >
          <div className="flex items-center gap-2 font-semibold">
            {busyCheck.hasConflict ? <TriangleAlert className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {busyCheck.hasConflict ? "Google Calendar shows a conflict" : "No Google Calendar conflict found"}
          </div>
          {busyCheck.hasConflict ? (
            <div className="mt-2 text-xs">
              Busy windows:
              <ul className="mt-1 space-y-1">
                {busyCheck.busy.map((slot) => (
                  <li key={`${slot.start}-${slot.end}`}>
                    {new Date(slot.start).toLocaleString()} - {new Date(slot.end).toLocaleString()}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-2xl bg-rose-500/12 px-3 py-3 text-xs text-rose-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}
