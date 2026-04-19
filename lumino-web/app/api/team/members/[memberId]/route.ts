import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { deleteTeamMember, triggerTeamMemberAccessEmail, updateTeamMember } from "@/lib/db/mutations/team";
import { teamMemberActionSchema, teamMemberUpdateSchema } from "@/lib/validation/team";

function canManageTeam(roles: string[]) {
  return roles.some((role) => ["owner", "admin", "manager"].includes(role));
}

function canDeleteTeamMembers(roles: string[]) {
  return roles.some((role) => ["owner", "admin"].includes(role));
}

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageTeam(context.memberships.map((item) => item.role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await request.json();
  const parsed = teamMemberUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid team update payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { memberId } = await params;
  const result = await updateTeamMember(memberId, parsed.data, context);
  return NextResponse.json(result);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageTeam(context.memberships.map((item) => item.role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await request.json();
  const parsed = teamMemberActionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid team action payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { memberId } = await params;
  const origin = new URL(request.url).origin;
  const redirectTo =
    parsed.data.action === "resend_invite"
      ? `${origin}/set-password?mode=invite`
      : `${origin}/set-password?mode=recovery`;

  const result = await triggerTeamMemberAccessEmail(memberId, parsed.data.action, context, redirectTo);
  return NextResponse.json(result);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canDeleteTeamMembers(context.memberships.map((item) => item.role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { memberId } = await params;
  const result = await deleteTeamMember(memberId, context);
  return NextResponse.json(result);
}
