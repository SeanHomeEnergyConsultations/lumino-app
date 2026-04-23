"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_APPOINTMENT_DURATION_MINUTES } from "@/lib/appointments/calendar";
import { authFetch } from "@/lib/auth/client";
import type {
  AppointmentsResponse,
  GoogleCalendarConflictCheckResponse,
  GoogleCalendarConnectionStatusResponse
} from "@/types/api";

export const APPOINTMENT_TIME_SLOTS = [
  { label: "9:00 AM", hour: 9, minute: 0 },
  { label: "11:00 AM", hour: 11, minute: 0 },
  { label: "1:00 PM", hour: 13, minute: 0 },
  { label: "3:00 PM", hour: 15, minute: 0 },
  { label: "5:00 PM", hour: 17, minute: 0 },
  { label: "7:00 PM", hour: 19, minute: 0 }
] as const;

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

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
  return startOfWeek(new Date(value.getFullYear(), value.getMonth(), 1));
}

export function isoDateKey(value: Date) {
  return startOfDay(value).toISOString().slice(0, 10);
}

export function monthLabel(value: Date) {
  return value.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric"
  });
}

export function formatAppointmentTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

export function formatTimeRange(start: string | Date, end: string | Date) {
  return `${new Date(start).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  })} - ${new Date(end).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  })}`;
}

function rangesOverlap(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && startB < endA;
}

export function usePropertyAppointmentScheduler({
  enabled,
  accessToken,
  appointmentAt,
  setAppointmentAt
}: {
  enabled: boolean;
  accessToken: string | null | undefined;
  appointmentAt: string;
  setAppointmentAt: (value: string) => void;
}) {
  const [appointmentSchedule, setAppointmentSchedule] = useState<AppointmentsResponse | null>(null);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [appointmentCalendarMonth, setAppointmentCalendarMonth] = useState<Date>(() => startOfDay(new Date()));
  const [googleCalendarStatus, setGoogleCalendarStatus] =
    useState<GoogleCalendarConnectionStatusResponse["item"] | null>(null);
  const [googleMonthBusy, setGoogleMonthBusy] = useState<GoogleCalendarConflictCheckResponse["busy"]>([]);
  const [loadingGoogleMonthBusy, setLoadingGoogleMonthBusy] = useState(false);
  const [googleBusyError, setGoogleBusyError] = useState<string | null>(null);

  useEffect(() => {
    if (!appointmentAt) {
      setAppointmentCalendarMonth(startOfDay(new Date()));
      return;
    }
    setAppointmentCalendarMonth(startOfDay(new Date(appointmentAt)));
  }, [appointmentAt]);

  useEffect(() => {
    if (!enabled || !accessToken) return;

    let cancelled = false;
    setLoadingSchedule(true);

    authFetch(accessToken, "/api/appointments")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as AppointmentsResponse;
      })
      .then((json) => {
        if (cancelled) return;
        setAppointmentSchedule(json);
      })
      .finally(() => {
        if (!cancelled) setLoadingSchedule(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, accessToken]);

  useEffect(() => {
    if (!enabled || !accessToken) return;

    let cancelled = false;

    authFetch(accessToken, "/api/integrations/google-calendar")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as GoogleCalendarConnectionStatusResponse;
      })
      .then((json) => {
        if (cancelled) return;
        setGoogleCalendarStatus(json?.item ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setGoogleCalendarStatus(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, accessToken]);

  useEffect(() => {
    if (!enabled || !accessToken || !googleCalendarStatus?.connected) {
      setGoogleMonthBusy([]);
      setLoadingGoogleMonthBusy(false);
      return;
    }

    let cancelled = false;
    const visibleStart = startOfMonthGrid(appointmentCalendarMonth);
    const visibleEnd = addDays(visibleStart, 35);

    setLoadingGoogleMonthBusy(true);
    setGoogleBusyError(null);

    authFetch(accessToken, "/api/integrations/google-calendar/freebusy", {
      method: "POST",
      body: JSON.stringify({
        startAt: visibleStart.toISOString(),
        endAt: visibleEnd.toISOString()
      })
    })
      .then(async (response) => {
        const json = (await response.json()) as GoogleCalendarConflictCheckResponse | { error?: string };
        if (!response.ok || !("busy" in json)) {
          throw new Error(("error" in json && json.error) || "Could not load Google Calendar availability.");
        }
        return json;
      })
      .then((json) => {
        if (cancelled) return;
        setGoogleMonthBusy(json.busy);
      })
      .catch((error) => {
        if (cancelled) return;
        setGoogleMonthBusy([]);
        setGoogleBusyError(error instanceof Error ? error.message : "Could not load Google Calendar availability.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingGoogleMonthBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, appointmentCalendarMonth, enabled, googleCalendarStatus?.connected]);

  const appointmentScheduleItemsByDay = useMemo(() => {
    const next = new Map<string, AppointmentsResponse["today"]>();
    for (const item of [
      ...(appointmentSchedule?.today ?? []),
      ...(appointmentSchedule?.upcoming ?? []),
      ...(appointmentSchedule?.pastDue ?? [])
    ]) {
      const key = isoDateKey(new Date(item.scheduledAt));
      const current = next.get(key) ?? [];
      current.push(item);
      next.set(key, current);
    }
    return next;
  }, [appointmentSchedule]);

  const upcomingScheduleItems = useMemo(
    () =>
      [...(appointmentSchedule?.today ?? []), ...(appointmentSchedule?.upcoming ?? [])]
        .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
        .slice(0, 5),
    [appointmentSchedule]
  );

  const selectedAppointmentDate = appointmentAt ? new Date(appointmentAt) : null;
  const selectedAppointmentDateKey = selectedAppointmentDate ? isoDateKey(selectedAppointmentDate) : null;
  const selectedDayScheduleItems = selectedAppointmentDateKey
    ? appointmentScheduleItemsByDay.get(selectedAppointmentDateKey) ?? []
    : [];

  const selectedDayLuminoBusy = useMemo(
    () =>
      selectedDayScheduleItems.map((item) => ({
        start: item.scheduledAt,
        end: new Date(new Date(item.scheduledAt).getTime() + DEFAULT_APPOINTMENT_DURATION_MINUTES * 60_000).toISOString()
      })),
    [selectedDayScheduleItems]
  );

  const googleBusyItemsByDay = useMemo(() => {
    const next = new Map<string, GoogleCalendarConflictCheckResponse["busy"]>();

    for (const item of googleMonthBusy) {
      const start = new Date(item.start);
      const end = new Date(item.end);
      for (let cursor = startOfDay(start); cursor < end; cursor = addDays(cursor, 1)) {
        const key = isoDateKey(cursor);
        const current = next.get(key) ?? [];
        current.push(item);
        next.set(key, current);
      }
    }

    return next;
  }, [googleMonthBusy]);

  const selectedDayGoogleBusy = selectedAppointmentDateKey ? googleBusyItemsByDay.get(selectedAppointmentDateKey) ?? [] : [];

  const selectedDayBusyWindows = useMemo(
    () =>
      [
        ...selectedDayLuminoBusy.map((slot) => ({ ...slot, source: "lumino" as const })),
        ...selectedDayGoogleBusy.map((slot) => ({ ...slot, source: "google" as const }))
      ].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    [selectedDayGoogleBusy, selectedDayLuminoBusy]
  );

  const quickTimeConflictMap = useMemo(() => {
    if (!selectedAppointmentDate) return new Map<string, boolean>();

    return new Map(
      APPOINTMENT_TIME_SLOTS.map((slot) => {
        const start = new Date(selectedAppointmentDate);
        start.setHours(slot.hour, slot.minute, 0, 0);
        const end = new Date(start.getTime() + DEFAULT_APPOINTMENT_DURATION_MINUTES * 60_000);
        const hasConflict = selectedDayBusyWindows.some((busySlot) =>
          rangesOverlap(start, end, new Date(busySlot.start), new Date(busySlot.end))
        );
        return [slot.label, hasConflict];
      })
    );
  }, [selectedAppointmentDate, selectedDayBusyWindows]);

  const selectedAppointmentConflict = useMemo(() => {
    if (!appointmentAt) {
      return { hasConflict: false, sources: [] as ("google" | "lumino")[] };
    }

    const start = new Date(appointmentAt);
    const end = new Date(start.getTime() + DEFAULT_APPOINTMENT_DURATION_MINUTES * 60_000);
    const conflicts = selectedDayBusyWindows.filter((slot) =>
      rangesOverlap(start, end, new Date(slot.start), new Date(slot.end))
    );

    return {
      hasConflict: conflicts.length > 0,
      sources: Array.from(new Set(conflicts.map((slot) => slot.source)))
    };
  }, [appointmentAt, selectedDayBusyWindows]);

  const openQuickTimes = useMemo(
    () =>
      APPOINTMENT_TIME_SLOTS.filter((slot) => !(quickTimeConflictMap.get(slot.label) ?? false)).map((slot) => slot.label),
    [quickTimeConflictMap]
  );

  const appointmentCalendarDays = useMemo(() => {
    const gridStart = startOfMonthGrid(appointmentCalendarMonth);
    const month = appointmentCalendarMonth.getMonth();
    const todayKey = isoDateKey(new Date());

    return Array.from({ length: 35 }, (_, index) => {
      const date = addDays(gridStart, index);
      const key = isoDateKey(date);
      return {
        date,
        key,
        isToday: key === todayKey,
        isCurrentMonth: date.getMonth() === month,
        isSelected: key === selectedAppointmentDateKey,
        items: appointmentScheduleItemsByDay.get(key) ?? [],
        googleBusy: googleBusyItemsByDay.get(key) ?? []
      };
    });
  }, [appointmentCalendarMonth, appointmentScheduleItemsByDay, googleBusyItemsByDay, selectedAppointmentDateKey]);

  function applyAppointmentDate(date: Date) {
    const next = new Date(date);
    if (selectedAppointmentDate) {
      next.setHours(selectedAppointmentDate.getHours(), selectedAppointmentDate.getMinutes(), 0, 0);
    } else {
      next.setHours(17, 0, 0, 0);
    }

    const offset = next.getTimezoneOffset();
    setAppointmentAt(new Date(next.getTime() - offset * 60_000).toISOString().slice(0, 16));
  }

  function applyAppointmentTime(hour: number, minute: number) {
    const base = selectedAppointmentDate ? new Date(selectedAppointmentDate) : new Date();
    base.setHours(hour, minute, 0, 0);
    const offset = base.getTimezoneOffset();
    setAppointmentAt(new Date(base.getTime() - offset * 60_000).toISOString().slice(0, 16));
  }

  return {
    appointmentSchedule,
    loadingSchedule,
    appointmentCalendarMonth,
    setAppointmentCalendarMonth,
    googleCalendarStatus,
    loadingGoogleMonthBusy,
    googleBusyError,
    selectedAppointmentDate,
    selectedDayScheduleItems,
    selectedDayGoogleBusy,
    selectedDayBusyWindows,
    selectedAppointmentConflict,
    upcomingScheduleItems,
    openQuickTimes,
    quickTimeConflictMap,
    appointmentCalendarDays,
    applyAppointmentDate,
    applyAppointmentTime
  };
}
