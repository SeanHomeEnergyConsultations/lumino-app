"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useState } from "react";
import type { PropertyDetailResponse } from "@/types/api";
import type { PropertyDetail, PropertySourceRecordItem } from "@/types/entities";
import { authFetch, useAuth } from "@/lib/auth/client";

function formatDateTime(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function formatLabel(value: string | null) {
  if (!value) return "None";
  return value.replaceAll("_", " ");
}

function formatCurrency(value: number | null) {
  if (value === null || value === undefined) return "Unknown";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function formatNumber(value: number | null) {
  if (value === null || value === undefined) return "Unknown";
  return new Intl.NumberFormat("en-US").format(value);
}

function formatSourceLabel(value: string) {
  return value.replaceAll("_", " ");
}

function preferredPayloadEntries(payload: Record<string, unknown>) {
  const preferredKeys = [
    "Price",
    "SALE TYPE",
    "SOLD DATE",
    "Sale Date",
    "PROPERTY TYPE",
    "STATUS",
    "Beds",
    "Baths",
    "SqFt",
    "SQUARE FEET",
    "LOT SIZE",
    "YEAR BUILT",
    "DAYS ON MARKET",
    "MLS#",
    "Unqualified Reason",
    "Notes",
    "Unqualified Reason Notes",
    "Phone",
    "Email",
    "First Name",
    "Last Name"
  ];

  const keys = Object.keys(payload);
  const ordered = [
    ...preferredKeys.filter((key) => key in payload),
    ...keys.filter((key) => !preferredKeys.includes(key))
  ];

  return ordered
    .filter((key) => payload[key] !== null && payload[key] !== undefined && String(payload[key]).trim() !== "")
    .slice(0, 10)
    .map((key) => [key, payload[key]] as const);
}

function SourceRecordCard({ record }: { record: PropertySourceRecordItem }) {
  const entries = preferredPayloadEntries(record.payload);

  return (
    <details className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-ink">
              {record.sourceName ?? formatSourceLabel(record.sourceType)}
            </div>
            <div className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">
              {formatSourceLabel(record.sourceType)}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
              {record.recordDate ? <span>Record date {new Date(record.recordDate).toLocaleDateString()}</span> : null}
              <span>Imported {new Date(record.createdAt).toLocaleDateString()}</span>
              {record.sourceBatchId ? <span>Batch {record.sourceBatchId}</span> : null}
            </div>
          </div>
          <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
            Source
          </div>
        </div>
      </summary>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{key}</div>
            <div className="mt-1 text-sm text-slate-700">{String(value)}</div>
          </div>
        ))}
      </div>

      {record.sourceUrl ? (
        <div className="mt-4">
          <a
            href={record.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold text-ink underline decoration-slate-300 underline-offset-4 transition hover:text-slate-700"
          >
            Open source link
          </a>
        </div>
      ) : null}

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Raw payload</div>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-slate-600">
          {JSON.stringify(record.payload, null, 2)}
        </pre>
      </div>
    </details>
  );
}

function preferredEnrichmentEntries(payload: Record<string, unknown>) {
  const preferredKeys = [
    "solar_fit_score",
    "system_capacity_kw",
    "yearly_energy_dc_kwh",
    "roof_segment_count",
    "south_facing_segment_count",
    "imagery_quality",
    "max_array_panels_count",
    "whole_roof_area_m2",
    "building_area_m2"
  ];

  const keys = Object.keys(payload);
  const ordered = [
    ...preferredKeys.filter((key) => key in payload),
    ...keys.filter((key) => !preferredKeys.includes(key))
  ];

  return ordered
    .filter((key) => payload[key] !== null && payload[key] !== undefined && String(payload[key]).trim() !== "")
    .slice(0, 8)
    .map((key) => [key, payload[key]] as const);
}

function EnrichmentCard({
  provider,
  enrichmentType,
  fetchedAt,
  payload
}: {
  provider: string;
  enrichmentType: string;
  fetchedAt: string;
  payload: Record<string, unknown>;
}) {
  const entries = preferredEnrichmentEntries(payload);
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink">
            {formatSourceLabel(provider)} · {formatSourceLabel(enrichmentType)}
          </div>
          <div className="mt-1 text-xs text-slate-500">Fetched {formatDateTime(fetchedAt)}</div>
        </div>
        <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
          Enrichment
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{formatLabel(key)}</div>
            <div className="mt-1 text-sm text-slate-700">{String(value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
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

        <div className="mt-6 grid gap-3 md:grid-cols-4 xl:grid-cols-7">
          {[
            {
              label: "Priority",
              value: loading
                ? "…"
                : property?.featureAccess.priorityScoringEnabled
                  ? `${property?.priorityScore ?? 0} · ${property?.priorityBand ?? "low"}`
                  : "Locked"
            },
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

      <section className="mt-6 rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Property Facts</div>
            <p className="mt-2 text-sm text-slate-500">
              Normalized property data distilled from imports and analysis.
            </p>
            {property ? <p className="mt-2 text-sm font-medium text-slate-600">{property.prioritySummary}</p> : null}
          </div>
          <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
            {property?.facts.dataCompletenessScore ?? 0}% complete
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Beds", value: formatNumber(property?.facts.beds ?? null) },
            { label: "Baths", value: formatNumber(property?.facts.baths ?? null) },
            { label: "Square Feet", value: formatNumber(property?.facts.squareFeet ?? null) },
            { label: "Lot Size (sqft)", value: formatNumber(property?.facts.lotSizeSqft ?? null) },
            { label: "Year Built", value: formatNumber(property?.facts.yearBuilt ?? null) },
            { label: "Last Sale Date", value: property?.facts.lastSaleDate ? new Date(property.facts.lastSaleDate).toLocaleDateString() : "Unknown" },
            { label: "Last Sale Price", value: formatCurrency(property?.facts.lastSalePrice ?? null) },
            { label: "Property Type", value: property?.facts.propertyType ?? "Unknown" },
            { label: "Listing Status", value: property?.facts.listingStatus ?? "Unknown" },
            { label: "Sale Type", value: property?.facts.saleType ?? "Unknown" },
            { label: "Days on Market", value: formatNumber(property?.facts.daysOnMarket ?? null) },
            { label: "HOA / Month", value: formatCurrency(property?.facts.hoaMonthly ?? null) }
          ].map((item) => (
            <div key={item.label} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">{item.label}</div>
              <div className="mt-2 text-base font-semibold text-ink">{loading ? "…" : item.value}</div>
            </div>
          ))}
        </div>
      </section>

      {loading || property?.featureAccess.priorityScoringEnabled ? (
        <section className="mt-6 rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Priority Signals</div>
              <p className="mt-2 text-sm text-slate-500">
                Live knocking priority blends solar fit, imported detail, contactability, and recent field outcomes.
              </p>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
              {property?.priorityBand ?? "low"}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Operational Priority", value: loading ? "…" : String(property?.priorityScore ?? 0) },
              { label: "Solar Fit Score", value: formatNumber(property?.facts.solarFitScore ?? null) },
              { label: "System Capacity (kW)", value: formatNumber(property?.facts.estimatedSystemCapacityKw ?? null) },
              { label: "Yearly Energy (kWh)", value: formatNumber(property?.facts.estimatedYearlyEnergyKwh ?? null) },
              { label: "Roof Capacity Score", value: formatNumber(property?.facts.roofCapacityScore ?? null) },
              { label: "Roof Complexity Score", value: formatNumber(property?.facts.roofComplexityScore ?? null) },
              { label: "Solar Imagery", value: property?.facts.solarImageryQuality ?? "Unknown" },
              { label: "Persisted Score Band", value: property?.facts.propertyPriorityLabel ?? "Unknown" }
            ].map((item) => (
              <div key={item.label} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">{item.label}</div>
                <div className="mt-2 text-base font-semibold text-ink">{loading ? "…" : item.value}</div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="mt-6 rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Priority Signals</div>
          <div className="mt-3 rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            Priority scoring is available on premium plans once this organization enables intelligence features.
          </div>
        </section>
      )}

      {loading || property?.featureAccess.enrichmentEnabled ? (
        <section className="mt-6 rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Enrichment</div>
              <p className="mt-2 text-sm text-slate-500">
                External and computed data layered onto this property, starting with solar fit.
              </p>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
              {property?.enrichments.length ?? 0}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                Loading enrichments...
              </div>
            ) : property?.enrichments.length ? (
              property.enrichments.map((enrichment) => (
                <EnrichmentCard
                  key={enrichment.id}
                  provider={enrichment.provider}
                  enrichmentType={enrichment.enrichmentType}
                  fetchedAt={enrichment.fetchedAt}
                  payload={enrichment.payload}
                />
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No enrichment snapshots are attached to this property yet.
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="mt-6 rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Enrichment</div>
          <div className="mt-3 rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            Enrichment snapshots are part of the premium intelligence layer for this organization.
          </div>
        </section>
      )}

      <section className="mt-6 rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Sources</div>
            <p className="mt-2 text-sm text-slate-500">
              Imported list rows and source payloads tied to this property.
            </p>
          </div>
          <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
            {property?.sourceRecords.length ?? 0}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {loading ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Loading source records...
            </div>
          ) : property?.sourceRecords.length ? (
            property.sourceRecords.map((record) => <SourceRecordCard key={record.id} record={record} />)
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              No imported source records are attached to this property yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
