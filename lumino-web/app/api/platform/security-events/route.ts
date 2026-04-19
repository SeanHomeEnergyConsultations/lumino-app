import { NextResponse } from "next/server";
import { hasPlatformAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { getPlatformSecurityEvents } from "@/lib/db/queries/platform";

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
