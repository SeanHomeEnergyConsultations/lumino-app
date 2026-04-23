"use client";

import Link from "next/link";
import type { Route } from "next";
import { Building2, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { PlatformDatasetsSurface } from "@/components/platform/platform-datasets-surface";
import { PlatformOrganizationsSurface } from "@/components/platform/platform-organizations-surface";
import { PlatformSecuritySurface } from "@/components/platform/platform-security-surface";
import {
  PlatformWorkspaceProvider,
  usePlatformWorkspace,
  type PlatformWorkspaceSurface
} from "@/components/platform/platform-workspace-context";

const PLATFORM_SURFACE_ROUTES: Record<PlatformWorkspaceSurface, Route> = {
  organizations: "/platform",
  datasets: "/platform/datasets",
  security: "/platform/security"
};

function PlatformWorkspaceContent({ surface }: { surface: PlatformWorkspaceSurface }) {
  const { datasets, error, events, items, loading, message, refreshWorkspace, refreshing } = usePlatformWorkspace();

  const surfaces = [
    {
      id: "organizations" as const,
      label: "Organizations",
      detail: `${items.length} orgs · ${items.filter((item) => item.status === "active").length} active`,
      icon: Building2
    },
    {
      id: "datasets" as const,
      label: "Datasets",
      detail: `${datasets.length} shared datasets`,
      icon: Sparkles
    },
    {
      id: "security" as const,
      label: "Security",
      detail: `${events.filter((event) => event.severity === "high").length} high severity events`,
      icon: ShieldCheck
    }
  ];

  const metrics = [
    {
      label: "Organizations",
      value: items.length,
      detail: `${items.filter((item) => item.status === "active").length} active`
    },
    {
      label: "Active Team Members",
      value: items.reduce((sum, item) => sum + item.activeTeamMemberCount, 0),
      detail: `${items.reduce((sum, item) => sum + item.adminCount, 0)} admins`
    },
    {
      label: "Published Datasets",
      value: datasets.length,
      detail: `${datasets.reduce((sum, dataset) => sum + dataset.grants.length, 0)} active grants`
    },
    {
      label: "Security Events",
      value: events.length,
      detail: `${events.filter((event) => event.severity === "high").length} high severity`
    }
  ];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-panel backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-mist">Platform</div>
            <h1 className="mt-3 text-3xl font-semibold text-ink">Owner Control Center</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">
              Run organization packaging, shared data distribution, and platform security from distinct owner-only surfaces.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void refreshWorkspace();
            }}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {message ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : null}
      </section>

      <section className="app-panel rounded-[2rem] border p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Workspace Surfaces</div>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Keep platform work split by job so org packaging, dataset distribution, and security triage do not collapse into one owner page.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {surfaces.map((item) => {
              const active = surface === item.id;
              const Icon = item.icon;

              return (
                <Link
                  key={item.id}
                  href={PLATFORM_SURFACE_ROUTES[item.id]}
                  className={`rounded-[1.4rem] border px-4 py-3 text-left transition ${
                    active
                      ? "bg-[rgba(var(--app-primary-rgb),0.92)] text-white shadow-panel"
                      : "bg-white/75 text-slate-700 hover:border-slate-300 hover:bg-white"
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </div>
                  <div className={`mt-1 text-xs ${active ? "text-white/75" : "text-slate-500"}`}>{item.detail}</div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 text-left shadow-panel backdrop-blur"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">{metric.label}</div>
            <div className="mt-3 text-3xl font-semibold text-ink">{loading ? "…" : metric.value}</div>
            <div className="mt-2 text-sm text-slate-500">{metric.detail}</div>
          </div>
        ))}
      </section>

      {surface === "organizations" ? <PlatformOrganizationsSurface /> : null}
      {surface === "datasets" ? <PlatformDatasetsSurface /> : null}
      {surface === "security" ? <PlatformSecuritySurface /> : null}
    </div>
  );
}

export function PlatformWorkspacePage({ surface }: { surface: PlatformWorkspaceSurface }) {
  return (
    <PlatformWorkspaceProvider>
      <PlatformWorkspaceContent surface={surface} />
    </PlatformWorkspaceProvider>
  );
}
