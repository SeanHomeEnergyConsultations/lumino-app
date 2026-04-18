"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useState } from "react";
import type { PropertyDetailResponse } from "@/types/api";
import type { PropertyDetail } from "@/types/entities";
import { authFetch, useAuth } from "@/lib/auth/client";

function formatDateTime(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function formatLabel(value: string | null) {
  if (!value) return "None";
  return value.replaceAll("_", " ");
}

export function PropertyDetailPage({ propertyId }: { propertyId: string }) {
  const { session } = useAuth();
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProperty = useCallback(async () => {
    if (!session?.access_token) return null;
    setLoading(true);
    try {
      const response = await authFetch(session.access_token, `/api/properties/${propertyId}`);
      if (!response.ok) return null;
      const json = (await response.json()) as PropertyDetailResponse;
      setProperty(json.item);
      return json.item;
    } finally {
      setLoading(false);
    }
  }, [propertyId, session?.access_token]);

  useEffect(() => {
    void loadProperty();
  }, [loadProperty]);

  return (
    <div className="p-4 md:p-6">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Property Memory</div>
            <h1 className="mt-2 text-3xl font-semibold text-ink">
              {loading ? "Loading property..." : property?.address ?? "Property not found"}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {loading
                ? "Pulling together the full memory for this property."
                : [property?.city, property?.state, property?.postalCode].filter(Boolean).join(", ") || "No location detail yet."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href={`/map?propertyId=${propertyId}` as Route}
              className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Open on Map
            </Link>
            <Link
              href="/queue"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-slate-300"
            >
              Back to Queue
            </Link>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-6">
          {[
            { label: "Map State", value: property ? formatLabel(property.mapState) : "…" },
            { label: "Follow-Up", value: property ? formatLabel(property.followUpState) : "…" },
            { label: "Visits", value: loading ? "…" : String(property?.visitCount ?? 0) },
            { label: "Not Home Tries", value: loading ? "…" : String(property?.notHomeCount ?? 0) },
            { label: "Last Outcome", value: property ? formatLabel(property.lastVisitOutcome) : "…" },
            { label: "Lead State", value: property?.leadStatus ?? (loading ? "…" : "No active lead") }
          ].map((item) => (
            <div key={item.label} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">{item.label}</div>
              <div className="mt-2 text-lg font-semibold text-ink">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Visit History</div>
          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                Loading visits...
              </div>
            ) : property?.recentVisits.length ? (
              property.recentVisits.map((visit) => (
                <div key={visit.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-ink">{formatLabel(visit.outcome)}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatDateTime(visit.capturedAt)}</div>
                    </div>
                    <div className="text-xs uppercase tracking-[0.12em] text-slate-500">
                      {visit.userId ? "Rep logged" : "System"}
                    </div>
                  </div>
                  {visit.notes ? <div className="mt-3 text-sm text-slate-600">{visit.notes}</div> : null}
                </div>
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No structured visits have been logged for this property yet.
              </div>
            )}
          </div>
        </section>

        <div className="grid gap-6">
          <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Lead Snapshot</div>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Homeowner</div>
                <div className="mt-2 text-base font-semibold text-ink">
                  {[property?.firstName, property?.lastName].filter(Boolean).join(" ") || "No homeowner captured yet"}
                </div>
                <div className="mt-2">{property?.phone || "No phone yet"}</div>
                <div className="mt-1">{property?.email || "No email yet"}</div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Next Step</div>
                <div className="mt-2">Next follow-up: {formatDateTime(property?.leadNextFollowUpAt ?? null)}</div>
                <div className="mt-1">Appointment: {formatDateTime(property?.appointmentAt ?? null)}</div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Notes</div>
                <div className="mt-2">{property?.leadNotes || "No lead notes yet."}</div>
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Timeline</div>
            <div className="mt-4 space-y-3">
              {loading ? (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  Loading activity...
                </div>
              ) : property?.recentActivities.length ? (
                property.recentActivities.map((activity) => (
                  <div key={activity.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm font-semibold text-ink">{formatLabel(activity.type)}</div>
                    <div className="mt-1 text-xs text-slate-500">{formatDateTime(activity.createdAt)}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  No property timeline activity yet.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
