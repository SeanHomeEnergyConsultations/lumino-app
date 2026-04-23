"use client";

import type { Route } from "next";
import { Building2, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { PlatformDatasetsSurface } from "@/components/platform/platform-datasets-surface";
import { PlatformOrganizationsSurface } from "@/components/platform/platform-organizations-surface";
import { PlatformSecuritySurface } from "@/components/platform/platform-security-surface";
import { WorkspaceHero, WorkspaceMetricGrid, WorkspaceSwitcher } from "@/components/shared/workspace-primitives";
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
      <WorkspaceHero
        eyebrow="Platform"
        title="Owner Control Center"
        description="Run organization packaging, shared data distribution, and platform security from distinct owner-only surfaces."
        action={
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
        }
      />

      {message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
      ) : null}
      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <WorkspaceSwitcher
        title="Workspace Surfaces"
        description="Keep platform work split by job so org packaging, dataset distribution, and security triage do not collapse into one owner page."
        activeSurface={surface}
        items={surfaces.map((item) => ({
          ...item,
          href: PLATFORM_SURFACE_ROUTES[item.id]
        }))}
      />

      <WorkspaceMetricGrid
        items={metrics.map((metric) => ({
          ...metric,
          value: loading ? "…" : metric.value,
          tone: "glass" as const
        }))}
      />

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
