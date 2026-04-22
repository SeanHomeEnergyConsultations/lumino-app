import { NextResponse } from "next/server";
import { hasAdminAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { updateTeam } from "@/lib/db/mutations/team";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { teamUpdateSchema } from "@/lib/validation/team";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const context = await getRequestSessionContext(request);
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasAdminAccess(context)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const json = await request.json();
    const parsed = teamUpdateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid team payload", issues: parsed.error.flatten() }, { status: 400 });
    }

    const { teamId } = await params;
    const result = await updateTeam(teamId, parsed.data, context);
    await recordSecurityEvent({
      request,
      context,
      eventType: "team_updated",
      severity: "medium",
      metadata: {
        teamId,
        name: parsed.data.name ?? null,
        managerUserId: typeof parsed.data.managerUserId !== "undefined" ? parsed.data.managerUserId : null
      }
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update team." },
      { status: 500 }
    );
  }
}
