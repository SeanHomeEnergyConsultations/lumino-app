"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
import type { LeadInput, PropertyDetail, TaskInput } from "@/types/entities";

const quickOutcomes = [
  { label: "Not Home", value: "not_home", icon: DoorOpen },
  { label: "Left Doorhanger", value: "left_doorhanger", icon: FileBadge2 },
  { label: "Opportunity", value: "opportunity", icon: Handshake },
  { label: "Not Interested", value: "not_interested", icon: XCircle },
  { label: "Disqualified", value: "disqualified", icon: BadgeHelp },
  { label: "Appointment", value: "appointment_set", icon: CalendarCheck2 },
  { label: "Callback", value: "callback_requested", icon: PhoneCall },
  { label: "Do Not Knock", value: "do_not_knock", icon: Ban }
];

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
  }, [property]);

  useEffect(() => {
    if (!isOpen) return;
    setMobileExpanded(true);
  }, [isOpen, mobileOpenNonce]);

  const showActions = mobileSection === "actions";
  const showLead = mobileSection === "lead";
  const showHistory = mobileSection === "history";

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
              onClick={() => {
                setMobileSection("actions");
                setPostAction(item.value);
                setActionState("idle");
                if (item.value === "opportunity") {
                  setLeadStatus("Connected");
                }
                if (item.value === "appointment_set") {
                  setLeadStatus("Appointment Set");
                }
                if (item.value === "disqualified") {
                  setLeadStatus("Closed Lost");
                }
                void onLogOutcome(item.value);
              }}
              disabled={savingVisit}
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
        {postAction === "not_home" || postAction === "left_doorhanger" ? (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Clock3 className="h-4 w-4" />
              Schedule revisit
            </div>
            <p className="mt-1 text-xs text-slate-500">Set the next follow-up while the knock is still fresh.</p>
            <input
              type="datetime-local"
              value={nextFollowUpAt}
              onChange={(event) => setNextFollowUpAt(event.target.value)}
              className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                {actionState === "saved"
                  ? "Revisit saved."
                  : actionState === "error"
                    ? "Could not save revisit."
                    : "This keeps follow-up discipline tight."}
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!property) return;
                  setMobileSection("lead");
                  setActionState("saving");
                  try {
                    await onSaveLead({
                      propertyId: property.propertyId,
                      firstName,
                      lastName,
                      phone,
                      email,
                      notes,
                      leadStatus: property.leadStatus ?? "Attempting Contact",
                      interestLevel,
                      nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt).toISOString() : null
                    });
                    setActionState("saved");
                  } catch {
                    setActionState("error");
                  }
                }}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-ink shadow-sm ring-1 ring-slate-200"
              >
                {actionState === "saving" ? "Saving..." : "Save Revisit"}
              </button>
            </div>
          </div>
        ) : null}

        {postAction === "appointment_set" ? (
          <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <CalendarCheck2 className="h-4 w-4" />
              Capture appointment
            </div>
            <p className="mt-1 text-xs text-slate-500">Lock in the actual appointment time so the CRM stays trustworthy.</p>
            <input
              type="datetime-local"
              value={appointmentAt}
              onChange={(event) => setAppointmentAt(event.target.value)}
              className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                {actionState === "saved"
                  ? "Appointment saved."
                  : actionState === "error"
                    ? "Could not save appointment."
                    : "This also updates the property icon and lead stage."}
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!property) return;
                  setMobileSection("lead");
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
                      appointmentAt: appointmentAt ? new Date(appointmentAt).toISOString() : null,
                      nextFollowUpAt: appointmentAt ? new Date(appointmentAt).toISOString() : null
                    });
                    setActionState("saved");
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
        ) : null}

        {postAction === "disqualified" ? (
          <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-ink">Close this opportunity out?</div>
            <p className="mt-1 text-xs text-slate-500">This marks the lead as closed lost while preserving the door timestamp for accountability.</p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                {actionState === "saved"
                  ? "Marked closed lost."
                  : actionState === "error"
                    ? "Could not update lead."
                    : "Use this when the house is clearly not a fit."}
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!property) return;
                  setMobileSection("lead");
                  setActionState("saving");
                  try {
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
                    setActionState("saved");
                  } catch {
                    setActionState("error");
                  }
                }}
                className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-ink shadow-sm ring-1 ring-slate-200"
              >
                {actionState === "saving" ? "Saving..." : "Mark Closed Lost"}
              </button>
            </div>
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
            if (!property) return;
            setSaveState("saving");
            try {
              await onSaveLead({
                propertyId: property.propertyId,
                firstName,
                lastName,
                phone,
                email,
                notes,
                leadStatus,
                interestLevel,
                nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt).toISOString() : null
              });
              setSaveState("saved");
              setMobileSection("history");
              onDismiss?.();
            } catch {
              setSaveState("error");
            }
          }}
        >
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Lead Capture</div>
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
            <label className="col-span-2 text-xs text-slate-500">
              Next follow-up
              <input
                type="datetime-local"
                value={nextFollowUpAt}
                onChange={(event) => setNextFollowUpAt(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              />
            </label>
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
              {saveState === "saved"
                ? "Lead saved."
                : saveState === "error"
                  ? "Save failed. Try again."
                  : "Capture homeowner details right from the map."}
            </div>
            <button
              type="submit"
              disabled={saveState === "saving"}
              className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saveState === "saving" ? "Saving..." : property.leadId ? "Update Lead" : "Create Lead"}
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
