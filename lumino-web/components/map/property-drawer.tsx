"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeHelp,
  Ban,
  CalendarCheck2,
  Clock3,
  DoorOpen,
  FileBadge2,
  Handshake,
  PhoneCall,
  X,
  XCircle
} from "lucide-react";
import { GoogleCalendarSyncCard } from "@/components/appointments/google-calendar-sync-card";
import { DEFAULT_APPOINTMENT_DURATION_MINUTES } from "@/lib/appointments/calendar";
import { authFetch, useAuth } from "@/lib/auth/client";
import type {
  AppointmentsResponse,
  GoogleCalendarConflictCheckResponse,
  GoogleCalendarConnectionStatusResponse
} from "@/types/api";
import type { LeadInput, PropertyDetail, TaskInput } from "@/types/entities";

const quickOutcomes = [
  { label: "Not Home", value: "not_home", icon: DoorOpen },
  { label: "Left Doorhanger", value: "left_doorhanger", icon: FileBadge2 },
  { label: "Opportunity", value: "opportunity", icon: Handshake },
  { label: "Not Interested", value: "not_interested", icon: XCircle },
  { label: "Disqualified", value: "disqualified", icon: BadgeHelp },
  { label: "Appointment", value: "appointment_set", icon: CalendarCheck2 },
  { label: "Go Back", value: "callback_requested", icon: PhoneCall },
  { label: "Do Not Knock", value: "do_not_knock", icon: Ban }
];

const APPOINTMENT_TIME_SLOTS = [
  { label: "9:00 AM", hour: 9, minute: 0 },
  { label: "11:00 AM", hour: 11, minute: 0 },
  { label: "1:00 PM", hour: 13, minute: 0 },
  { label: "3:00 PM", hour: 15, minute: 0 },
  { label: "5:00 PM", hour: 17, minute: 0 },
  { label: "7:00 PM", hour: 19, minute: 0 }
] as const;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const GO_BACK_TIMING_OPTIONS = [
  { value: "default", label: "Use Default" },
  { value: "morning", label: "Morning" },
  { value: "evening", label: "Evening" },
  { value: "weekend", label: "Weekend" },
  { value: "specific", label: "Specific Note" }
] as const;

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

function isoDateKey(value: Date) {
  return startOfDay(value).toISOString().slice(0, 10);
}

function monthLabel(value: Date) {
  return value.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric"
  });
}

function formatAppointmentTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function rangesOverlap(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && startB < endA;
}

function EmptyPropertyState() {
  return (
    <div className="app-panel-soft rounded-3xl border border-dashed p-6 text-sm text-slate-500">
      Select a property to see memory, visit history, and quick actions.
    </div>
  );
}

export function PropertyDrawer({
  property,
  loading,
  savingVisit,
  onLogOutcome,
  onSaveLead,
  onCreateTask,
  onDismiss,
  onCloseDesktop,
  desktopVisible = true,
  isOpen = false,
  mobileOpenNonce = 0
}: {
  property: PropertyDetail | null;
  loading: boolean;
  savingVisit?: boolean;
  onLogOutcome: (outcome: string) => void;
  onSaveLead: (input: LeadInput) => Promise<void>;
  onCreateTask: (input: TaskInput) => Promise<void>;
  onDismiss?: () => void;
  onCloseDesktop?: () => void;
  desktopVisible?: boolean;
  isOpen?: boolean;
  mobileOpenNonce?: number;
}) {
  const { session, appContext, appBranding, organizationBranding } = useAuth();
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [mobileSection, setMobileSection] = useState<"actions" | "lead" | "history">("actions");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [leadStatus, setLeadStatus] = useState("New");
  const [interestLevel, setInterestLevel] = useState<"low" | "medium" | "high">("medium");
  const [nextFollowUpAt, setNextFollowUpAt] = useState("");
  const [appointmentAt, setAppointmentAt] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [postAction, setPostAction] = useState<string | null>(null);
  const [actionState, setActionState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [taskType, setTaskType] = useState<TaskInput["type"]>("custom");
  const [taskDueAt, setTaskDueAt] = useState("");
  const [taskNotes, setTaskNotes] = useState("");
  const [taskState, setTaskState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [appointmentSchedule, setAppointmentSchedule] = useState<AppointmentsResponse | null>(null);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [appointmentCalendarMonth, setAppointmentCalendarMonth] = useState<Date>(() => startOfDay(new Date()));
  const [googleCalendarStatus, setGoogleCalendarStatus] =
    useState<GoogleCalendarConnectionStatusResponse["item"] | null>(null);
  const [googleMonthBusy, setGoogleMonthBusy] = useState<GoogleCalendarConflictCheckResponse["busy"]>([]);
  const [loadingGoogleMonthBusy, setLoadingGoogleMonthBusy] = useState(false);
  const [googleBusyError, setGoogleBusyError] = useState<string | null>(null);
  const [goBackTiming, setGoBackTiming] =
    useState<(typeof GO_BACK_TIMING_OPTIONS)[number]["value"]>("default");
  const [goBackNote, setGoBackNote] = useState("");
  const [leadCaptureError, setLeadCaptureError] = useState<string | null>(null);
  const [appointmentLeadReady, setAppointmentLeadReady] = useState(false);
  const appointmentSchedulerRef = useRef<HTMLDivElement | null>(null);

  function toDateTimeLocal(value: string | null | undefined) {
    if (!value) return "";
    const date = new Date(value);
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
  }

  useEffect(() => {
    setFirstName(property?.firstName ?? "");
    setLastName(property?.lastName ?? "");
    setPhone(property?.phone ?? "");
    setEmail(property?.email ?? "");
    setNotes(property?.leadNotes ?? "");
    setLeadStatus(property?.leadStatus ?? "New");
    setInterestLevel("medium");
    setNextFollowUpAt(toDateTimeLocal(property?.leadNextFollowUpAt));
    setAppointmentAt(toDateTimeLocal(property?.appointmentAt));
    setSaveState("idle");
    setPostAction(null);
    setActionState("idle");
    setTaskType("custom");
    setTaskDueAt("");
    setTaskNotes("");
    setTaskState("idle");
    setMobileSection(property?.leadId ? "lead" : "actions");
    if (property?.isPreview) {
      setMobileExpanded(true);
    }
    setGoBackTiming("default");
    setGoBackNote("");
    setLeadCaptureError(null);
    setAppointmentLeadReady(Boolean(property?.leadId));
    setGoogleBusyError(null);
  }, [property]);

  useEffect(() => {
    if (!appointmentAt) {
      setAppointmentCalendarMonth(startOfDay(new Date()));
      return;
    }
    setAppointmentCalendarMonth(startOfDay(new Date(appointmentAt)));
  }, [appointmentAt]);

  useEffect(() => {
    if (!isOpen) return;
    setMobileExpanded(true);
  }, [isOpen, mobileOpenNonce]);

  useEffect(() => {
    if (postAction !== "appointment_set" || !session?.access_token) return;

    let cancelled = false;
    setLoadingSchedule(true);

    authFetch(session.access_token, "/api/appointments")
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
  }, [postAction, session?.access_token]);

  useEffect(() => {
    if (postAction !== "appointment_set" || !session?.access_token) return;

    let cancelled = false;

    authFetch(session.access_token, "/api/integrations/google-calendar")
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
  }, [postAction, session?.access_token]);

  useEffect(() => {
    if (postAction !== "appointment_set" || !session?.access_token || !googleCalendarStatus?.connected) {
      setGoogleMonthBusy([]);
      setLoadingGoogleMonthBusy(false);
      return;
    }

    let cancelled = false;
    const visibleStart = startOfMonthGrid(appointmentCalendarMonth);
    const visibleEnd = addDays(visibleStart, 35);

    setLoadingGoogleMonthBusy(true);
    setGoogleBusyError(null);

    authFetch(session.access_token, "/api/integrations/google-calendar/freebusy", {
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
  }, [appointmentCalendarMonth, googleCalendarStatus?.connected, postAction, session?.access_token]);

  const showActions = mobileSection === "actions";
  const showLead = mobileSection === "lead";
  const showHistory = mobileSection === "history";
  const appointmentScheduleItemsByDay = useMemo(() => {
    const next = new Map<string, AppointmentsResponse["today"]>();
    for (const item of [...(appointmentSchedule?.today ?? []), ...(appointmentSchedule?.upcoming ?? []), ...(appointmentSchedule?.pastDue ?? [])]) {
      const key = isoDateKey(new Date(item.scheduledAt));
      const current = next.get(key) ?? [];
      current.push(item);
      next.set(key, current);
    }
    return next;
  }, [appointmentSchedule]);
  const upcomingScheduleItems = useMemo(
    () => [
      ...(appointmentSchedule?.today ?? []),
      ...(appointmentSchedule?.upcoming ?? [])
    ]
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
      .slice(0, 5),
    [appointmentSchedule]
  );
  const selectedAppointmentDate = appointmentAt ? new Date(appointmentAt) : null;
  const selectedAppointmentDateKey = selectedAppointmentDate ? isoDateKey(selectedAppointmentDate) : null;
  const selectedDayScheduleItems = selectedAppointmentDateKey
    ? appointmentScheduleItemsByDay.get(selectedAppointmentDateKey) ?? []
    : [];
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
  const quickTimeConflictMap = useMemo(() => {
    if (!selectedAppointmentDate) return new Map<string, boolean>();

    return new Map(
      APPOINTMENT_TIME_SLOTS.map((slot) => {
        const start = new Date(selectedAppointmentDate);
        start.setHours(slot.hour, slot.minute, 0, 0);
        const end = new Date(start.getTime() + DEFAULT_APPOINTMENT_DURATION_MINUTES * 60_000);
        const hasConflict = selectedDayGoogleBusy.some((busySlot) =>
          rangesOverlap(start, end, new Date(busySlot.start), new Date(busySlot.end))
        );
        return [slot.label, hasConflict];
      })
    );
  }, [selectedAppointmentDate, selectedDayGoogleBusy]);
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

  const isOutcomeFlow = postAction === "opportunity" || postAction === "appointment_set";
  const hasHomeownerInfo = Boolean(firstName.trim() || lastName.trim() || phone.trim() || email.trim());
  const repName = appContext?.appUser.fullName?.trim() || "your Lumino rep";
  const brandName = organizationBranding?.appName || appBranding?.appName || "Lumino";

  function closePreview() {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches) {
      onCloseDesktop?.();
      return;
    }
    onDismiss?.();
  }

  function buildGoBackBestContactTime() {
    if (goBackTiming === "default") return null;
    if (goBackTiming === "specific") return goBackNote.trim() || null;
    return goBackTiming;
  }

  function openPrefilledThankYouText() {
    const destination = phone.trim();
    if (!destination || typeof window === "undefined") return;

    const homeownerName = firstName.trim() || "there";
    const body = `Hi ${homeownerName}, this is ${repName} with ${brandName}. Thanks for taking a minute to speak with me today. This is my number if any questions come up. Happy to help whenever it makes sense.`;
    window.location.href = `sms:${destination}?&body=${encodeURIComponent(body)}`;
  }

  function openPrefilledAppointmentConfirmationText() {
    const destination = phone.trim();
    if (!destination || !appointmentAt || typeof window === "undefined") return;

    const homeownerName = firstName.trim() || "there";
    const scheduledTime = new Date(appointmentAt).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
    const body = `Hi ${homeownerName}, this is ${repName} with ${brandName}. Thanks again for setting time with me. We're confirmed for ${scheduledTime}. If anything changes, feel free to reply here.`;
    window.location.href = `sms:${destination}?&body=${encodeURIComponent(body)}`;
  }

  async function handleInstantOutcome(outcome: string) {
    if (!property) return;
    setActionState("saving");
    try {
      if (property.leadId && ["not_interested", "do_not_knock", "disqualified"].includes(outcome)) {
        await onSaveLead({
          propertyId: property.propertyId,
          firstName,
          lastName,
          phone,
          email,
          notes,
          leadStatus: "Closed Lost",
          interestLevel,
          nextFollowUpAt: null
        });
      }
      await onLogOutcome(outcome);
      setActionState("saved");
      closePreview();
    } catch {
      setActionState("error");
    }
  }

  async function handleGoBackSave() {
    if (!property) return;
    setActionState("saving");
    try {
      await onSaveLead({
        propertyId: property.propertyId,
        firstName,
        lastName,
        phone,
        email,
        notes,
        leadStatus: "Attempting Contact",
        interestLevel,
        bestContactTime: buildGoBackBestContactTime(),
        preferredChannel: "door",
        cadenceTrack: "warm_no_contact",
        nextFollowUpAt: null
      });
      await onLogOutcome("callback_requested");
      setActionState("saved");
      closePreview();
    } catch {
      setActionState("error");
    }
  }

  async function handleLeadCaptureSubmit() {
    if (!property) return;
    if (isOutcomeFlow && !hasHomeownerInfo) {
      setLeadCaptureError("Add at least a name, phone, or email before moving this outcome forward.");
      setSaveState("error");
      return;
    }

    setLeadCaptureError(null);
    setSaveState("saving");

    if (postAction === "appointment_set") {
      try {
        await onSaveLead({
          propertyId: property.propertyId,
          firstName,
          lastName,
          phone,
          email,
          notes,
          leadStatus: "Connected",
          interestLevel,
          preferredChannel: phone.trim() ? "text" : "door",
          textConsent: phone.trim() ? true : null,
          nextFollowUpAt: null
        });
        setAppointmentLeadReady(true);
        setSaveState("saved");
        setMobileSection("actions");
        if (typeof window !== "undefined") {
          window.requestAnimationFrame(() => {
            appointmentSchedulerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }
        return;
      } catch {
        setSaveState("error");
        return;
      }
    }

    try {
      await onSaveLead({
        propertyId: property.propertyId,
        firstName,
        lastName,
        phone,
        email,
        notes,
        leadStatus: postAction === "opportunity" ? "Connected" : leadStatus,
        interestLevel,
        preferredChannel: phone.trim() ? "text" : "door",
        textConsent: phone.trim() ? true : null,
        nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt).toISOString() : null
      });

      if (postAction === "opportunity") {
        await onLogOutcome("opportunity");
        if (phone.trim()) {
          openPrefilledThankYouText();
        }
        setSaveState("saved");
        closePreview();
        return;
      }

      setSaveState("saved");
      setMobileSection("history");
      onDismiss?.();
    } catch {
      setSaveState("error");
    }
  }

  function handleOutcomeTap(outcome: string) {
    setMobileSection(outcome === "opportunity" || outcome === "appointment_set" ? "lead" : "actions");
    setPostAction(outcome);
    setActionState("idle");
    setSaveState("idle");
    setLeadCaptureError(null);

    if (outcome === "opportunity") {
      setLeadStatus("Connected");
      return;
    }
    if (outcome === "appointment_set") {
      setLeadStatus(property?.leadStatus ?? "Connected");
      setAppointmentLeadReady(Boolean(property?.leadId));
      return;
    }
    if (outcome === "callback_requested") {
      setLeadStatus("Attempting Contact");
      return;
    }

    void handleInstantOutcome(outcome);
  }

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

  const content = loading ? (
    <div className="app-panel rounded-3xl border p-5">
      <div className="text-sm text-slate-500">Loading property memory…</div>
    </div>
  ) : !property ? (
    <EmptyPropertyState />
  ) : (
    <div className="app-panel rounded-3xl border p-5">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Property Memory</div>
        <h2 className="mt-2 text-xl font-semibold text-ink">{property.address}</h2>
        <div className="mt-2 text-sm text-slate-600">
          {property.mapState} · {property.visitCount} visits · follow-up {property.followUpState}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
          <div>
            <div className="font-semibold text-slate-800">Last outcome</div>
            <div className="mt-1">{property.lastVisitOutcome ?? "No field history yet"}</div>
          </div>
          <div>
            <div className="font-semibold text-slate-800">Last visited</div>
            <div className="mt-1">{property.lastVisitedAt ? new Date(property.lastVisitedAt).toLocaleString() : "Never"}</div>
          </div>
          <div>
            <div className="font-semibold text-slate-800">Not Home tries</div>
            <div className="mt-1">{property.notHomeCount}</div>
          </div>
          <div>
            <div className="font-semibold text-slate-800">Lead state</div>
            <div className="mt-1">{property.leadStatus ?? "No active lead"}</div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-4 gap-2">
          {quickOutcomes.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => handleOutcomeTap(item.value)}
              disabled={savingVisit || actionState === "saving"}
              title={item.label}
              aria-label={item.label}
              className="flex aspect-square items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-950 hover:text-white"
            >
              <item.icon className="h-5 w-5" />
            </button>
          ))}
        </div>

        <div className="mt-4 xl:hidden">
          <div className="grid grid-cols-3 gap-2 rounded-[1.4rem] bg-slate-100 p-1">
            {[
              { key: "actions", label: "Actions" },
              { key: "lead", label: "Lead" },
              { key: "history", label: "History" }
            ].map((tab) => {
              const active = mobileSection === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setMobileSection(tab.key as "actions" | "lead" | "history")}
                  className={`rounded-[1.1rem] px-3 py-2 text-sm font-semibold transition ${
                    active ? "bg-white text-ink shadow-sm" : "text-slate-500"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className={showActions ? "mt-5 xl:mt-5" : "mt-5 hidden xl:block"}>
        {postAction === "callback_requested" ? (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Clock3 className="h-4 w-4" />
              Schedule go-back
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Use this when you want to return later, especially if you did not capture homeowner info yet.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {GO_BACK_TIMING_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setGoBackTiming(option.value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    goBackTiming === option.value
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {goBackTiming === "specific" ? (
              <textarea
                value={goBackNote}
                onChange={(event) => setGoBackNote(event.target.value)}
                rows={3}
                placeholder="Next week, mornings only, when wife is home…"
                className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              />
            ) : null}
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                {actionState === "saved"
                  ? "Go-back saved."
                  : actionState === "error"
                    ? "Could not save go-back."
                    : "Default cadence will be used unless you override it here."}
              </div>
              <button
                type="button"
                onClick={() => void handleGoBackSave()}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-ink shadow-sm ring-1 ring-slate-200"
              >
                {actionState === "saving" ? "Saving..." : "Save Go-Back"}
              </button>
            </div>
          </div>
        ) : null}

        {postAction === "appointment_set" ? (
          <div ref={appointmentSchedulerRef} className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <CalendarCheck2 className="h-4 w-4" />
              Capture appointment
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {appointmentLeadReady
                ? "Lock in the actual appointment time so the CRM stays trustworthy."
                : "Enter homeowner info first, then the scheduler unlocks right here."}
            </p>
            {!appointmentLeadReady ? (
              <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-4 text-sm text-slate-600">
                Save the homeowner info below first. As soon as that is done, this scheduler will unlock and you can pick the appointment without jumping around.
              </div>
            ) : (
            <div className="mt-3 space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">Mini Calendar</div>
                  <div className="mt-1 text-sm font-semibold text-ink">Pick the day first, then choose a time</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setAppointmentCalendarMonth(
                        new Date(appointmentCalendarMonth.getFullYear(), appointmentCalendarMonth.getMonth() - 1, 1)
                      )
                    }
                    className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300"
                  >
                    Prev
                  </button>
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {monthLabel(appointmentCalendarMonth)}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setAppointmentCalendarMonth(
                        new Date(appointmentCalendarMonth.getFullYear(), appointmentCalendarMonth.getMonth() + 1, 1)
                      )
                    }
                    className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300"
                  >
                    Next
                  </button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label}>{label}</div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-7 gap-1">
                {appointmentCalendarDays.map((day) => (
                  <button
                    key={day.key}
                    type="button"
                    onClick={() => applyAppointmentDate(day.date)}
                    className={`rounded-xl border px-1 py-2 text-center text-xs transition ${
                      day.isSelected
                        ? "border-slate-900 bg-slate-900 text-white"
                        : day.googleBusy.length >= 3
                          ? "border-rose-200 bg-rose-50 text-rose-800"
                          : day.googleBusy.length
                            ? "border-amber-200 bg-amber-50 text-slate-700"
                            : day.items.length
                              ? "border-sky-200 bg-sky-50 text-slate-700"
                              : "border-slate-200 bg-slate-50 text-slate-700"
                    } ${day.isCurrentMonth ? "" : "opacity-45"} ${day.isToday ? "ring-1 ring-sky-400" : ""}`}
                  >
                    <div className="font-semibold">{day.date.getDate()}</div>
                    <div className="mt-1 text-[10px]">
                      {day.googleBusy.length
                        ? `${day.googleBusy.length} busy`
                        : day.items.length
                          ? `${day.items.length} appt`
                          : "Open"}
                    </div>
                  </button>
                ))}
              </div>
              {googleCalendarStatus?.connected ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  <span className="rounded-full bg-slate-100 px-2 py-1">Gray: open</span>
                  <span className="rounded-full bg-sky-100 px-2 py-1">Blue: Lumino appts</span>
                  <span className="rounded-full bg-amber-100 px-2 py-1">Amber: some Google busy</span>
                  <span className="rounded-full bg-rose-100 px-2 py-1">Rose: packed day</span>
                </div>
              ) : null}
              <div className="mt-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">Quick Times</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {APPOINTMENT_TIME_SLOTS.map((slot) => {
                    const isSelected =
                      selectedAppointmentDate?.getHours() === slot.hour &&
                      selectedAppointmentDate?.getMinutes() === slot.minute;
                    const hasGoogleConflict = quickTimeConflictMap.get(slot.label) ?? false;
                    return (
                      <button
                        key={slot.label}
                        type="button"
                        onClick={() => applyAppointmentTime(slot.hour, slot.minute)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                          isSelected
                            ? "border-slate-900 bg-slate-900 text-white"
                            : hasGoogleConflict
                              ? "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300"
                            : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300"
                        }`}
                      >
                        {slot.label}
                        {hasGoogleConflict ? " • Busy" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
              <input
                type="datetime-local"
                value={appointmentAt}
                onChange={(event) => setAppointmentAt(event.target.value)}
                className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              />
              <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">Selected Day</div>
                    <div className="mt-1 text-sm font-semibold text-ink">
                      {selectedAppointmentDate
                        ? selectedAppointmentDate.toLocaleDateString(undefined, {
                            weekday: "long",
                            month: "long",
                            day: "numeric"
                          })
                        : "Choose a day"}
                    </div>
                  </div>
                  <Link
                    href="/appointments"
                    className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300"
                  >
                    Full calendar
                  </Link>
                </div>
                <div className="mt-3 space-y-2">
                  {loadingSchedule || loadingGoogleMonthBusy ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
                      Loading your current appointments and Google availability…
                    </div>
                  ) : googleBusyError ? (
                    <div className="rounded-2xl border border-dashed border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-700">
                      {googleBusyError}
                    </div>
                  ) : selectedDayScheduleItems.length ? (
                    selectedDayScheduleItems.map((item) => (
                      <div key={item.leadId} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-ink">{item.address}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {[item.city, item.state].filter(Boolean).join(", ") || "Unknown area"}
                            </div>
                          </div>
                          <div className="shrink-0 text-right text-xs font-semibold text-slate-600">
                            {formatAppointmentTime(item.scheduledAt)}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : selectedDayGoogleBusy.length ? (
                    selectedDayGoogleBusy.map((item) => (
                      <div
                        key={`${item.start}-${item.end}`}
                        className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900"
                      >
                        <div className="font-semibold">Google calendar busy</div>
                        <div className="mt-1 text-xs">
                          {new Date(item.start).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit"
                          })}{" "}
                          -{" "}
                          {new Date(item.end).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit"
                          })}
                        </div>
                      </div>
                    ))
                  ) : upcomingScheduleItems.length ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
                      This day looks open. Nearby upcoming appointments are still listed in the full calendar.
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
                      No other appointments are on the schedule right now.
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div>
              <GoogleCalendarSyncCard appointmentAt={appointmentAt || null} returnTo="/map" compact />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                {actionState === "saved"
                  ? phone.trim()
                    ? "Appointment saved and ready to confirm by text."
                    : "Appointment saved."
                  : actionState === "error"
                    ? "Could not save appointment."
                    : "This also updates the property icon and lead stage."}
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!property) return;
                  if (!appointmentAt) {
                    setActionState("error");
                    setLeadCaptureError("Pick a date and time before saving the appointment.");
                    return;
                  }
                  setLeadCaptureError(null);
                  setActionState("saving");
                  try {
                    await onSaveLead({
                      propertyId: property.propertyId,
                      firstName,
                      lastName,
                      phone,
                      email,
                      notes,
                      leadStatus: "Appointment Set",
                      interestLevel,
                      preferredChannel: phone.trim() ? "text" : "door",
                      textConsent: phone.trim() ? true : null,
                      appointmentAt: new Date(appointmentAt).toISOString(),
                      nextFollowUpAt: new Date(appointmentAt).toISOString()
                    });
                    await onLogOutcome("appointment_set");
                    setActionState("saved");
                    if (phone.trim()) {
                      openPrefilledAppointmentConfirmationText();
                    }
                  } catch {
                    setActionState("error");
                  }
                }}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-ink shadow-sm ring-1 ring-slate-200"
              >
                {actionState === "saving" ? "Saving..." : "Save Appointment"}
              </button>
            </div>
            </div>
            )}
          </div>
        ) : null}

        <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          <div>Lead status: {property.leadStatus ?? "No active lead"}</div>
          <div className="mt-1">Last visit outcome: {property.lastVisitOutcome ?? "No field history yet"}</div>
          <div className="mt-1">Last visited: {property.lastVisitedAt ? new Date(property.lastVisitedAt).toLocaleString() : "Never"}</div>
          <div className="mt-3">
            <Link
              href={`/properties/${property.propertyId}`}
              className="text-sm font-semibold text-ink underline decoration-slate-300 underline-offset-4 transition hover:text-slate-700"
            >
              Open full property page
            </Link>
          </div>
        </div>
        </div>

        <div className={showLead ? "mt-6 xl:mt-6" : "mt-6 hidden xl:block"}>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Contact</div>
          <div className="mt-2 space-y-1 text-sm text-slate-600">
            <div>{property.phone || "No phone yet"}</div>
            <div>{property.email || "No email yet"}</div>
          </div>
        </div>

        <form
          className="mt-6 rounded-3xl border border-slate-200 bg-white p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            await handleLeadCaptureSubmit();
          }}
        >
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">
            {postAction === "opportunity"
              ? "Opportunity Capture"
              : postAction === "appointment_set"
                ? "Homeowner Details"
                : "Lead Capture"}
          </div>
          {postAction === "opportunity" ? (
            <div className="mt-2 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-3 text-xs text-sky-800">
              Capture the homeowner info first. When you save, Lumino will start follow-up and open a prefilled thank-you text if a phone number is present.
            </div>
          ) : null}
          {postAction === "appointment_set" ? (
            <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
              Save homeowner info first. The appointment scheduler will unlock above and scroll into view automatically.
            </div>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-500">
              First name
              <input
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              />
            </label>
            <label className="text-xs text-slate-500">
              Last name
              <input
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              />
            </label>
            <label className="col-span-2 text-xs text-slate-500">
              Phone
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              />
            </label>
            <label className="col-span-2 text-xs text-slate-500">
              Email
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              />
            </label>
            <label className="text-xs text-slate-500">
              Lead stage
              <select
                value={leadStatus}
                onChange={(event) => setLeadStatus(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              >
                {["New", "Attempting Contact", "Connected", "Nurture", "Appointment Set", "Qualified"].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Interest
              <select
                value={interestLevel}
                onChange={(event) => setInterestLevel(event.target.value as "low" | "medium" | "high")}
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            {!isOutcomeFlow ? (
              <label className="col-span-2 text-xs text-slate-500">
                Next follow-up
                <input
                  type="datetime-local"
                  value={nextFollowUpAt}
                  onChange={(event) => setNextFollowUpAt(event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
                />
              </label>
            ) : null}
            <label className="col-span-2 text-xs text-slate-500">
              Notes
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={4}
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              />
            </label>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              {leadCaptureError
                ? leadCaptureError
                : saveState === "saved"
                  ? postAction === "appointment_set"
                    ? "Homeowner info captured. Appointment scheduler unlocked."
                    : "Lead saved."
                : saveState === "error"
                  ? "Save failed. Try again."
                  : "Capture homeowner details right from the map."}
            </div>
            <button
              type="submit"
              disabled={saveState === "saving"}
              className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saveState === "saving"
                ? "Saving..."
                : postAction === "opportunity"
                  ? "Create Opportunity"
                  : postAction === "appointment_set"
                    ? "Continue to Appointment"
                    : property.leadId
                      ? "Update Lead"
                      : "Create Lead"}
            </button>
          </div>
        </form>

        <form
          className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!property) return;
            setTaskState("saving");
            try {
              await onCreateTask({
                propertyId: property.propertyId,
                leadId: property.leadId,
                type: taskType,
                dueAt: taskDueAt ? new Date(taskDueAt).toISOString() : null,
                notes: taskNotes || null
              });
              setTaskState("saved");
              setTaskDueAt("");
              setTaskNotes("");
              setTaskType("custom");
              setMobileSection("history");
            } catch {
              setTaskState("error");
            }
          }}
        >
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Quick Task</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs text-slate-500">
              Task type
              <select
                value={taskType}
                onChange={(event) => setTaskType(event.target.value as TaskInput["type"])}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              >
                <option value="custom">Custom</option>
                <option value="call">Call</option>
                <option value="text">Text</option>
                <option value="revisit">Revisit</option>
                <option value="appointment_confirm">Appointment Confirm</option>
                <option value="proposal_follow_up">Proposal Follow-Up</option>
                <option value="rebook_appointment">Rebook Appointment</option>
                <option value="customer_check_in">Customer Check-In</option>
                <option value="referral_request">Referral Request</option>
                <option value="manager_review">Manager Review</option>
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Due at
              <input
                type="datetime-local"
                value={taskDueAt}
                onChange={(event) => setTaskDueAt(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              />
            </label>
            <label className="text-xs text-slate-500 md:col-span-2">
              Notes
              <textarea
                value={taskNotes}
                onChange={(event) => setTaskNotes(event.target.value)}
                rows={3}
                placeholder="What should happen next?"
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              />
            </label>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              {taskState === "saved"
                ? "Task created."
                : taskState === "error"
                  ? "Task save failed."
                  : "Add a manual follow-up without leaving the map."}
            </div>
            <button
              type="submit"
              disabled={taskState === "saving"}
              className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-ink shadow-sm ring-1 ring-slate-200"
            >
              {taskState === "saving" ? "Saving..." : "Add Task"}
            </button>
          </div>
        </form>
        </div>

        <div className={showHistory ? "mt-6 xl:mt-6" : "mt-6 hidden xl:block"}>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Recent Visits</div>
          <div className="mt-3 space-y-3">
            {property.recentVisits.length ? (
              property.recentVisits.slice(0, 4).map((visit) => (
                <div key={visit.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="font-medium text-ink">{visit.outcome}</div>
                  <div className="mt-1 text-xs text-slate-500">{new Date(visit.capturedAt).toLocaleString()}</div>
                  {visit.notes ? <div className="mt-2 text-slate-600">{visit.notes}</div> : null}
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 p-3 text-sm text-slate-500">
                No structured visits yet.
              </div>
            )}
          </div>
        </div>

        <div className="mt-6">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Timeline</div>
          <div className="mt-3 space-y-3">
            {property.recentActivities.length ? (
              property.recentActivities.slice(0, 4).map((activity) => (
                <div key={activity.id} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
                  <div className="font-medium text-ink">{activity.type}</div>
                  <div className="mt-1 text-xs text-slate-500">{new Date(activity.createdAt).toLocaleString()}</div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 p-3 text-sm text-slate-500">
                No property activity has been logged yet.
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
  );

  return (
    <>
      <aside className={`relative z-20 hidden w-[28rem] shrink-0 border-l border-slate-200/80 bg-white/80 p-5 backdrop-blur ${desktopVisible ? "xl:block" : "xl:hidden"}`}>
        {(property || loading) && onCloseDesktop ? (
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={onCloseDesktop}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              aria-label="Hide property details"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        {content}
      </aside>

      {isOpen ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 p-3 xl:hidden">
          {mobileExpanded ? (
            <div className="pointer-events-auto mx-auto max-h-[82vh] max-w-md overflow-y-auto rounded-[1.75rem] border border-slate-200 bg-white/95 p-4 shadow-2xl backdrop-blur sm:max-h-[76vh]">
              <div className="mb-3 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setMobileExpanded(false)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600"
                >
                  Collapse
                </button>
                <div className="h-1.5 w-14 rounded-full bg-slate-300" />
                {property && !loading ? (
                  <button
                    type="button"
                    onClick={() => onDismiss?.()}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600"
                    aria-label="Hide property panel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <div className="w-[3.5rem]" />
                )}
              </div>
              {content}
            </div>
          ) : (
            <div className="pointer-events-auto mx-auto flex w-full max-w-md items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileExpanded(true)}
                className="flex min-w-0 flex-1 items-center justify-between rounded-[1.25rem] border border-slate-200 bg-white/95 px-4 py-3 text-left shadow-2xl backdrop-blur"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink">{property?.address ?? "Selected property"}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {property?.lastVisitOutcome ?? property?.leadStatus ?? "Tap to open property actions"}
                  </div>
                </div>
                <div className="ml-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Open</div>
              </button>
              <button
                type="button"
                onClick={() => onDismiss?.()}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-600 shadow-2xl backdrop-blur"
                aria-label="Hide property panel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
