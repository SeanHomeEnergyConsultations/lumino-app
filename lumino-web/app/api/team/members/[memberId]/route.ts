import { NextResponse } from "next/server";
import { hasAdminAccess, hasManagerAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import {
  deleteTeamMemberAccount,
  removeTeamMember,
  triggerTeamMemberAccessEmail,
  updateTeamMember
} from "@/lib/db/mutations/team";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { teamMemberActionSchema, teamMemberUpdateSchema } from "@/lib/validation/team";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const context = await getRequestSessionContext(request);
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasManagerAccess(context)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const json = await request.json();
    const parsed = teamMemberUpdateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid team update payload", issues: parsed.error.flatten() }, { status: 400 });
    }

    const { memberId } = await params;
    const result = await updateTeamMember(memberId, parsed.data, context);
    await recordSecurityEvent({
      request,
      context,
      eventType: "team_member_updated",
      severity: "medium",
      metadata: {
        memberId,
        role: parsed.data.role ?? null,
        isActive: parsed.data.isActive ?? null
      }
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update team member." },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const context = await getRequestSessionContext(request);
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasManagerAccess(context)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const json = await request.json();
    const parsed = teamMemberActionSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid team action payload", issues: parsed.error.flatten() }, { status: 400 });
    }

    const rateLimit = await enforceRateLimit({
      request,
      context,
      bucket: "team_access_email",
      limit: 6,
      windowSeconds: 3600,
      logEventType: "team_access_email_rate_limit_exceeded"
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many invite or reset emails sent recently. Please wait and try again." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    const { memberId } = await params;
    const result = await triggerTeamMemberAccessEmail(memberId, parsed.data.action, context, "");
    await recordSecurityEvent({
      request,
      context,
      eventType: parsed.data.action === "resend_invite" ? "team_invite_resent" : "team_password_reset_sent",
      severity: "medium",
      metadata: {
        memberId,
        action: parsed.data.action
      }
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send access email." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const context = await getRequestSessionContext(request);
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasAdminAccess(context)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { memberId } = await params;
    const mode = new URL(request.url).searchParams.get("mode") ?? "remove";
    const result =
      mode === "account"
        ? await deleteTeamMemberAccount(memberId, context)
        : await removeTeamMember(memberId, context);
    await recordSecurityEvent({
      request,
      context,
      eventType: mode === "account" ? "team_member_account_deleted" : "team_member_removed",
      severity: "high",
      metadata: {
        memberId,
        mode
      }
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete team member." },
      { status: 500 }
    );
  }
}
