"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useState } from "react";
import type { LeadDetailResponse } from "@/types/api";
import { GoogleCalendarSyncCard } from "@/components/appointments/google-calendar-sync-card";
import {
  ProductEmptyState,
  ProductHero,
  ProductNotice,
  ProductSection,
  ProductStatGrid,
  productFieldClassName,
  productFieldLabelClassName,
  productTextAreaClassName
} from "@/components/shared/product-primitives";
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

const leadFieldClassName = productFieldClassName;
const leadCheckboxClassName =
  "app-panel-soft app-focus-ring flex items-center gap-2 rounded-2xl border px-3 py-3 text-sm text-ink";

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
      <ProductHero
        eyebrow="Lead Workspace"
        title={loading ? "Loading lead..." : lead?.contactName ?? lead?.address ?? "Lead"}
        description={
          loading
            ? "Pulling together the full homeowner record, follow-up timing, and property context."
            : lead?.address ?? "Lead address unavailable."
        }
        actions={
          <>
            <Link
              href="/leads"
              className="app-glass-button app-focus-button rounded-2xl px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-105"
            >
              Back to Leads
            </Link>
            {lead?.propertyId ? (
              <Link
                href={`/properties/${lead.propertyId}` as Route}
                className="app-primary-button app-focus-button rounded-2xl px-4 py-2 text-sm font-semibold transition hover:brightness-105"
              >
                Property Memory
              </Link>
            ) : null}
          </>
        }
      >
        <ProductStatGrid
          columns="md:grid-cols-4 xl:grid-cols-4"
          items={[
            {
              label: "Stage",
              value: loading ? "…" : lead?.leadStatus ?? "None",
              detail: "Where this homeowner sits in the pipeline"
            },
            {
              label: "Interest",
              value: loading ? "…" : lead?.interestLevel ?? "None",
              detail: "Current intent signal from the field"
            },
            {
              label: "Next Follow-Up",
              value: loading ? "…" : formatAppDateTime(lead?.nextFollowUpAt ?? null, "None"),
              detail: "Next scheduled touchpoint"
            },
            {
              label: "Appointment",
              value: loading ? "…" : formatAppDateTime(lead?.appointmentAt ?? null, "None"),
              detail: "Latest scheduled sit or close"
            },
            {
              label: "Cadence",
              value: loading ? "…" : formatLabel(lead?.cadenceTrack ?? null),
              detail: "Current follow-up rhythm"
            },
            {
              label: "Channel",
              value: loading ? "…" : formatLabel(lead?.preferredChannel ?? null),
              detail: "Best current contact lane"
            },
            {
              label: "Owner",
              value: loading ? "…" : lead?.ownerName ?? "Unassigned",
              detail: "Rep currently owning the opportunity"
            },
            {
              label: "Last Activity",
              value: loading ? "…" : formatAppDateTime(lead?.lastActivityAt ?? null, "None"),
              detail: "Most recent logged move"
            }
          ]}
        />
      </ProductHero>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <ProductSection
          eyebrow="Contact and Property"
          title="Keep the opportunity current"
          description="Update homeowner detail, contact preference, appointment timing, and property context without leaving the workspace."
        >
          <div className="space-y-4 text-sm text-slate-600">
            <form className="app-panel-soft rounded-[1.8rem] border p-4" onSubmit={handleSaveLead}>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Edit lead</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500`}>
                  First name
                  <input
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    className={`mt-2 ${leadFieldClassName}`}
                  />
                </label>
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500`}>
                  Last name
                  <input
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    className={`mt-2 ${leadFieldClassName}`}
                  />
                </label>
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500`}>
                  Phone
                  <input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    className={`mt-2 ${leadFieldClassName}`}
                  />
                </label>
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500`}>
                  Email
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className={`mt-2 ${leadFieldClassName}`}
                  />
                </label>
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500`}>
                  Lead stage
                  <select
                    value={leadStatus}
                    onChange={(event) => setLeadStatus(event.target.value)}
                    className={`mt-2 ${leadFieldClassName}`}
                  >
                    {["New", "Attempting Contact", "Connected", "Nurture", "Appointment Set", "Qualified", "Closed Lost"].map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500`}>
                  Interest
                  <select
                    value={interestLevel}
                    onChange={(event) => setInterestLevel(event.target.value as "low" | "medium" | "high")}
                    className={`mt-2 ${leadFieldClassName}`}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500`}>
                  Preferred channel
                  <select
                    value={preferredChannel}
                    onChange={(event) => setPreferredChannel(event.target.value as LeadPreferredChannel)}
                    className={`mt-2 ${leadFieldClassName}`}
                  >
                    <option value="text">Text</option>
                    <option value="call">Call</option>
                    <option value="door">Door</option>
                  </select>
                </label>
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500`}>
                  Decision-maker status
                  <select
                    value={decisionMakerStatus}
                    onChange={(event) => setDecisionMakerStatus(event.target.value as LeadDecisionMakerStatus | "")}
                    className={`mt-2 ${leadFieldClassName}`}
                  >
                    <option value="">Unknown</option>
                    <option value="all_present">All present</option>
                    <option value="spouse_missing">Spouse missing</option>
                    <option value="other_missing">Other stakeholder missing</option>
                  </select>
                </label>
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500`}>
                  Best contact time
                  <input
                    value={bestContactTime}
                    onChange={(event) => setBestContactTime(event.target.value)}
                    placeholder="Evenings, weekends, after Tuesday…"
                    className={`mt-2 ${leadFieldClassName}`}
                  />
                </label>
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500`}>
                  Engagement score
                  <select
                    value={engagementScore}
                    onChange={(event) => setEngagementScore(event.target.value)}
                    className={`mt-2 ${leadFieldClassName}`}
                  >
                    {["1", "2", "3", "4", "5"].map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500`}>
                  Next follow-up
                  <input
                    type="datetime-local"
                    value={nextFollowUpAt}
                    onChange={(event) => setNextFollowUpAt(event.target.value)}
                    className={`mt-2 ${leadFieldClassName}`}
                  />
                </label>
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500`}>
                  Appointment
                  <input
                    type="datetime-local"
                    value={appointmentAt}
                    onChange={(event) => setAppointmentAt(event.target.value)}
                    className={`mt-2 ${leadFieldClassName}`}
                  />
                </label>
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500`}>
                  Appointment outcome
                  <select
                    value={appointmentOutcome}
                    onChange={(event) => setAppointmentOutcome(event.target.value as LeadAppointmentOutcome | "")}
                    className={`mt-2 ${leadFieldClassName}`}
                  >
                    <option value="">Active / none</option>
                    <option value="sat_not_closed">Sat, not closed</option>
                    <option value="moved">Moved</option>
                    <option value="canceled">Canceled</option>
                    <option value="no_show">No show</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500`}>
                  Objection type
                  <select
                    value={objectionType}
                    onChange={(event) => setObjectionType(event.target.value as LeadObjectionType | "")}
                    className={`mt-2 ${leadFieldClassName}`}
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
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500`}>
                  Reschedule reason
                  <input
                    value={rescheduleReason}
                    onChange={(event) => setRescheduleReason(event.target.value)}
                    className={`mt-2 ${leadFieldClassName}`}
                  />
                </label>
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500`}>
                  Cancellation reason
                  <input
                    value={cancellationReason}
                    onChange={(event) => setCancellationReason(event.target.value)}
                    className={`mt-2 ${leadFieldClassName}`}
                  />
                </label>
                <label className={leadCheckboxClassName}>
                  <input
                    type="checkbox"
                    checked={textConsent}
                    onChange={(event) => setTextConsent(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Text consent captured
                </label>
                <label className={leadCheckboxClassName}>
                  <input
                    type="checkbox"
                    checked={billReceived}
                    onChange={(event) => setBillReceived(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Bill received
                </label>
                <label className={leadCheckboxClassName}>
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
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500 md:col-span-2`}>
                  Notes
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={4}
                    className={`mt-2 ${productTextAreaClassName}`}
                  />
                </label>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="min-h-[2.5rem] flex-1">
                  {leadSaveState === "saved" ? (
                    <ProductNotice tone="success" message="Lead updated and synced into the current workspace." />
                  ) : leadSaveState === "error" ? (
                    <ProductNotice tone="error" message="Lead save failed. Try again in a moment." />
                  ) : (
                    <div className="text-xs text-slate-500">Edit this homeowner record without losing map or workflow context.</div>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={leadSaveState === "saving"}
                  className="app-primary-button app-focus-button rounded-2xl px-4 py-2 text-sm font-semibold transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {leadSaveState === "saving" ? "Saving..." : "Save Lead"}
                </button>
              </div>
            </form>

            <div className="app-panel-soft rounded-[1.8rem] border p-4">
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

            <form className="app-panel-soft rounded-[1.8rem] border p-4" onSubmit={handleCreateTask}>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Add task</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500`}>
                  Task type
                  <select
                    value={taskType}
                    onChange={(event) => setTaskType(event.target.value as TaskInput["type"])}
                    className={`mt-2 ${leadFieldClassName}`}
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
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500`}>
                  Due at
                  <input
                    type="datetime-local"
                    value={taskDueAt}
                    onChange={(event) => setTaskDueAt(event.target.value)}
                    className={`mt-2 ${leadFieldClassName}`}
                  />
                </label>
                <label className={`${productFieldLabelClassName} normal-case tracking-normal text-slate-500 md:col-span-2`}>
                  Notes
                  <textarea
                    value={taskNotes}
                    onChange={(event) => setTaskNotes(event.target.value)}
                    rows={3}
                    className={`mt-2 ${productTextAreaClassName}`}
                  />
                </label>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="min-h-[2.5rem] flex-1">
                  {taskState === "saved" ? (
                    <ProductNotice tone="success" message="Task created and attached to this homeowner record." />
                  ) : taskState === "error" ? (
                    <ProductNotice tone="error" message="Task save failed. Check the input and try again." />
                  ) : (
                    <div className="text-xs text-slate-500">Drop a call, revisit, or confirmation task directly onto this opportunity.</div>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={taskState === "saving"}
                  className="app-glass-button app-focus-button rounded-2xl px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {taskState === "saving" ? "Saving..." : "Add Task"}
                </button>
              </div>
            </form>
          </div>
        </ProductSection>

        <ProductSection
          eyebrow="Lead Timeline"
          title="Activity and follow-through"
          description="Review what has already happened on this record before planning the next move."
        >
          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="app-panel-soft rounded-[1.8rem] border p-4 text-sm text-slate-500">
                Loading homeowner activity and field notes...
              </div>
            ) : lead?.activities.length ? (
              lead.activities.map((activity) => (
                <div key={activity.id} className="app-panel-soft rounded-[1.8rem] border p-4">
                  <div className="text-sm font-semibold text-ink">{formatLabel(activity.type)}</div>
                  <div className="mt-1 text-xs text-slate-500">{formatAppDateTime(activity.createdAt, "Unknown")}</div>
                </div>
              ))
            ) : (
              <ProductEmptyState
                title="No lead activity logged yet"
                description="Once calls, visits, appointment changes, or follow-up tasks land on this record, they will stack here."
              />
            )}
          </div>
        </ProductSection>
      </div>
    </div>
  );
}
