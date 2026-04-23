"use client";

import { useEffect, useRef, useState } from "react";
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
import { authFetch, useAuth } from "@/lib/auth/client";
import { formatDateTime } from "@/lib/format/date";
import {
  drawerFieldClassName,
  PropertyDrawerAppointmentSection,
  PropertyDrawerHistorySection,
  PropertyDrawerLeadForm,
  PropertyDrawerTaskForm
} from "@/components/map/property-drawer-sections";
import {
  usePropertyAppointmentScheduler
} from "@/components/map/use-property-appointment-scheduler";
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

const GO_BACK_TIMING_OPTIONS = [
  { value: "default", label: "Use Default" },
  { value: "morning", label: "Morning" },
  { value: "evening", label: "Evening" },
  { value: "weekend", label: "Weekend" },
  { value: "specific", label: "Specific Note" }
] as const;

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
  }, [property]);

  useEffect(() => {
    if (!isOpen) return;
    setMobileExpanded(true);
  }, [isOpen, mobileOpenNonce]);

  const showActions = mobileSection === "actions";
  const showLead = mobileSection === "lead";
  const showHistory = mobileSection === "history";
  const {
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
  } = usePropertyAppointmentScheduler({
    enabled: postAction === "appointment_set",
    accessToken: session?.access_token,
    appointmentAt,
    setAppointmentAt
  });

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
    const scheduledTime = formatDateTime(appointmentAt, "your scheduled time") ?? "your scheduled time";
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
          engagementScore: phone.trim() || email.trim() ? 4 : null,
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
        engagementScore: postAction === "opportunity" && (phone.trim() || email.trim()) ? 4 : null,
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

  async function handleAppointmentSave() {
    if (!property) return;
    if (!appointmentAt) {
      setActionState("error");
      setLeadCaptureError("Pick a date and time before saving the appointment.");
      return;
    }
    if (selectedAppointmentConflict.hasConflict) {
      setActionState("error");
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
  }

  async function handleTaskSubmit() {
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
            <div className="mt-1">{formatDateTime(property.lastVisitedAt, null) ?? "Never"}</div>
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
                className={drawerFieldClassName}
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
          <PropertyDrawerAppointmentSection
            property={property}
            appointmentSchedulerRef={appointmentSchedulerRef}
            appointmentLeadReady={appointmentLeadReady}
            appointmentAt={appointmentAt}
            setAppointmentAt={setAppointmentAt}
            loadingSchedule={loadingSchedule}
            appointmentCalendarMonth={appointmentCalendarMonth}
            setAppointmentCalendarMonth={setAppointmentCalendarMonth}
            googleCalendarConnected={Boolean(googleCalendarStatus?.connected)}
            loadingGoogleMonthBusy={loadingGoogleMonthBusy}
            googleBusyError={googleBusyError}
            selectedAppointmentDate={selectedAppointmentDate}
            selectedDayScheduleItems={selectedDayScheduleItems}
            selectedDayGoogleBusy={selectedDayGoogleBusy}
            selectedDayBusyWindows={selectedDayBusyWindows}
            selectedAppointmentConflict={selectedAppointmentConflict}
            upcomingScheduleItems={upcomingScheduleItems}
            openQuickTimes={openQuickTimes}
            quickTimeConflictMap={quickTimeConflictMap}
            appointmentCalendarDays={appointmentCalendarDays}
            applyAppointmentDate={applyAppointmentDate}
            applyAppointmentTime={applyAppointmentTime}
            actionState={actionState}
            phone={phone}
            onSaveAppointment={handleAppointmentSave}
          />
        ) : null}
        </div>

        <div className={showLead ? "mt-6 xl:mt-6" : "mt-6 hidden xl:block"}>
          <PropertyDrawerLeadForm
            property={property}
            postAction={postAction}
            isOutcomeFlow={isOutcomeFlow}
            leadCaptureError={leadCaptureError}
            saveState={saveState}
            firstName={firstName}
            setFirstName={setFirstName}
            lastName={lastName}
            setLastName={setLastName}
            phone={phone}
            setPhone={setPhone}
            email={email}
            setEmail={setEmail}
            leadStatus={leadStatus}
            setLeadStatus={setLeadStatus}
            interestLevel={interestLevel}
            setInterestLevel={setInterestLevel}
            nextFollowUpAt={nextFollowUpAt}
            setNextFollowUpAt={setNextFollowUpAt}
            notes={notes}
            setNotes={setNotes}
            onSubmit={handleLeadCaptureSubmit}
          />

          <PropertyDrawerTaskForm
            taskType={taskType}
            setTaskType={setTaskType}
            taskDueAt={taskDueAt}
            setTaskDueAt={setTaskDueAt}
            taskNotes={taskNotes}
            setTaskNotes={setTaskNotes}
            taskState={taskState}
            onSubmit={handleTaskSubmit}
          />
        </div>

        <div className={showHistory ? "mt-6 xl:mt-6" : "mt-6 hidden xl:block"}>
          <PropertyDrawerHistorySection property={property} />
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
