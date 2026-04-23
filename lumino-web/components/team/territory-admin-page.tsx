"use client";

import { TeamWorkspacePage } from "@/components/team/team-workspace-page";
import type { TeamWorkspaceSurface } from "@/components/team/team-workspace-context";

export function TerritoryAdminPage({
  surface = "operations"
}: {
  surface?: TeamWorkspaceSurface;
}) {
  return <TeamWorkspacePage surface={surface} />;
}
