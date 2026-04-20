import { NextResponse } from "next/server";
import { hasAdminAccess, hasManagerAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { inviteTeamMember } from "@/lib/db/mutations/team";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { getTeamMembers } from "@/lib/db/queries/team";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { teamInviteSchema } from "@/lib/validation/team";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await getRequestSessionContext(request);
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasManagerAccess(context)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
    if (!hasManagerAccess(context)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const json = await request.json();
    const parsed = teamInviteSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid invite payload", issues: parsed.error.flatten() }, { status: 400 });
    }

    if (!hasAdminAccess(context) && !["rep", "setter"].includes(parsed.data.role)) {
      return NextResponse.json(
        { error: "Only admins can invite managers, admins, or owners." },
        { status: 403 }
      );
    }

    const rateLimit = await enforceRateLimit({
      request,
      context,
      bucket: "team_member_invite",
      limit: 10,
      windowSeconds: 3600,
      logEventType: "team_member_invite_rate_limit_exceeded"
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many team invites sent recently. Please wait and try again." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    const result = await inviteTeamMember(parsed.data, context);
    await recordSecurityEvent({
      request,
      context,
      eventType: "team_member_invited",
      severity: "medium",
      targetUserId: result.userId,
      metadata: {
        memberId: result.memberId,
        role: parsed.data.role,
        email: parsed.data.email,
        accessEmailType: result.accessEmailType
      }
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to invite team member." },
      { status: 500 }
    );
  }
}
