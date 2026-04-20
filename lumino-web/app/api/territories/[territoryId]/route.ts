import { NextResponse } from "next/server";
import { hasManagerAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { updateTerritory } from "@/lib/db/mutations/territories";
import { getTerritoryDetail } from "@/lib/db/queries/territories";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { territoryInputSchema } from "@/lib/validation/territories";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ territoryId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { territoryId } = await params;
  const item = await getTerritoryDetail(territoryId, context);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ item });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ territoryId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasManagerAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "territory_update",
    limit: 80,
    windowSeconds: 3600,
    logEventType: "territory_update_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many territory updates. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json();
  const parsed = territoryInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid territory payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { territoryId } = await params;
  const previous = await getTerritoryDetail(territoryId, context);
  if (!previous) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const result = await updateTerritory(territoryId, parsed.data, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "territory_updated",
    severity: "medium",
    metadata: {
      territoryId,
      previousName: previous.name,
      previousStatus: previous.status,
      name: parsed.data.name,
      status: parsed.data.status
    }
  });
  return NextResponse.json(result);
}
