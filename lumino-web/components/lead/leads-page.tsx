"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LeadListItem, LeadsResponse } from "@/types/api";
import { authFetch, useAuth } from "@/lib/auth/client";

function formatDateTime(value: string | null) {
  if (!value) return "None";
  return new Date(value).toLocaleString();
}

export function LeadsPage() {
  const { session } = useAuth();
  const [items, setItems] = useState<LeadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");

  const loadLeads = useCallback(async () => {
    if (!session?.access_token) return null;
    setLoading(true);
    try {
      const response = await authFetch(session.access_token, "/api/leads");
      if (!response.ok) return null;
      const json = (await response.json()) as LeadsResponse;
      setItems(json.items);
      return json;
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  const visibleItems = useMemo(() => {
    if (statusFilter === "all") return items;
    return items.filter((item) => item.leadStatus === statusFilter);
  }, [items, statusFilter]);

  const uniqueStatuses = useMemo(
    () => ["all", ...new Set(items.map((item) => item.leadStatus).filter(Boolean))],
    [items]
  );

  return (
    <div className="p-4 md:p-6">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Leads</div>
            <h1 className="mt-2 text-3xl font-semibold text-ink">Pipeline and homeowner records</h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-600">
              See the opportunity layer that sits on top of property memory, follow-up work, and appointments.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Filter by stage</div>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="mt-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            >
              {uniqueStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="pb-3 pr-4 font-semibold">Lead</th>
                <th className="pb-3 pr-4 font-semibold">Stage</th>
                <th className="pb-3 pr-4 font-semibold">Next Follow-Up</th>
                <th className="pb-3 pr-4 font-semibold">Appointment</th>
                <th className="pb-3 pr-4 font-semibold">Owner</th>
                <th className="pb-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {visibleItems.map((item) => (
                <tr key={item.leadId}>
                  <td className="py-3 pr-4">
                    <div className="font-semibold text-ink">{item.contactName ?? item.address}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.address}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.phone ?? item.email ?? "No contact yet"}</div>
                  </td>
                  <td className="py-3 pr-4">{item.leadStatus}</td>
                  <td className="py-3 pr-4">{formatDateTime(item.nextFollowUpAt)}</td>
                  <td className="py-3 pr-4">{formatDateTime(item.appointmentAt)}</td>
                  <td className="py-3 pr-4">{item.ownerName ?? "Unassigned"}</td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/leads/${item.leadId}` as Route}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 transition hover:border-slate-300"
                      >
                        Detail
                      </Link>
                      {item.propertyId ? (
                        <Link
                          href={`/properties/${item.propertyId}` as Route}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 transition hover:border-slate-300"
                        >
                          Property
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && !visibleItems.length ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
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
