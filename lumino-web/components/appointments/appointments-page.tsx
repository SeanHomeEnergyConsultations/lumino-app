"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calendar,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  RefreshCcw,
  Sparkles,
  TriangleAlert
} from "lucide-react";
import type { AppointmentScheduleItem, AppointmentsResponse } from "@/types/api";
import { buildGoogleCalendarUrl } from "@/lib/appointments/calendar";
import { GoogleCalendarSyncCard } from "@/components/appointments/google-calendar-sync-card";
import { authFetch, useAuth } from "@/lib/auth/client";

type CalendarView = "agenda" | "week" | "month";

type AppointmentStatus = AppointmentScheduleItem["appointmentStatus"];

type DayBucket = {
  key: string;
  label: string;
  date: Date;
  isToday: boolean;
  isSelected: boolean;
  isCurrentMonth?: boolean;
  items: AppointmentScheduleItem[];
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function startOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(value: Date) {
  const next = startOfDay(value);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

function startOfMonthGrid(value: Date) {
  const next = new Date(value.getFullYear(), value.getMonth(), 1);
  return startOfWeek(next);
}

function monthLabel(value: Date) {
  return value.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function dayLabel(value: Date) {
  return value.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function shortDayLabel(value: Date) {
  return value.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function isoDayKey(value: Date) {
  return startOfDay(value).toISOString().slice(0, 10);
}

function getStatusTone(status: AppointmentStatus) {
  switch (status) {
    case "confirmed":
      return "bg-emerald-500/16 text-emerald-700 ring-1 ring-emerald-500/20";
    case "completed":
      return "bg-sky-500/16 text-sky-700 ring-1 ring-sky-500/20";
    case "no_show":
      return "bg-rose-500/16 text-rose-700 ring-1 ring-rose-500/20";
    case "cancelled":
      return "bg-slate-500/16 text-slate-700 ring-1 ring-slate-500/20";
    case "rescheduled":
      return "bg-amber-500/16 text-amber-700 ring-1 ring-amber-500/20";
    default:
      return "bg-[rgba(var(--app-primary-rgb),0.12)] text-ink ring-1 ring-[rgba(var(--app-primary-rgb),0.1)]";
  }
}

function getPriorityTone(item: AppointmentScheduleItem) {
  const now = Date.now();
  const scheduledTs = new Date(item.scheduledAt).getTime();

  if (scheduledTs < now && !["completed", "cancelled", "no_show"].includes(item.appointmentStatus)) {
    return {
      label: "Past Due",
      className: "bg-rose-500/16 text-rose-700 ring-1 ring-rose-500/20"
    };
  }

  const sameDay = isoDayKey(new Date()) === isoDayKey(new Date(item.scheduledAt));
  if (sameDay) {
    return {
      label: "Today",
      className: "bg-amber-500/16 text-amber-800 ring-1 ring-amber-500/20"
    };
  }

  return {
    label: "Upcoming",
    className: "bg-[rgba(var(--app-accent-rgb),0.18)] text-[rgba(var(--app-primary-rgb),0.88)] ring-1 ring-[rgba(var(--app-accent-rgb),0.2)]"
  };
}

function AppointmentActionBar({
  item,
  onQueueReminder,
  remindingLeadId,
  onUpdateStatus,
  updatingLeadId,
  onDownloadCalendar,
  downloadingLeadId
}: {
  item: AppointmentScheduleItem;
  onQueueReminder: (item: AppointmentScheduleItem) => Promise<void>;
  remindingLeadId: string | null;
  onUpdateStatus: (
    item: AppointmentScheduleItem,
    status: AppointmentScheduleItem["appointmentStatus"]
  ) => Promise<void>;
  updatingLeadId: string | null;
  onDownloadCalendar: (item: AppointmentScheduleItem) => Promise<void>;
  downloadingLeadId: string | null;
}) {
  const googleCalendarUrl =
    typeof window === "undefined"
      ? "#"
      : buildGoogleCalendarUrl(item, {
          appUrl: window.location.origin
        });

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Link
        href={`/properties/${item.propertyId}` as Route}
        className="app-glass-button rounded-2xl px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-105"
      >
        Property
      </Link>
      <Link
        href={`/map?propertyId=${item.propertyId}` as Route}
        className="app-primary-button rounded-2xl px-4 py-2 text-sm font-semibold transition hover:brightness-105"
      >
        Open on Map
      </Link>
      <button
        type="button"
        onClick={() => void onQueueReminder(item)}
        disabled={Boolean(item.reminderTaskId) || remindingLeadId === item.leadId}
        className="app-glass-button rounded-2xl px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {item.reminderTaskId
          ? "Reminder queued"
          : remindingLeadId === item.leadId
            ? "Queuing..."
            : "Queue reminder"}
      </button>
      <button
        type="button"
        onClick={() => void onDownloadCalendar(item)}
        disabled={downloadingLeadId === item.leadId}
        className="app-glass-button flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        {downloadingLeadId === item.leadId ? "Preparing..." : "Download .ics"}
      </button>
      <a
        href={googleCalendarUrl}
        target="_blank"
        rel="noreferrer"
        className="app-glass-button flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-105"
      >
        <ExternalLink className="h-4 w-4" />
        Google
      </a>
      {["confirmed", "completed", "no_show"].map((status) => (
        <button
          key={status}
          type="button"
          onClick={() => void onUpdateStatus(item, status as AppointmentStatus)}
          disabled={updatingLeadId === item.leadId || item.appointmentStatus === status}
          className="app-glass-button rounded-2xl px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {updatingLeadId === item.leadId && item.appointmentStatus !== status
            ? "Saving..."
            : status.replaceAll("_", " ")}
        </button>
      ))}
    </div>
  );
}

function AppointmentAgendaCard({
  item,
  onQueueReminder,
  remindingLeadId,
  onUpdateStatus,
  updatingLeadId,
  compact = false,
  onDownloadCalendar,
  downloadingLeadId
}: {
  item: AppointmentScheduleItem;
  onQueueReminder: (item: AppointmentScheduleItem) => Promise<void>;
  remindingLeadId: string | null;
  onUpdateStatus: (
    item: AppointmentScheduleItem,
    status: AppointmentScheduleItem["appointmentStatus"]
  ) => Promise<void>;
  updatingLeadId: string | null;
  compact?: boolean;
  onDownloadCalendar: (item: AppointmentScheduleItem) => Promise<void>;
  downloadingLeadId: string | null;
}) {
  const priorityTone = getPriorityTone(item);

  return (
    <div className={`app-panel-soft rounded-[1.6rem] border p-4 ${compact ? "" : "shadow-panel"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-lg font-semibold text-ink">{item.address}</div>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${priorityTone.className}`}>
              {priorityTone.label}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getStatusTone(item.appointmentStatus)}`}>
              {item.appointmentStatus.replaceAll("_", " ")}
            </span>
          </div>
          <div className="mt-1 text-sm text-[rgba(var(--app-primary-rgb),0.72)]">
            {[item.city, item.state].filter(Boolean).join(", ") || "Unknown area"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-base font-semibold text-ink">{formatTime(item.scheduledAt)}</div>
          <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">{shortDayLabel(new Date(item.scheduledAt))}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-sm text-[rgba(var(--app-primary-rgb),0.74)] md:grid-cols-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">Contact</div>
          <div className="mt-1">{item.contactName ?? "No homeowner captured"}</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">Phone</div>
          <div className="mt-1">{item.phone ?? "No phone yet"}</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">Owner</div>
          <div className="mt-1">{item.ownerName ?? "Unassigned"}</div>
        </div>
      </div>

      <div className="app-glass-button mt-3 rounded-2xl px-3 py-2 text-xs text-[rgba(var(--app-primary-rgb),0.7)]">
        {item.reminderTaskId
          ? `Reminder queued for ${formatDateTime(item.reminderDueAt ?? item.scheduledAt)}`
          : "No reminder task queued yet."}
      </div>

      {!compact ? (
        <AppointmentActionBar
          item={item}
          onQueueReminder={onQueueReminder}
          remindingLeadId={remindingLeadId}
          onUpdateStatus={onUpdateStatus}
          updatingLeadId={updatingLeadId}
          onDownloadCalendar={onDownloadCalendar}
          downloadingLeadId={downloadingLeadId}
        />
      ) : null}
    </div>
  );
}

function CalendarCell({
  bucket,
  view,
  onSelect
}: {
  bucket: DayBucket;
  view: CalendarView;
  onSelect: (date: Date) => void;
}) {
  const visibleItems = bucket.items.slice(0, view === "month" ? 3 : 5);
  const remainingCount = Math.max(bucket.items.length - visibleItems.length, 0);

  return (
    <button
      type="button"
      onClick={() => onSelect(bucket.date)}
      className={`app-panel-soft min-h-[10rem] rounded-[1.4rem] border p-3 text-left transition hover:brightness-105 ${
        bucket.isSelected ? "ring-2 ring-[rgba(var(--app-accent-rgb),0.42)]" : ""
      } ${bucket.isCurrentMonth === false ? "opacity-55" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">
            {WEEKDAY_LABELS[bucket.date.getDay()]}
          </div>
          <div className="mt-1 text-xl font-semibold text-ink">{bucket.date.getDate()}</div>
        </div>
        {bucket.isToday ? (
          <span className="rounded-full bg-[rgba(var(--app-accent-rgb),0.18)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[rgba(var(--app-primary-rgb),0.8)]">
            Today
          </span>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        {visibleItems.length ? (
          visibleItems.map((item) => (
            <div
              key={item.leadId}
              className="app-glass-button rounded-2xl px-2.5 py-2 text-xs text-[rgba(var(--app-primary-rgb),0.78)]"
            >
              <div className="font-semibold text-ink">{formatTime(item.scheduledAt)}</div>
              <div className="mt-0.5 truncate">{item.address}</div>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-[rgba(var(--app-primary-rgb),0.12)] px-2.5 py-3 text-xs text-[rgba(var(--app-primary-rgb),0.46)]">
            Open for scheduling
          </div>
        )}

        {remainingCount ? (
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(var(--app-primary-rgb),0.52)]">
            +{remainingCount} more
          </div>
        ) : null}
      </div>
    </button>
  );
}

export function AppointmentsPage({ initialOwnerId = null }: { initialOwnerId?: string | null }) {
  const { session } = useAuth();
  const [appointments, setAppointments] = useState<AppointmentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [remindingLeadId, setRemindingLeadId] = useState<string | null>(null);
  const [updatingLeadId, setUpdatingLeadId] = useState<string | null>(null);
  const [downloadingLeadId, setDownloadingLeadId] = useState<string | null>(null);
  const [calendarView, setCalendarView] = useState<CalendarView>("week");
  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()));
  const [anchorDate, setAnchorDate] = useState<Date>(() => startOfDay(new Date()));

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

  const allItems = useMemo(() => {
    const merged = [
      ...(appointments?.pastDue ?? []),
      ...(appointments?.today ?? []),
      ...(appointments?.upcoming ?? [])
    ];

    return merged.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }, [appointments]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, AppointmentScheduleItem[]>();
    for (const item of allItems) {
      const key = isoDayKey(new Date(item.scheduledAt));
      const current = map.get(key) ?? [];
      current.push(item);
      map.set(key, current);
    }
    return map;
  }, [allItems]);

  const selectedDayItems = useMemo(
    () => itemsByDay.get(isoDayKey(selectedDate)) ?? [],
    [itemsByDay, selectedDate]
  );

  const weekBuckets = useMemo<DayBucket[]>(() => {
    const start = startOfWeek(anchorDate);
    const todayKey = isoDayKey(new Date());
    const selectedKey = isoDayKey(selectedDate);

    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index);
      const key = isoDayKey(date);
      return {
        key,
        label: dayLabel(date),
        date,
        isToday: key === todayKey,
        isSelected: key === selectedKey,
        items: itemsByDay.get(key) ?? []
      };
    });
  }, [anchorDate, itemsByDay, selectedDate]);

  const monthBuckets = useMemo<DayBucket[]>(() => {
    const start = startOfMonthGrid(anchorDate);
    const todayKey = isoDayKey(new Date());
    const selectedKey = isoDayKey(selectedDate);
    const currentMonth = anchorDate.getMonth();

    return Array.from({ length: 35 }, (_, index) => {
      const date = addDays(start, index);
      const key = isoDayKey(date);
      return {
        key,
        label: dayLabel(date),
        date,
        isToday: key === todayKey,
        isSelected: key === selectedKey,
        isCurrentMonth: date.getMonth() === currentMonth,
        items: itemsByDay.get(key) ?? []
      };
    });
  }, [anchorDate, itemsByDay, selectedDate]);

  const upcomingItems = useMemo(() => allItems.slice(0, 6), [allItems]);

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

  async function handleUpdateStatus(item: AppointmentScheduleItem, status: AppointmentStatus) {
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

  async function handleDownloadCalendar(item: AppointmentScheduleItem) {
    if (!session?.access_token) return;
    setDownloadingLeadId(item.leadId);
    try {
      const response = await authFetch(session.access_token, `/api/appointments/${encodeURIComponent(item.leadId)}/calendar`);
      if (!response.ok) {
        throw new Error("Failed to generate calendar file");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${item.address || "appointment"}.ics`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } finally {
      setDownloadingLeadId(null);
    }
  }

  function shiftCalendar(direction: -1 | 1) {
    if (calendarView === "month") {
      setAnchorDate((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1));
      return;
    }

    if (calendarView === "week") {
      setAnchorDate((current) => addDays(current, direction * 7));
      return;
    }

    setAnchorDate((current) => addDays(current, direction));
    setSelectedDate((current) => addDays(current, direction));
  }

  function jumpToToday() {
    const today = startOfDay(new Date());
    setAnchorDate(today);
    setSelectedDate(today);
  }

  const headerLabel =
    calendarView === "month"
      ? monthLabel(anchorDate)
      : calendarView === "week"
        ? `${shortDayLabel(weekBuckets[0]?.date ?? anchorDate)} - ${shortDayLabel(weekBuckets[6]?.date ?? anchorDate)}`
        : dayLabel(selectedDate);

  return (
    <div className="p-4 md:p-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_22rem]">
        <div className="space-y-6">
          <section className="app-panel rounded-[2rem] border p-5 md:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Appointments</div>
                <h1 className="mt-2 text-3xl font-semibold text-ink">Calendar-first scheduling workspace</h1>
                <p className="mt-3 max-w-3xl text-sm text-[rgba(var(--app-primary-rgb),0.72)]">
                  Visualize every appointment on a real calendar first, then drill into the day&apos;s agenda and keep the rep workflow moving. Google Calendar will be optional sync on top, not a requirement to use this workspace.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void loadAppointments()}
                  className="app-glass-button flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-105"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={jumpToToday}
                  className="app-primary-button rounded-full px-4 py-2 text-sm font-semibold transition hover:brightness-105"
                >
                  Jump to today
                </button>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {[
                {
                  label: "Past Due",
                  value: appointments?.summary.pastDue ?? 0,
                  icon: TriangleAlert,
                  tone: "text-rose-700"
                },
                {
                  label: "Today",
                  value: appointments?.summary.today ?? 0,
                  icon: CalendarDays,
                  tone: "text-amber-700"
                },
                {
                  label: "Upcoming",
                  value: appointments?.summary.upcoming ?? 0,
                  icon: CalendarRange,
                  tone: "text-sky-700"
                }
              ].map((item) => (
                <div key={item.label} className="app-panel-soft rounded-[1.6rem] border p-4 shadow-panel">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">{item.label}</div>
                      <div className="mt-2 text-3xl font-semibold text-ink">{loading ? "…" : item.value}</div>
                    </div>
                    <div className={`app-glass-button rounded-2xl p-3 ${item.tone}`}>
                      <item.icon className="h-5 w-5" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="app-panel rounded-[2rem] border p-5 md:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Calendar View</div>
                <div className="mt-2 text-2xl font-semibold text-ink">{headerLabel}</div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="app-glass-button flex items-center rounded-full p-1">
                  {[
                    { key: "agenda" as const, label: "Agenda" },
                    { key: "week" as const, label: "Week" },
                    { key: "month" as const, label: "Month" }
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setCalendarView(item.key)}
                      className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                        calendarView === item.key
                          ? "bg-[rgba(var(--app-primary-rgb),0.92)] text-white shadow-panel"
                          : "text-[rgba(var(--app-primary-rgb),0.72)]"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="app-glass-button flex items-center rounded-full p-1">
                  <button
                    type="button"
                    onClick={() => shiftCalendar(-1)}
                    className="rounded-full p-2 text-[rgba(var(--app-primary-rgb),0.72)] transition hover:bg-white/40"
                    aria-label="Previous"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => shiftCalendar(1)}
                    className="rounded-full p-2 text-[rgba(var(--app-primary-rgb),0.72)] transition hover:bg-white/40"
                    aria-label="Next"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {calendarView === "agenda" ? (
              <div className="mt-6 grid gap-4">
                {upcomingItems.length ? (
                  upcomingItems.map((item) => (
                    <AppointmentAgendaCard
                      key={item.leadId}
                      item={item}
                      onQueueReminder={handleQueueReminder}
                      remindingLeadId={remindingLeadId}
                      onUpdateStatus={handleUpdateStatus}
                      updatingLeadId={updatingLeadId}
                      onDownloadCalendar={handleDownloadCalendar}
                      downloadingLeadId={downloadingLeadId}
                    />
                  ))
                ) : (
                  <div className="app-panel-soft rounded-[1.6rem] border p-8 text-center">
                    <Calendar className="mx-auto h-8 w-8 text-[rgba(var(--app-primary-rgb),0.34)]" />
                    <div className="mt-4 text-lg font-semibold text-ink">No appointments scheduled yet</div>
                    <p className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.62)]">
                      Once reps start setting appointments, they&apos;ll land here in a clean agenda flow.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-6">
                <div className="mb-3 grid grid-cols-7 gap-2">
                  {WEEKDAY_LABELS.map((label) => (
                    <div
                      key={label}
                      className="px-2 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-mist"
                    >
                      {label}
                    </div>
                  ))}
                </div>
                <div className={`grid gap-3 ${calendarView === "month" ? "grid-cols-1 md:grid-cols-7" : "grid-cols-1 md:grid-cols-7"}`}>
                  {(calendarView === "month" ? monthBuckets : weekBuckets).map((bucket) => (
                    <CalendarCell key={bucket.key} bucket={bucket} view={calendarView} onSelect={setSelectedDate} />
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="app-panel rounded-[2rem] border p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Selected Day</div>
                <div className="mt-2 text-xl font-semibold text-ink">{dayLabel(selectedDate)}</div>
              </div>
              <div className="app-glass-button rounded-2xl px-3 py-2 text-center">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">Booked</div>
                <div className="mt-1 text-xl font-semibold text-ink">{selectedDayItems.length}</div>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {selectedDayItems.length ? (
                selectedDayItems.map((item) => (
                  <AppointmentAgendaCard
                    key={item.leadId}
                    item={item}
                    compact
                    onQueueReminder={handleQueueReminder}
                    remindingLeadId={remindingLeadId}
                    onUpdateStatus={handleUpdateStatus}
                    updatingLeadId={updatingLeadId}
                    onDownloadCalendar={handleDownloadCalendar}
                    downloadingLeadId={downloadingLeadId}
                  />
                ))
              ) : (
                <div className="app-panel-soft rounded-[1.6rem] border p-4 text-sm text-[rgba(var(--app-primary-rgb),0.6)]">
                  This day is open right now. That&apos;s exactly where future scheduling and conflict checks will matter.
                </div>
              )}
            </div>

            {selectedDayItems.length ? (
              <div className="mt-4 space-y-2">
                {selectedDayItems.map((item) => (
                  <AppointmentActionBar
                    key={`${item.leadId}-actions`}
                    item={item}
                    onQueueReminder={handleQueueReminder}
                    remindingLeadId={remindingLeadId}
                    onUpdateStatus={handleUpdateStatus}
                    updatingLeadId={updatingLeadId}
                    onDownloadCalendar={handleDownloadCalendar}
                    downloadingLeadId={downloadingLeadId}
                  />
                ))}
              </div>
            ) : null}
          </section>

          <section className="app-panel rounded-[2rem] border p-5">
            <GoogleCalendarSyncCard appointmentAt={selectedDayItems[0]?.scheduledAt ?? null} returnTo="/appointments" />

            <div className="app-panel-soft mt-4 rounded-[1.6rem] border p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Clock3 className="h-4 w-4 text-[rgba(var(--app-primary-rgb),0.72)]" />
                Next integration layer
              </div>
              <p className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.66)]">
                Lumino now exports `.ics`, opens events in Google Calendar, and can optionally connect a rep&apos;s Google calendar for free/busy checks. The next layer after that is syncing confirmed updates and cancellations automatically.
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-mist">
                <ExternalLink className="h-3.5 w-3.5" />
                Optional sync, not required
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
