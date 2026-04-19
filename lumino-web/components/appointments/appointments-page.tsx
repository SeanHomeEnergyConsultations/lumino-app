"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useState } from "react";
import type { AppointmentScheduleItem, AppointmentsResponse } from "@/types/api";
import { authFetch, useAuth } from "@/lib/auth/client";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function AppointmentSection({
  title,
  description,
  items,
  emptyLabel,
  onQueueReminder,
  remindingLeadId,
  onUpdateStatus,
  updatingLeadId
}: {
  title: string;
  description: string;
  items: AppointmentScheduleItem[];
  emptyLabel: string;
  onQueueReminder: (item: AppointmentScheduleItem) => Promise<void>;
  remindingLeadId: string | null;
  onUpdateStatus: (
    item: AppointmentScheduleItem,
    status: AppointmentScheduleItem["appointmentStatus"]
  ) => Promise<void>;
  updatingLeadId: string | null;
}) {
  return (
    <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">{title}</div>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
      </div>

      <div className="mt-4 space-y-3">
        {items.length ? (
          items.map((item) => (
            <div key={item.leadId} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-ink">{item.address}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {[item.city, item.state].filter(Boolean).join(", ") || "Unknown area"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-ink">{formatDateTime(item.scheduledAt)}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">
                    {item.appointmentStatus.replaceAll("_", " ")}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Contact</div>
                  <div className="mt-1">{item.contactName ?? "No homeowner captured"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Phone</div>
                  <div className="mt-1">{item.phone ?? "No phone yet"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Owner</div>
                  <div className="mt-1">{item.ownerName ?? "Unassigned"}</div>
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                {item.reminderTaskId
                  ? `Reminder queued for ${formatDateTime(item.reminderDueAt ?? item.scheduledAt)}`
                  : "No reminder task queued yet."}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/properties/${item.propertyId}` as Route}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-slate-300"
                >
                  Property
                </Link>
                <Link
                  href={`/map?propertyId=${item.propertyId}` as Route}
                  className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Open on Map
                </Link>
                <button
                  type="button"
                  onClick={() => void onQueueReminder(item)}
                  disabled={Boolean(item.reminderTaskId) || remindingLeadId === item.leadId}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {item.reminderTaskId
                    ? "Reminder queued"
                    : remindingLeadId === item.leadId
                      ? "Queuing..."
                      : "Queue reminder"}
                </button>
                {["confirmed", "completed", "no_show"].map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => void onUpdateStatus(item, status as AppointmentScheduleItem["appointmentStatus"])}
                    disabled={updatingLeadId === item.leadId || item.appointmentStatus === status}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updatingLeadId === item.leadId && item.appointmentStatus !== status
                      ? "Saving..."
                      : status.replaceAll("_", " ")}
                  </button>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            {emptyLabel}
          </div>
        )}
      </div>
    </section>
  );
}

export function AppointmentsPage({ initialOwnerId = null }: { initialOwnerId?: string | null }) {
  const { session } = useAuth();
  const [appointments, setAppointments] = useState<AppointmentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [remindingLeadId, setRemindingLeadId] = useState<string | null>(null);
  const [updatingLeadId, setUpdatingLeadId] = useState<string | null>(null);

  const loadAppointments = useCallback(async () => {
    if (!session?.access_token) return null;
    setLoading(true);
    try {
      const response = await authFetch(
        session.access_token,
        `/api/appointments${initialOwnerId ? `?ownerId=${encodeURIComponent(initialOwnerId)}` : ""}`
      );
      if (!response.ok) return null;
      const json = (await response.json()) as AppointmentsResponse;
      setAppointments(json);
      return json;
    } finally {
      setLoading(false);
    }
  }, [initialOwnerId, session?.access_token]);

  useEffect(() => {
    void loadAppointments();
  }, [loadAppointments]);

  async function handleQueueReminder(item: AppointmentScheduleItem) {
    if (!session?.access_token) return;
    setRemindingLeadId(item.leadId);
    try {
      const appointmentTs = new Date(item.scheduledAt).getTime();
      const now = Date.now();
      const dueAt = new Date(Math.max(now + 30 * 60 * 1000, appointmentTs - 24 * 60 * 60 * 1000));
      const response = await authFetch(session.access_token, "/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          propertyId: item.propertyId,
          leadId: item.leadId,
          type: "appointment_confirm",
          dueAt: dueAt.toISOString(),
          notes: "Manual appointment reminder queued from appointments workspace."
        })
      });

      if (!response.ok) throw new Error("Failed to queue reminder");
      await loadAppointments();
    } finally {
      setRemindingLeadId(null);
    }
  }

  async function handleUpdateStatus(
    item: AppointmentScheduleItem,
    status: AppointmentScheduleItem["appointmentStatus"]
  ) {
    if (!session?.access_token) return;
    setUpdatingLeadId(item.leadId);
    try {
      const response = await authFetch(session.access_token, "/api/appointments", {
        method: "POST",
        body: JSON.stringify({
          leadId: item.leadId,
          status,
          notes: `Appointment marked ${status.replaceAll("_", " ")} from appointments workspace.`
        })
      });

      if (!response.ok) throw new Error("Failed to update appointment");
      await loadAppointments();
    } finally {
      setUpdatingLeadId(null);
    }
  }

  return (
    <div className="p-4 md:p-6">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Appointments</div>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Scheduled sales moments</h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">
          Keep appointments visible, accountable, and easy to open from the map or property memory.
        </p>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {[
            { label: "Past Due", value: appointments?.summary.pastDue ?? 0 },
            { label: "Today", value: appointments?.summary.today ?? 0 },
            { label: "Upcoming", value: appointments?.summary.upcoming ?? 0 }
          ].map((item) => (
            <div key={item.label} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">{item.label}</div>
              <div className="mt-2 text-3xl font-semibold text-ink">{loading ? "…" : item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-6">
        <AppointmentSection
          title="Past Due"
          description="Appointments in the past that still look open and probably need manager cleanup."
          items={appointments?.pastDue ?? []}
          emptyLabel="No past-due appointments right now."
          onQueueReminder={handleQueueReminder}
          remindingLeadId={remindingLeadId}
          onUpdateStatus={handleUpdateStatus}
          updatingLeadId={updatingLeadId}
        />
        <AppointmentSection
          title="Today"
          description="Appointments happening today that reps and managers should stay on top of."
          items={appointments?.today ?? []}
          emptyLabel="No appointments scheduled for today."
          onQueueReminder={handleQueueReminder}
          remindingLeadId={remindingLeadId}
          onUpdateStatus={handleUpdateStatus}
          updatingLeadId={updatingLeadId}
        />
        <AppointmentSection
          title="Upcoming"
          description="Future appointments already on the calendar."
          items={appointments?.upcoming ?? []}
          emptyLabel="No future appointments are scheduled yet."
          onQueueReminder={handleQueueReminder}
          remindingLeadId={remindingLeadId}
          onUpdateStatus={handleUpdateStatus}
          updatingLeadId={updatingLeadId}
        />
      </div>
    </div>
  );
}
