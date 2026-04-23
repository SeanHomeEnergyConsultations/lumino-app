"use client";

import type { Route } from "next";
import { TeamBrandingSurface } from "@/components/team/team-branding-surface";
import { TeamOperationsSurface } from "@/components/team/team-operations-surface";
import { TeamTerritoriesSurface } from "@/components/team/team-territories-surface";
import { WorkspaceHero, WorkspaceSwitcher } from "@/components/shared/workspace-primitives";
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
      <WorkspaceHero
        eyebrow="Team"
        title="Roster, coaching, and territory control"
        description="Keep reps visible, surface coaching risk quickly, and ground manager reporting in real territory assignments."
      />

      <div className="mt-6">
        <WorkspaceSwitcher
          title="Workspace Surfaces"
          description="Break management work into focused surfaces so staffing, territory planning, and brand controls do not compete on one page."
          activeSurface={surface}
          items={surfaces.map((item) => ({
            ...item,
            href: TEAM_SURFACE_ROUTES[item.id]
          }))}
        />
      </div>

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
