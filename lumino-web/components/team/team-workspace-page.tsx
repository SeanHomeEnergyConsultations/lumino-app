"use client";

import Link from "next/link";
import type { Route } from "next";
import { TeamBrandingSurface } from "@/components/team/team-branding-surface";
import { TeamOperationsSurface } from "@/components/team/team-operations-surface";
import { TeamTerritoriesSurface } from "@/components/team/team-territories-surface";
import { TeamWorkspaceProvider, useTeamWorkspace, type TeamWorkspaceSurface } from "@/components/team/team-workspace-context";

const TEAM_SURFACE_ROUTES: Record<TeamWorkspaceSurface, Route> = {
  operations: "/team",
  territories: "/team/territories",
  branding: "/team/branding"
};

function TeamWorkspaceContent({ surface }: { surface: TeamWorkspaceSurface }) {
  const { members, teams, territories, canEditBranding } = useTeamWorkspace();

  const surfaces = [
    {
      id: "operations" as const,
      label: "Operations",
      detail: `${members.length} members · ${teams.length} teams`
    },
    {
      id: "territories" as const,
      label: "Territories",
      detail: `${territories.length} territories`
    },
    ...(canEditBranding
      ? [
          {
            id: "branding" as const,
            label: "Branding",
            detail: "Theme, logo, and shell preview"
          }
        ]
      : [])
  ];

  return (
    <div className="p-4 md:p-6">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Team</div>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Roster, coaching, and territory control</h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">
          Keep reps visible, surface coaching risk quickly, and ground manager reporting in real territory assignments.
        </p>
      </div>

      <section className="mt-6 app-panel rounded-[2rem] border p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Workspace Surfaces</div>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Break management work into focused surfaces so staffing, territory planning, and brand controls do not compete on one page.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {surfaces.map((item) => {
              const active = surface === item.id;

              return (
                <Link
                  key={item.id}
                  href={TEAM_SURFACE_ROUTES[item.id]}
                  className={`rounded-[1.4rem] border px-4 py-3 text-left transition ${
                    active
                      ? "bg-[rgba(var(--app-primary-rgb),0.92)] text-white shadow-panel"
                      : "bg-white/75 text-slate-700 hover:border-slate-300 hover:bg-white"
                  }`}
                >
                  <div className="text-sm font-semibold">{item.label}</div>
                  <div className={`mt-1 text-xs ${active ? "text-white/75" : "text-slate-500"}`}>{item.detail}</div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {surface === "operations" ? <TeamOperationsSurface /> : null}
      {surface === "territories" ? <TeamTerritoriesSurface /> : null}
      {surface === "branding" && canEditBranding ? <TeamBrandingSurface /> : null}
    </div>
  );
}

export function TeamWorkspacePage({ surface }: { surface: TeamWorkspaceSurface }) {
  return (
    <TeamWorkspaceProvider>
      <TeamWorkspaceContent surface={surface} />
    </TeamWorkspaceProvider>
  );
}
