"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LeadListItem, LeadsResponse } from "@/types/api";
import {
  ProductEmptyState,
  ProductFilterBar,
  ProductHero,
  ProductSection,
  productFieldClassName,
  productFieldLabelClassName
} from "@/components/shared/product-primitives";
import { buildLeadsSearchParams } from "@/components/shared/workspace-url-state";
import { hasManagerAccess } from "@/lib/auth/permissions";
import { trackAppEvent } from "@/lib/analytics/app-events";
import { authFetch, useAuth } from "@/lib/auth/client";
import { formatDateTime } from "@/lib/format/date";

export function LeadsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { session, appContext } = useAuth();
  const isManager = useMemo(
    () => (appContext ? hasManagerAccess(appContext) : false),
    [appContext]
  );
  const hasTrackedFilterState = useRef(false);
  const [items, setItems] = useState<LeadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("q") ?? "");
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get("status") ?? "all");
  const [ownerFilter, setOwnerFilter] = useState(() => searchParams.get("ownerId") ?? "all");
  const [cityFilter, setCityFilter] = useState(() => searchParams.get("city") ?? "all");
  const [followUpFilter, setFollowUpFilter] = useState(() => searchParams.get("followUp") ?? "all");
  const [appointmentFilter, setAppointmentFilter] = useState(() => searchParams.get("appointment") ?? "all");

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

  useEffect(() => {
    const nextSearch = buildLeadsSearchParams({
      currentSearch: searchParams.toString(),
      q: searchQuery,
      status: statusFilter,
      ownerId: ownerFilter,
      city: cityFilter,
      followUp: followUpFilter,
      appointment: appointmentFilter
    });
    const currentSearch = searchParams.toString();
    if (nextSearch === currentSearch) return;
    startTransition(() => {
      router.replace((nextSearch ? `${pathname}?${nextSearch}` : pathname) as Route, { scroll: false });
    });
  }, [
    appointmentFilter,
    cityFilter,
    followUpFilter,
    ownerFilter,
    pathname,
    router,
    searchParams,
    searchQuery,
    statusFilter
  ]);

  useEffect(() => {
    if (!hasTrackedFilterState.current) {
      hasTrackedFilterState.current = true;
      return;
    }
    trackAppEvent("leads.filters_changed", {
      hasQuery: Boolean(searchQuery.trim()),
      statusFilter,
      ownerFilter: isManager ? ownerFilter : "self",
      cityFilter,
      followUpFilter,
      appointmentFilter
    });
  }, [appointmentFilter, cityFilter, followUpFilter, isManager, ownerFilter, searchQuery, statusFilter]);

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
      <ProductHero
        eyebrow="Leads"
        title="Pipeline and homeowner records"
        description="See the opportunity layer that sits on top of property memory, follow-up work, and appointments."
      >
        <ProductFilterBar className="w-full xl:max-w-4xl">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <label className={`${productFieldLabelClassName} xl:col-span-2`}>
                Search leads
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Address, homeowner, phone, email, outcome"
                  className={`mt-2 ${productFieldClassName}`}
                />
              </label>
              <label className={productFieldLabelClassName}>
                Stage
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className={`mt-2 ${productFieldClassName}`}
                >
                  {uniqueStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              {isManager ? (
                <label className={productFieldLabelClassName}>
                  Owner
                  <select
                    value={ownerFilter}
                    onChange={(event) => setOwnerFilter(event.target.value)}
                    className={`mt-2 ${productFieldClassName}`}
                  >
                    {uniqueOwners.map((owner) => (
                      <option key={owner.value} value={owner.value}>
                        {owner.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className={productFieldLabelClassName}>
                City
                <select
                  value={cityFilter}
                  onChange={(event) => setCityFilter(event.target.value)}
                  className={`mt-2 ${productFieldClassName}`}
                >
                  {uniqueCities.map((city) => (
                    <option key={city} value={city}>
                      {city === "all" ? "All cities" : city}
                    </option>
                  ))}
                </select>
              </label>
              <label className={productFieldLabelClassName}>
                Follow-up
                <select
                  value={followUpFilter}
                  onChange={(event) => setFollowUpFilter(event.target.value)}
                  className={`mt-2 ${productFieldClassName}`}
                >
                  <option value="all">All</option>
                  <option value="overdue">Overdue</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="none">None</option>
                </select>
              </label>
              <label className={productFieldLabelClassName}>
                Appointment
                <select
                  value={appointmentFilter}
                  onChange={(event) => setAppointmentFilter(event.target.value)}
                  className={`mt-2 ${productFieldClassName}`}
                >
                  <option value="all">All</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="none">None</option>
                </select>
              </label>
            </div>
        </ProductFilterBar>
      </ProductHero>

      <ProductSection
        className="app-metal-table mt-6 border-[rgba(var(--app-primary-rgb),0.08)] shadow-panel"
        eyebrow="Lead Table"
        title="Filtered pipeline"
        description="Every filter here is URL-backed now, so you can refresh or share the exact view you’re working."
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.14em] text-[rgba(var(--app-primary-rgb),0.56)]">
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
            <tbody className="divide-y divide-[rgba(var(--app-primary-rgb),0.08)] text-slate-700">
              {items.map((item) => (
                <tr key={item.leadId}>
                  <td className="py-3 pr-4">
                    <div className="font-semibold text-ink">{item.contactName ?? item.address}</div>
                    <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">
                      {item.address}
                      {[item.city, item.state, item.postalCode].filter(Boolean).length
                        ? ` · ${[item.city, item.state, item.postalCode].filter(Boolean).join(", ")}`
                        : ""}
                    </div>
                    <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.58)]">{item.phone ?? item.email ?? "No contact yet"}</div>
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
                        onClick={() => trackAppEvent("leads.detail_opened", { leadId: item.leadId })}
                        className="app-glass-button rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(var(--app-primary-rgb),0.72)] transition hover:brightness-105"
                      >
                        Detail
                      </Link>
                      {item.propertyId ? (
                        <Link
                          href={`/properties/${item.propertyId}` as Route}
                          className="app-glass-button rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(var(--app-primary-rgb),0.72)] transition hover:brightness-105"
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
                  <td colSpan={isManager ? 7 : 6} className="py-6 text-center text-[rgba(var(--app-primary-rgb),0.6)]">
                    <ProductEmptyState
                      title="No leads match this filter"
                      description="Try widening the stage, city, or follow-up filters to bring more homeowners back into view."
                      className="border-0 bg-transparent p-0 shadow-none"
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </ProductSection>
    </div>
  );
}
