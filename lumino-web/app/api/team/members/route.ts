import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { inviteTeamMember } from "@/lib/db/mutations/team";
import { getTeamMembers } from "@/lib/db/queries/team";
import { teamInviteSchema } from "@/lib/validation/team";

function canManageTeam(roles: string[]) {
  return roles.some((role) => ["owner", "admin", "manager"].includes(role));
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await getRequestSessionContext(request);
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const items = await getTeamMembers(context);
    return NextResponse.json(items);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load team members." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await getRequestSessionContext(request);
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canManageTeam(context.memberships.map((item) => item.role))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const json = await request.json();
    const parsed = teamInviteSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid invite payload", issues: parsed.error.flatten() }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const result = await inviteTeamMember(parsed.data, context, `${origin}/set-password?mode=invite`);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to invite team member." },
      { status: 500 }
    );
  }
}
