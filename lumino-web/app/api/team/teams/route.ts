import { NextResponse } from "next/server";
import { hasAdminAccess, hasManagerAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { createTeam } from "@/lib/db/mutations/team";
import { getTeams } from "@/lib/db/queries/team";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { teamCreateSchema } from "@/lib/validation/team";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await getRequestSessionContext(request);
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasManagerAccess(context)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const items = await getTeams(context);
    return NextResponse.json(items);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load teams." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await getRequestSessionContext(request);
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasAdminAccess(context)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const json = await request.json();
    const parsed = teamCreateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid team payload", issues: parsed.error.flatten() }, { status: 400 });
    }

    const result = await createTeam(parsed.data, context);
    await recordSecurityEvent({
      request,
      context,
      eventType: "team_created",
      severity: "medium",
      metadata: {
        teamId: result.teamId,
        name: parsed.data.name,
        managerUserId: parsed.data.managerUserId ?? null
      }
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create team." },
      { status: 500 }
    );
  }
}
