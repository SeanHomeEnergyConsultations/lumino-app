"use client";

import Link from "next/link";
import type { RefObject } from "react";
import { CalendarCheck2 } from "lucide-react";
import { GoogleCalendarSyncCard } from "@/components/appointments/google-calendar-sync-card";
import { formatDateTime } from "@/lib/format/date";
import {
  APPOINTMENT_TIME_SLOTS,
  formatAppointmentTime,
  formatTimeRange,
  monthLabel,
  WEEKDAY_LABELS
} from "@/components/map/use-property-appointment-scheduler";
import type { AppointmentsResponse, GoogleCalendarConflictCheckResponse } from "@/types/api";
import type { LeadInput, PropertyDetail, TaskInput } from "@/types/entities";

export const drawerFieldClassName =
  "app-focus-ring mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink";

interface AppointmentCalendarDay {
  date: Date;
  key: string;
  isToday: boolean;
  isCurrentMonth: boolean;
  isSelected: boolean;
  items: AppointmentsResponse["today"];
  googleBusy: GoogleCalendarConflictCheckResponse["busy"];
}

export function PropertyDrawerAppointmentSection({
  property,
  appointmentSchedulerRef,
  appointmentLeadReady,
  appointmentAt,
  setAppointmentAt,
  loadingSchedule,
  appointmentCalendarMonth,
  setAppointmentCalendarMonth,
  googleCalendarConnected,
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
  applyAppointmentTime,
  actionState,
  phone,
  onSaveAppointment
}: {
  property: PropertyDetail;
  appointmentSchedulerRef: RefObject<HTMLDivElement | null>;
  appointmentLeadReady: boolean;
  appointmentAt: string;
  setAppointmentAt: (value: string) => void;
  loadingSchedule: boolean;
  appointmentCalendarMonth: Date;
  setAppointmentCalendarMonth: (value: Date) => void;
  googleCalendarConnected: boolean;
  loadingGoogleMonthBusy: boolean;
  googleBusyError: string | null;
  selectedAppointmentDate: Date | null;
  selectedDayScheduleItems: AppointmentsResponse["today"];
  selectedDayGoogleBusy: GoogleCalendarConflictCheckResponse["busy"];
  selectedDayBusyWindows: Array<{
    start: string;
    end: string;
    source: "google" | "lumino";
  }>;
  selectedAppointmentConflict: {
    hasConflict: boolean;
    sources: Array<"google" | "lumino">;
  };
  upcomingScheduleItems: AppointmentsResponse["today"];
  openQuickTimes: string[];
  quickTimeConflictMap: Map<string, boolean>;
  appointmentCalendarDays: AppointmentCalendarDay[];
  applyAppointmentDate: (value: Date) => void;
  applyAppointmentTime: (hour: number, minute: number) => void;
  actionState: "idle" | "saving" | "saved" | "error";
  phone: string;
  onSaveAppointment: () => Promise<void>;
}) {
  return (
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
          Save the homeowner info below first. As soon as that is done, this scheduler will unlock and you can pick the
          appointment without jumping around.
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
                  className="app-focus-button rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300"
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
                  className="app-focus-button rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300"
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
                  className={`app-focus-button rounded-xl border px-1 py-2 text-center text-xs transition ${
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
                    {day.googleBusy.length ? `${day.googleBusy.length} busy` : day.items.length ? `${day.items.length} appt` : "Open"}
                  </div>
                </button>
              ))}
            </div>
            {googleCalendarConnected ? (
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
                      className={`app-focus-button rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        isSelected
                          ? "border-slate-900 bg-slate-900 text-white"
                          : hasGoogleConflict
                            ? "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300"
                            : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300"
                      }`}
                    >
                      {slot.label}
                      {hasGoogleConflict ? " • Busy" : " • Open"}
                    </button>
                  );
                })}
              </div>
            </div>
            <input
              type="datetime-local"
              value={appointmentAt}
              onChange={(event) => setAppointmentAt(event.target.value)}
              className={drawerFieldClassName}
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
                  className="app-focus-button rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300"
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
                      <div className="mt-1 text-xs">{formatTimeRange(item.start, item.end)}</div>
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
                {selectedDayBusyWindows.length ? (
                  <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-600">
                    <div className="font-semibold text-ink">Busy windows</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedDayBusyWindows.map((slot) => (
                        <span
                          key={`${slot.source}-${slot.start}-${slot.end}`}
                          className={`rounded-full px-2.5 py-1 ${
                            slot.source === "google" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"
                          }`}
                        >
                          {slot.source === "google" ? "Google" : "Lumino"} {formatTimeRange(slot.start, slot.end)}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {appointmentAt ? (
                  <div
                    className={`rounded-2xl px-3 py-3 text-sm ${
                      selectedAppointmentConflict.hasConflict
                        ? "border border-rose-200 bg-rose-50 text-rose-800"
                        : "border border-emerald-200 bg-emerald-50 text-emerald-800"
                    }`}
                  >
                    <div className="font-semibold">
                      {selectedAppointmentConflict.hasConflict
                        ? `${formatAppointmentTime(appointmentAt)} conflicts with an existing block`
                        : `${formatAppointmentTime(appointmentAt)} looks open`}
                    </div>
                    <div className="mt-1 text-xs">
                      {selectedAppointmentConflict.hasConflict
                        ? "Pick one of the open quick times below or choose another slot in the datetime picker."
                        : openQuickTimes.length
                          ? `Best open times today: ${openQuickTimes.join(", ")}`
                          : "This is the best currently visible opening on the selected day."}
                    </div>
                  </div>
                ) : openQuickTimes.length ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                    <div className="font-semibold">Best open times today</div>
                    <div className="mt-1 text-xs">{openQuickTimes.join(", ")}</div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <GoogleCalendarSyncCard appointmentAt={appointmentAt || null} returnTo="/map" compact manualConflictCheck={false} />
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              {actionState === "saved"
                ? phone.trim()
                  ? "Appointment saved and ready to confirm by text."
                  : "Appointment saved."
                : !appointmentAt
                  ? "Pick a date and time to save the appointment."
                  : selectedAppointmentConflict.hasConflict
                    ? `That time conflicts with ${
                        selectedAppointmentConflict.sources.includes("google") &&
                        selectedAppointmentConflict.sources.includes("lumino")
                          ? "Google and Lumino"
                          : selectedAppointmentConflict.sources.includes("google")
                            ? "Google"
                            : "Lumino"
                      } calendar activity.`
                    : actionState === "error"
                      ? "Could not save appointment."
                      : "Selected time looks open and ready to save."}
            </div>
            <button
              type="button"
              onClick={() => void onSaveAppointment()}
              disabled={!appointmentAt || selectedAppointmentConflict.hasConflict || actionState === "saving"}
              className="app-focus-button rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-ink shadow-sm ring-1 ring-slate-200"
            >
              {actionState === "saving"
                ? "Saving..."
                : !appointmentAt
                  ? "Pick a Time"
                  : selectedAppointmentConflict.hasConflict
                    ? "Pick Another Time"
                    : "Save Appointment"}
            </button>
          </div>
        </div>
      )}
      <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
        <div>Lead status: {property.leadStatus ?? "No active lead"}</div>
        <div className="mt-1">Last visit outcome: {property.lastVisitOutcome ?? "No field history yet"}</div>
        <div className="mt-1">Last visited: {formatDateTime(property.lastVisitedAt, null) ?? "Never"}</div>
        <div className="mt-3">
          <Link
            href={`/properties/${property.propertyId}`}
            className="font-semibold text-ink underline decoration-slate-300 underline-offset-4 transition hover:text-slate-700"
          >
            Open full property page
          </Link>
        </div>
      </div>
    </div>
  );
}

export function PropertyDrawerLeadForm({
  property,
  postAction,
  isOutcomeFlow,
  leadCaptureError,
  saveState,
  firstName,
  setFirstName,
  lastName,
  setLastName,
  phone,
  setPhone,
  email,
  setEmail,
  leadStatus,
  setLeadStatus,
  interestLevel,
  setInterestLevel,
  nextFollowUpAt,
  setNextFollowUpAt,
  notes,
  setNotes,
  onSubmit
}: {
  property: PropertyDetail;
  postAction: string | null;
  isOutcomeFlow: boolean;
  leadCaptureError: string | null;
  saveState: "idle" | "saving" | "saved" | "error";
  firstName: string;
  setFirstName: (value: string) => void;
  lastName: string;
  setLastName: (value: string) => void;
  phone: string;
  setPhone: (value: string) => void;
  email: string;
  setEmail: (value: string) => void;
  leadStatus: string;
  setLeadStatus: (value: string) => void;
  interestLevel: NonNullable<LeadInput["interestLevel"]>;
  setInterestLevel: (value: NonNullable<LeadInput["interestLevel"]>) => void;
  nextFollowUpAt: string;
  setNextFollowUpAt: (value: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  onSubmit: () => Promise<void>;
}) {
  return (
    <>
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
          await onSubmit();
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
            Capture the homeowner info first. When you save, Lumino will start follow-up and open a prefilled thank-you text if a
            phone number is present.
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
            <input value={firstName} onChange={(event) => setFirstName(event.target.value)} className={drawerFieldClassName} />
          </label>
          <label className="text-xs text-slate-500">
            Last name
            <input value={lastName} onChange={(event) => setLastName(event.target.value)} className={drawerFieldClassName} />
          </label>
          <label className="col-span-2 text-xs text-slate-500">
            Phone
            <input value={phone} onChange={(event) => setPhone(event.target.value)} className={drawerFieldClassName} />
          </label>
          <label className="col-span-2 text-xs text-slate-500">
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} className={drawerFieldClassName} />
          </label>
          <label className="text-xs text-slate-500">
            Lead stage
            <select value={leadStatus} onChange={(event) => setLeadStatus(event.target.value)} className={drawerFieldClassName}>
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
              onChange={(event) => setInterestLevel(event.target.value as NonNullable<LeadInput["interestLevel"]>)}
              className={drawerFieldClassName}
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
                className={drawerFieldClassName}
              />
            </label>
          ) : null}
          <label className="col-span-2 text-xs text-slate-500">
            Notes
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} className={drawerFieldClassName} />
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
            className="app-focus-button rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
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
    </>
  );
}

export function PropertyDrawerTaskForm({
  taskType,
  setTaskType,
  taskDueAt,
  setTaskDueAt,
  taskNotes,
  setTaskNotes,
  taskState,
  onSubmit
}: {
  taskType: TaskInput["type"];
  setTaskType: (value: TaskInput["type"]) => void;
  taskDueAt: string;
  setTaskDueAt: (value: string) => void;
  taskNotes: string;
  setTaskNotes: (value: string) => void;
  taskState: "idle" | "saving" | "saved" | "error";
  onSubmit: () => Promise<void>;
}) {
  return (
    <form
      className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        await onSubmit();
      }}
    >
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Quick Task</div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="text-xs text-slate-500">
          Task type
          <select
            value={taskType}
            onChange={(event) => setTaskType(event.target.value as TaskInput["type"])}
            className={drawerFieldClassName}
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
            className={drawerFieldClassName}
          />
        </label>
        <label className="text-xs text-slate-500 md:col-span-2">
          Notes
          <textarea
            value={taskNotes}
            onChange={(event) => setTaskNotes(event.target.value)}
            rows={3}
            placeholder="What should happen next?"
            className={drawerFieldClassName}
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
          className="app-focus-button rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-ink shadow-sm ring-1 ring-slate-200"
        >
          {taskState === "saving" ? "Saving..." : "Add Task"}
        </button>
      </div>
    </form>
  );
}

export function PropertyDrawerHistorySection({ property }: { property: PropertyDetail }) {
  return (
    <>
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Recent Visits</div>
        <div className="mt-3 space-y-3">
          {property.recentVisits.length ? (
            property.recentVisits.slice(0, 4).map((visit) => (
              <div key={visit.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="font-medium text-ink">{visit.outcome}</div>
                <div className="mt-1 text-xs text-slate-500">{formatDateTime(visit.capturedAt)}</div>
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
                <div className="mt-1 text-xs text-slate-500">{formatDateTime(activity.createdAt)}</div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 p-3 text-sm text-slate-500">
              No property activity has been logged yet.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
