import { NextResponse } from "next/server";
import { hasPlatformAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { getPlatformSecurityEvents } from "@/lib/db/queries/platform";
import { recordSecurityEvent } from "@/lib/security/security-events";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPlatformAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const items = await getPlatformSecurityEvents(context, {
    organizationId: searchParams.get("organizationId"),
    severity: searchParams.get("severity"),
    eventType: searchParams.get("eventType"),
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined
  });

  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!context.isPlatformOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await recordSecurityEvent({
    request,
    context,
    eventType: "platform_security_alert_test",
    severity: "high",
    triggerAlert: true,
    metadata: {
      source: "platform_control_center",
      note: "Controlled test alert triggered by platform owner."
    }
  });

  return NextResponse.json({ ok: true });
}
