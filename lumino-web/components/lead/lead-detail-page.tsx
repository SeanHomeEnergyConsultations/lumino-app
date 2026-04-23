"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useState } from "react";
import type { LeadDetailResponse } from "@/types/api";
import { GoogleCalendarSyncCard } from "@/components/appointments/google-calendar-sync-card";
import type {
  LeadAppointmentOutcome,
  LeadDecisionMakerStatus,
  LeadInput,
  LeadObjectionType,
  LeadPreferredChannel,
  TaskInput
} from "@/types/entities";
import { trackAppEvent } from "@/lib/analytics/app-events";
import { authFetch, useAuth } from "@/lib/auth/client";
import { formatDateTime as formatAppDateTime } from "@/lib/format/date";

const leadFieldClassName = "app-focus-ring mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink";

function formatLabel(value: string | null) {
  if (!value) return "None";
  return value.replaceAll("_", " ");
}

function formatBoolean(value: boolean | null | undefined) {
  if (value === null || value === undefined) return "Unknown";
  return value ? "Yes" : "No";
}

export function LeadDetailPage({ leadId }: { leadId: string }) {
  const { session } = useAuth();
  const [lead, setLead] = useState<LeadDetailResponse["item"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [leadStatus, setLeadStatus] = useState("New");
  const [interestLevel, setInterestLevel] = useState<"low" | "medium" | "high">("medium");
  const [decisionMakerStatus, setDecisionMakerStatus] = useState<LeadDecisionMakerStatus | "">("");
  const [preferredChannel, setPreferredChannel] = useState<LeadPreferredChannel>("text");
  const [bestContactTime, setBestContactTime] = useState("");
  const [textConsent, setTextConsent] = useState(true);
  const [objectionType, setObjectionType] = useState<LeadObjectionType | "">("");
  const [billReceived, setBillReceived] = useState(false);
  const [proposalPresented, setProposalPresented] = useState(false);
  const [appointmentOutcome, setAppointmentOutcome] = useState<LeadAppointmentOutcome | "">("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [cancellationReason, setCancellationReason] = useState("");
  const [engagementScore, setEngagementScore] = useState("3");
  const [nextFollowUpAt, setNextFollowUpAt] = useState("");
  const [appointmentAt, setAppointmentAt] = useState("");
  const [leadSaveState, setLeadSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [taskType, setTaskType] = useState<TaskInput["type"]>("call");
  const [taskDueAt, setTaskDueAt] = useState("");
  const [taskNotes, setTaskNotes] = useState("");
  const [taskState, setTaskState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const loadLead = useCallback(async () => {
    if (!session?.access_token) return null;
    setLoading(true);
    try {
      const response = await authFetch(session.access_token, `/api/leads/${leadId}`);
      if (!response.ok) return null;
      const json = (await response.json()) as LeadDetailResponse;
      setLead(json.item);
      return json.item;
    } finally {
      setLoading(false);
    }
  }, [leadId, session?.access_token]);

  useEffect(() => {
    void loadLead();
  }, [loadLead]);

  useEffect(() => {
    if (!lead) return;
    const toLocal = (value: string | null) => {
      if (!value) return "";
      const date = new Date(value);
      const offset = date.getTimezoneOffset();
      return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
    };

    setFirstName(lead.firstName ?? "");
    setLastName(lead.lastName ?? "");
    setPhone(lead.phone ?? "");
    setEmail(lead.email ?? "");
    setNotes(lead.notes ?? "");
    setLeadStatus(lead.leadStatus ?? "New");
    setInterestLevel((lead.interestLevel as "low" | "medium" | "high" | null) ?? "medium");
    setDecisionMakerStatus((lead.decisionMakerStatus as LeadDecisionMakerStatus | null) ?? "");
    setPreferredChannel((lead.preferredChannel as LeadPreferredChannel | null) ?? (lead.phone ? "text" : "door"));
    setBestContactTime(lead.bestContactTime ?? "");
    setTextConsent(lead.textConsent ?? Boolean(lead.phone));
    setObjectionType((lead.objectionType as LeadObjectionType | null) ?? "");
    setBillReceived(lead.billReceived ?? false);
    setProposalPresented(lead.proposalPresented ?? false);
    setAppointmentOutcome((lead.appointmentOutcome as LeadAppointmentOutcome | null) ?? "");
    setRescheduleReason(lead.rescheduleReason ?? "");
    setCancellationReason(lead.cancellationReason ?? "");
    setEngagementScore(String(lead.engagementScore ?? 3));
    setNextFollowUpAt(toLocal(lead.nextFollowUpAt));
    setAppointmentAt(toLocal(lead.appointmentAt));
    setLeadSaveState("idle");
  }, [lead]);

  async function handleSaveLead(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.access_token || !lead?.propertyId) return;
    setLeadSaveState("saving");
    try {
      const payload: LeadInput = {
        propertyId: lead.propertyId,
        firstName,
        lastName,
        phone,
        email,
        notes,
        leadStatus,
        interestLevel,
        decisionMakerStatus: decisionMakerStatus || null,
        preferredChannel,
        bestContactTime: bestContactTime || null,
        textConsent,
        objectionType: objectionType || null,
        billReceived,
        proposalPresented,
        appointmentOutcome: appointmentOutcome || null,
        rescheduleReason: rescheduleReason || null,
        cancellationReason: cancellationReason || null,
        engagementScore: Number(engagementScore) || null,
        nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt).toISOString() : null,
        appointmentAt: appointmentAt ? new Date(appointmentAt).toISOString() : null
      };
      const response = await authFetch(session.access_token, "/api/leads", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error("Failed to save lead");
      trackAppEvent("leads.saved", {
        leadId,
        propertyId: lead.propertyId,
        leadStatus,
        hasAppointment: Boolean(appointmentAt),
        hasFollowUp: Boolean(nextFollowUpAt)
      });
      await loadLead();
      setLeadSaveState("saved");
    } catch {
      setLeadSaveState("error");
    }
  }

  async function handleCreateTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.access_token || !lead) return;
    setTaskState("saving");
    try {
      const response = await authFetch(session.access_token, "/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          propertyId: lead.propertyId,
          leadId: lead.leadId,
          type: taskType,
          dueAt: taskDueAt ? new Date(taskDueAt).toISOString() : null,
          notes: taskNotes || null
        })
      });

      if (!response.ok) throw new Error("Failed to create task");
      trackAppEvent("leads.task_created", {
        leadId,
        taskType,
        hasDueAt: Boolean(taskDueAt)
      });
      setTaskState("saved");
      setTaskNotes("");
      setTaskDueAt("");
      setTaskType("call");
    } catch {
      setTaskState("error");
    }
  }

  return (
    <div className="p-4 md:p-6">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Lead Detail</div>
            <h1 className="mt-2 text-3xl font-semibold text-ink">
              {loading ? "Loading lead..." : lead?.contactName ?? lead?.address ?? "Lead"}
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-600">
              {loading
                ? "Pulling together the full opportunity record."
                : lead?.address ?? "Lead address unavailable."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/leads"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-slate-300"
            >
              Back to Leads
            </Link>
            {lead?.propertyId ? (
              <Link
                href={`/properties/${lead.propertyId}` as Route}
                className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Property Memory
              </Link>
            ) : null}
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-6">
          {[
            { label: "Stage", value: lead?.leadStatus ?? "…" },
            { label: "Interest", value: lead?.interestLevel ?? "None" },
            { label: "Cadence", value: formatLabel(lead?.cadenceTrack ?? null) },
            { label: "Channel", value: formatLabel(lead?.preferredChannel ?? null) },
            { label: "Next Follow-Up", value: formatAppDateTime(lead?.nextFollowUpAt ?? null, "None") },
            { label: "Appointment", value: formatAppDateTime(lead?.appointmentAt ?? null, "None") },
            { label: "Owner", value: lead?.ownerName ?? "Unassigned" },
            { label: "Last Activity", value: formatAppDateTime(lead?.lastActivityAt ?? null, "None") }
          ].map((item) => (
            <div key={item.label} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">{item.label}</div>
              <div className="mt-2 text-lg font-semibold text-ink">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Contact and Property</div>
          <div className="mt-4 space-y-4 text-sm text-slate-600">
            <form className="rounded-3xl border border-slate-200 bg-slate-50 p-4" onSubmit={handleSaveLead}>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Edit lead</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-xs text-slate-500">
                  First name
                  <input
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    className={leadFieldClassName}
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Last name
                  <input
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    className={leadFieldClassName}
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Phone
                  <input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    className={leadFieldClassName}
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Email
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className={leadFieldClassName}
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Lead stage
                  <select
                    value={leadStatus}
                    onChange={(event) => setLeadStatus(event.target.value)}
                    className={leadFieldClassName}
                  >
                    {["New", "Attempting Contact", "Connected", "Nurture", "Appointment Set", "Qualified", "Closed Lost"].map((option) => (
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
                    className={leadFieldClassName}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  Preferred channel
                  <select
                    value={preferredChannel}
                    onChange={(event) => setPreferredChannel(event.target.value as LeadPreferredChannel)}
                    className={leadFieldClassName}
                  >
                    <option value="text">Text</option>
                    <option value="call">Call</option>
                    <option value="door">Door</option>
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  Decision-maker status
                  <select
                    value={decisionMakerStatus}
                    onChange={(event) => setDecisionMakerStatus(event.target.value as LeadDecisionMakerStatus | "")}
                    className={leadFieldClassName}
                  >
                    <option value="">Unknown</option>
                    <option value="all_present">All present</option>
                    <option value="spouse_missing">Spouse missing</option>
                    <option value="other_missing">Other stakeholder missing</option>
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  Best contact time
                  <input
                    value={bestContactTime}
                    onChange={(event) => setBestContactTime(event.target.value)}
                    placeholder="Evenings, weekends, after Tuesday…"
                    className={leadFieldClassName}
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Engagement score
                  <select
                    value={engagementScore}
                    onChange={(event) => setEngagementScore(event.target.value)}
                    className={leadFieldClassName}
                  >
                    {["1", "2", "3", "4", "5"].map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  Next follow-up
                  <input
                    type="datetime-local"
                    value={nextFollowUpAt}
                    onChange={(event) => setNextFollowUpAt(event.target.value)}
                    className={leadFieldClassName}
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Appointment
                  <input
                    type="datetime-local"
                    value={appointmentAt}
                    onChange={(event) => setAppointmentAt(event.target.value)}
                    className={leadFieldClassName}
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Appointment outcome
                  <select
                    value={appointmentOutcome}
                    onChange={(event) => setAppointmentOutcome(event.target.value as LeadAppointmentOutcome | "")}
                    className={leadFieldClassName}
                  >
                    <option value="">Active / none</option>
                    <option value="sat_not_closed">Sat, not closed</option>
                    <option value="moved">Moved</option>
                    <option value="canceled">Canceled</option>
                    <option value="no_show">No show</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  Objection type
                  <select
                    value={objectionType}
                    onChange={(event) => setObjectionType(event.target.value as LeadObjectionType | "")}
                    className={leadFieldClassName}
                  >
                    <option value="">None / unknown</option>
                    <option value="price">Price</option>
                    <option value="timing">Timing</option>
                    <option value="trust">Trust</option>
                    <option value="roof">Roof</option>
                    <option value="needs_numbers">Needs numbers</option>
                    <option value="spouse">Spouse / other decision-maker</option>
                    <option value="none">No objection</option>
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  Reschedule reason
                  <input
                    value={rescheduleReason}
                    onChange={(event) => setRescheduleReason(event.target.value)}
                    className={leadFieldClassName}
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Cancellation reason
                  <input
                    value={cancellationReason}
                    onChange={(event) => setCancellationReason(event.target.value)}
                    className={leadFieldClassName}
                  />
                </label>
                <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={textConsent}
                    onChange={(event) => setTextConsent(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Text consent captured
                </label>
                <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={billReceived}
                    onChange={(event) => setBillReceived(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Bill received
                </label>
                <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={proposalPresented}
                    onChange={(event) => setProposalPresented(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Proposal presented
                </label>
                <div className="md:col-span-2">
                  <GoogleCalendarSyncCard
                    appointmentAt={appointmentAt || null}
                    returnTo={`/leads/${leadId}`}
                    compact
                  />
                </div>
                <label className="text-xs text-slate-500 md:col-span-2">
                  Notes
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={4}
                    className={leadFieldClassName}
                  />
                </label>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="text-xs text-slate-500">
                  {leadSaveState === "saved"
                    ? "Lead updated."
                    : leadSaveState === "error"
                      ? "Lead save failed."
                      : "Edit this lead without leaving the detail page."}
                </div>
                <button
                  type="submit"
                  disabled={leadSaveState === "saving"}
                  className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-ink shadow-sm ring-1 ring-slate-200"
                >
                  {leadSaveState === "saving" ? "Saving..." : "Save Lead"}
                </button>
              </div>
            </form>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Property Summary</div>
              <div className="mt-2">{lead?.address ?? "Unknown address"}</div>
              <div className="mt-1">{[lead?.city, lead?.state, lead?.postalCode].filter(Boolean).join(", ") || "No location detail yet"}</div>
              <div className="mt-3 text-xs text-slate-500">
                Last visit: {formatLabel(lead?.propertySummary?.lastVisitOutcome ?? null)} ·{" "}
                {formatAppDateTime(lead?.propertySummary?.lastVisitedAt ?? null, "None")}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Visit count: {lead?.propertySummary?.visitCount ?? 0}
              </div>
              <div className="mt-3 grid gap-2 text-xs text-slate-500 md:grid-cols-2">
                <div>Text consent: {formatBoolean(lead?.textConsent)}</div>
                <div>Bill received: {formatBoolean(lead?.billReceived)}</div>
                <div>Proposal presented: {formatBoolean(lead?.proposalPresented)}</div>
                <div>Objection: {formatLabel(lead?.objectionType ?? null)}</div>
              </div>
            </div>

            <form className="rounded-3xl border border-slate-200 bg-slate-50 p-4" onSubmit={handleCreateTask}>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Add task</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-xs text-slate-500">
                  Task type
                  <select
                    value={taskType}
                    onChange={(event) => setTaskType(event.target.value as TaskInput["type"])}
                    className={leadFieldClassName}
                  >
                    <option value="call">Call</option>
                    <option value="text">Text</option>
                    <option value="revisit">Revisit</option>
                    <option value="appointment_confirm">Appointment Confirm</option>
                    <option value="proposal_follow_up">Proposal Follow-Up</option>
                    <option value="rebook_appointment">Rebook Appointment</option>
                    <option value="customer_check_in">Customer Check-In</option>
                    <option value="referral_request">Referral Request</option>
                    <option value="manager_review">Manager Review</option>
                    <option value="custom">Custom</option>
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  Due at
                  <input
                    type="datetime-local"
                    value={taskDueAt}
                    onChange={(event) => setTaskDueAt(event.target.value)}
                    className={leadFieldClassName}
                  />
                </label>
                <label className="text-xs text-slate-500 md:col-span-2">
                  Notes
                  <textarea
                    value={taskNotes}
                    onChange={(event) => setTaskNotes(event.target.value)}
                    rows={3}
                    className={leadFieldClassName}
                  />
                </label>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="text-xs text-slate-500">
                  {taskState === "saved"
                    ? "Task created."
                    : taskState === "error"
                      ? "Task save failed."
                      : "Drop a follow-up directly onto this lead."}
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
        </section>

        <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Lead Timeline</div>
          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                Loading lead activity...
              </div>
            ) : lead?.activities.length ? (
              lead.activities.map((activity) => (
                <div key={activity.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-ink">{formatLabel(activity.type)}</div>
                  <div className="mt-1 text-xs text-slate-500">{formatAppDateTime(activity.createdAt, "Unknown")}</div>
                </div>
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No lead activity has been logged yet.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
