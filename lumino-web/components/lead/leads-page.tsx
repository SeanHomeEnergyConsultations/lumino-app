"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LeadListItem, LeadsResponse } from "@/types/api";
import { hasManagerAccess } from "@/lib/auth/permissions";
import { authFetch, useAuth } from "@/lib/auth/client";

function formatDateTime(value: string | null) {
  if (!value) return "None";
  return new Date(value).toLocaleString();
}

export function LeadsPage() {
  const { session, appContext } = useAuth();
  const isManager = useMemo(
    () => (appContext ? hasManagerAccess(appContext) : false),
    [appContext]
  );
  const [items, setItems] = useState<LeadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [followUpFilter, setFollowUpFilter] = useState("all");
  const [appointmentFilter, setAppointmentFilter] = useState("all");

  const loadLeads = useCallback(async () => {
    if (!session?.access_token) return null;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (ownerFilter !== "all") params.set("ownerId", ownerFilter);
      if (cityFilter !== "all") params.set("city", cityFilter);
      if (followUpFilter !== "all") params.set("followUp", followUpFilter);
      if (appointmentFilter !== "all") params.set("appointment", appointmentFilter);
      const response = await authFetch(session.access_token, `/api/leads?${params.toString()}`);
      if (!response.ok) return null;
      const json = (await response.json()) as LeadsResponse;
      setItems(json.items);
      return json;
    } finally {
      setLoading(false);
    }
  }, [appointmentFilter, cityFilter, followUpFilter, ownerFilter, searchQuery, session?.access_token, statusFilter]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  const uniqueStatuses = useMemo(
    () => ["all", ...new Set(items.map((item) => item.leadStatus).filter(Boolean))],
    [items]
  );
  const uniqueOwners = useMemo(
    () =>
      [
        { value: "all", label: "All owners" },
        ...Array.from(new Map(items.filter((item) => item.ownerId).map((item) => [item.ownerId as string, item.ownerName ?? "Unknown owner"]))).map(
          ([value, label]) => ({ value, label })
        )
      ],
    [items]
  );
  const uniqueCities = useMemo(
    () => ["all", ...new Set(items.map((item) => item.city).filter(Boolean) as string[])],
    [items]
  );

  return (
    <div className="p-4 md:p-6">
      <div className="app-panel rounded-[2rem] border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Leads</div>
            <h1 className="mt-2 text-3xl font-semibold text-ink">Pipeline and homeowner records</h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-600">
              See the opportunity layer that sits on top of property memory, follow-up work, and appointments.
            </p>
          </div>

          <div className="app-panel-soft w-full rounded-3xl border p-3 xl:max-w-4xl">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 xl:col-span-2">
                Search leads
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Address, homeowner, phone, email, outcome"
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none transition focus:border-ink"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                Stage
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none transition focus:border-ink"
                >
                  {uniqueStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              {isManager ? (
                <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Owner
                  <select
                    value={ownerFilter}
                    onChange={(event) => setOwnerFilter(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none transition focus:border-ink"
                  >
                    {uniqueOwners.map((owner) => (
                      <option key={owner.value} value={owner.value}>
                        {owner.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                City
                <select
                  value={cityFilter}
                  onChange={(event) => setCityFilter(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none transition focus:border-ink"
                >
                  {uniqueCities.map((city) => (
                    <option key={city} value={city}>
                      {city === "all" ? "All cities" : city}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                Follow-up
                <select
                  value={followUpFilter}
                  onChange={(event) => setFollowUpFilter(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none transition focus:border-ink"
                >
                  <option value="all">All</option>
                  <option value="overdue">Overdue</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="none">None</option>
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                Appointment
                <select
                  value={appointmentFilter}
                  onChange={(event) => setAppointmentFilter(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none transition focus:border-ink"
                >
                  <option value="all">All</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="none">None</option>
                </select>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="app-panel mt-6 rounded-[2rem] border p-5">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="pb-3 pr-4 font-semibold">Lead</th>
                <th className="pb-3 pr-4 font-semibold">Stage</th>
                <th className="pb-3 pr-4 font-semibold">Last Outcome</th>
                <th className="pb-3 pr-4 font-semibold">Next Follow-Up</th>
                <th className="pb-3 pr-4 font-semibold">Appointment</th>
                {isManager ? <th className="pb-3 pr-4 font-semibold">Owner</th> : null}
                <th className="pb-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {items.map((item) => (
                <tr key={item.leadId}>
                  <td className="py-3 pr-4">
                    <div className="font-semibold text-ink">{item.contactName ?? item.address}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {item.address}
                      {[item.city, item.state, item.postalCode].filter(Boolean).length
                        ? ` · ${[item.city, item.state, item.postalCode].filter(Boolean).join(", ")}`
                        : ""}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{item.phone ?? item.email ?? "No contact yet"}</div>
                  </td>
                  <td className="py-3 pr-4">{item.leadStatus}</td>
                  <td className="py-3 pr-4">{item.lastActivityOutcome ?? "None"}</td>
                  <td className="py-3 pr-4">{formatDateTime(item.nextFollowUpAt)}</td>
                  <td className="py-3 pr-4">{formatDateTime(item.appointmentAt)}</td>
                  {isManager ? <td className="py-3 pr-4">{item.ownerName ?? "Unassigned"}</td> : null}
                  <td className="py-3">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/leads/${item.leadId}` as Route}
                        className="app-glass-button rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 transition hover:bg-white/90"
                      >
                        Detail
                      </Link>
                      {item.propertyId ? (
                        <Link
                          href={`/properties/${item.propertyId}` as Route}
                          className="app-glass-button rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 transition hover:bg-white/90"
                        >
                          Property
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && !items.length ? (
                <tr>
                  <td colSpan={isManager ? 7 : 6} className="py-6 text-center text-slate-500">
                    No leads match this filter yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
