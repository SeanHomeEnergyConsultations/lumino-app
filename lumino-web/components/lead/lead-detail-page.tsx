"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useState } from "react";
import type { LeadDetailResponse } from "@/types/api";
import type { TaskInput } from "@/types/entities";
import { authFetch, useAuth } from "@/lib/auth/client";

function formatDateTime(value: string | null) {
  if (!value) return "None";
  return new Date(value).toLocaleString();
}

function formatLabel(value: string | null) {
  if (!value) return "None";
  return value.replaceAll("_", " ");
}

export function LeadDetailPage({ leadId }: { leadId: string }) {
  const { session } = useAuth();
  const [lead, setLead] = useState<LeadDetailResponse["item"] | null>(null);
  const [loading, setLoading] = useState(true);
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
            { label: "Next Follow-Up", value: formatDateTime(lead?.nextFollowUpAt ?? null) },
            { label: "Appointment", value: formatDateTime(lead?.appointmentAt ?? null) },
            { label: "Owner", value: lead?.ownerName ?? "Unassigned" },
            { label: "Last Activity", value: formatDateTime(lead?.lastActivityAt ?? null) }
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
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Homeowner</div>
              <div className="mt-2 text-base font-semibold text-ink">
                {lead?.contactName ?? "No homeowner captured yet"}
              </div>
              <div className="mt-2">{lead?.phone ?? "No phone yet"}</div>
              <div className="mt-1">{lead?.email ?? "No email yet"}</div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Property Summary</div>
              <div className="mt-2">{lead?.address ?? "Unknown address"}</div>
              <div className="mt-1">{[lead?.city, lead?.state, lead?.postalCode].filter(Boolean).join(", ") || "No location detail yet"}</div>
              <div className="mt-3 text-xs text-slate-500">
                Last visit: {formatLabel(lead?.propertySummary?.lastVisitOutcome ?? null)} · {formatDateTime(lead?.propertySummary?.lastVisitedAt ?? null)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Visit count: {lead?.propertySummary?.visitCount ?? 0}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Notes</div>
              <div className="mt-2">{lead?.notes ?? "No lead notes yet."}</div>
            </div>

            <form className="rounded-3xl border border-slate-200 bg-slate-50 p-4" onSubmit={handleCreateTask}>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Add task</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-xs text-slate-500">
                  Task type
                  <select
                    value={taskType}
                    onChange={(event) => setTaskType(event.target.value as TaskInput["type"])}
                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
                  >
                    <option value="call">Call</option>
                    <option value="text">Text</option>
                    <option value="revisit">Revisit</option>
                    <option value="appointment_confirm">Appointment Confirm</option>
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
                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
                  />
                </label>
                <label className="text-xs text-slate-500 md:col-span-2">
                  Notes
                  <textarea
                    value={taskNotes}
                    onChange={(event) => setTaskNotes(event.target.value)}
                    rows={3}
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
                  <div className="mt-1 text-xs text-slate-500">{formatDateTime(activity.createdAt)}</div>
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
