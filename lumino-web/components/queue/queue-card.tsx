"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/auth/client";
import { formatDateTime } from "@/lib/format/date";
import type { RepQueueItem } from "@/types/api";

function toDateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function QueueCard({
  item,
  accessToken,
  onUpdated,
  selectable = false,
  selected = false,
  onToggleSelected
}: {
  item: RepQueueItem;
  accessToken: string | null;
  onUpdated: () => Promise<unknown>;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelected?: (leadId: string) => void;
}) {
  const [nextFollowUpAt, setNextFollowUpAt] = useState(toDateTimeLocal(item.nextFollowUpAt));
  const [appointmentAt, setAppointmentAt] = useState(toDateTimeLocal(item.appointmentAt));
  const [actionState, setActionState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    setNextFollowUpAt(toDateTimeLocal(item.nextFollowUpAt));
    setAppointmentAt(toDateTimeLocal(item.appointmentAt));
    setActionState("idle");
  }, [item.appointmentAt, item.nextFollowUpAt, item.priority]);

  const actionConfig = useMemo(() => {
    if (item.priority === "appointment") {
      return {
        title: "Appointment time",
        helper: "Update the scheduled appointment so the team can trust the calendar.",
        value: appointmentAt,
        setValue: setAppointmentAt,
        buttonLabel: "Save Appointment",
        payload: () => ({
          propertyId: item.propertyId,
          leadStatus: "Appointment Set",
          appointmentAt: appointmentAt ? new Date(appointmentAt).toISOString() : null,
          nextFollowUpAt: appointmentAt ? new Date(appointmentAt).toISOString() : null
        })
      };
    }

    if (item.priority === "revisit" || item.priority === "due_now") {
      return {
        title: "Next revisit",
        helper: "Lock in the next attempt without losing the field history you already have.",
        value: nextFollowUpAt,
        setValue: setNextFollowUpAt,
        buttonLabel: "Save Revisit",
        payload: () => ({
          propertyId: item.propertyId,
          leadStatus: item.leadStatus ?? "Attempting Contact",
          nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt).toISOString() : null
        })
      };
    }

    return {
      title: "Next step",
      helper: "Give this opportunity a concrete next step so it does not go stale.",
      value: nextFollowUpAt,
      setValue: setNextFollowUpAt,
      buttonLabel: "Save Next Step",
      payload: () => ({
        propertyId: item.propertyId,
        leadStatus: item.leadStatus ?? "Connected",
        nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt).toISOString() : null
      })
    };
  }, [appointmentAt, item.leadStatus, item.priority, item.propertyId, nextFollowUpAt]);

  async function handleSaveAction() {
    if (!accessToken) return;

    setActionState("saving");
    try {
      const response = await authFetch(accessToken, "/api/leads", {
        method: "POST",
        body: JSON.stringify(actionConfig.payload())
      });

      if (!response.ok) {
        throw new Error("Failed to save queue action");
      }

      await onUpdated();
      setActionState("saved");
    } catch {
      setActionState("error");
    }
  }

  return (
    <div
      className={`app-panel rounded-3xl border p-4 transition ${
        selected ? "border-ink ring-2 ring-ink/10" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {selectable ? (
            <button
              type="button"
              onClick={() => onToggleSelected?.(item.leadId)}
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold transition ${
                selected
                  ? "border-ink bg-ink text-white"
                  : "app-glass-button text-transparent"
              }`}
              aria-pressed={selected}
              aria-label={selected ? "Deselect lead from route" : "Select lead for route"}
            >
              ✓
            </button>
          ) : null}
          <div>
          <div className="text-sm font-semibold text-ink">{item.address}</div>
          <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">
            {item.lastVisitOutcome ?? "No last outcome"} · {item.visitCount} visits
            {item.notHomeCount > 1 ? ` · ${item.notHomeCount} not-home tries` : ""}
          </div>
        </div>
        </div>
        <span className="app-chip rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(var(--app-primary-rgb),0.72)]">
          {item.leadStatus ?? "New"}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">
        <div>
          <div className="font-semibold text-slate-700">Last visit</div>
          <div className="mt-1">{formatDateTime(item.lastVisitedAt, null) ?? "Never"}</div>
        </div>
        <div>
          <div className="font-semibold text-slate-700">Next follow-up</div>
          <div className="mt-1">{formatDateTime(item.nextFollowUpAt, null) ?? "Not scheduled"}</div>
        </div>
        <div>
          <div className="font-semibold text-slate-700">Appointment</div>
          <div className="mt-1">{formatDateTime(item.appointmentAt, null) ?? "None"}</div>
        </div>
        <div>
          <div className="font-semibold text-slate-700">Location</div>
          <div className="mt-1">
            {[item.city, item.state].filter(Boolean).join(", ") || item.postalCode || "Unknown"}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Link
          href={`/map?propertyId=${item.propertyId}`}
          className="app-primary-button flex items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-semibold transition hover:brightness-110"
        >
          Open on Map
        </Link>
        <Link
          href={`/properties/${item.propertyId}`}
          className="app-glass-button flex items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-semibold text-ink transition hover:brightness-105"
        >
          Full Property
        </Link>
      </div>

      <div className="app-panel-soft mt-4 rounded-3xl border p-4">
        <div className="text-sm font-semibold text-ink">{actionConfig.title}</div>
        <p className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">{actionConfig.helper}</p>
        <input
          type="datetime-local"
          value={actionConfig.value}
          onChange={(event) => actionConfig.setValue(event.target.value)}
          className="app-glass-input mt-3 w-full rounded-2xl px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
        />
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-[rgba(var(--app-primary-rgb),0.58)]">
            {actionState === "saved"
              ? "Saved."
              : actionState === "error"
                ? "Could not save this update."
                : item.priority === "needs_attention"
                  ? "Best used the moment you know the next move."
                  : "This updates the queue without leaving the page."}
          </div>
          <button
            type="button"
            onClick={() => void handleSaveAction()}
            disabled={!accessToken || actionState === "saving"}
            className="app-glass-button w-full rounded-2xl px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {actionState === "saving" ? "Saving..." : actionConfig.buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
