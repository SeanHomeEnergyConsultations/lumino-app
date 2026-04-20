import { NextResponse } from "next/server";
import { hasManagerAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import {
  assignPropertyToTerritory,
  removePropertyFromTerritory
} from "@/lib/db/mutations/territories";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { territoryAssignmentSchema } from "@/lib/validation/territories";

export const dynamic = "force-dynamic";

export async function POST(
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
    bucket: "territory_property_assign",
    limit: 200,
    windowSeconds: 3600,
    logEventType: "territory_property_assign_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many territory assignment changes. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json();
  const parsed = territoryAssignmentSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid property assignment payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { territoryId } = await params;
  await assignPropertyToTerritory(territoryId, parsed.data.propertyId, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "territory_property_assigned",
    severity: "low",
    metadata: {
      territoryId,
      propertyId: parsed.data.propertyId
    }
  });
  return NextResponse.json({ territoryId, propertyId: parsed.data.propertyId });
}

export async function DELETE(
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
    bucket: "territory_property_remove",
    limit: 200,
    windowSeconds: 3600,
    logEventType: "territory_property_remove_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many territory assignment changes. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json();
  const parsed = territoryAssignmentSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid property removal payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { territoryId } = await params;
  await removePropertyFromTerritory(territoryId, parsed.data.propertyId, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "territory_property_removed",
    severity: "low",
    metadata: {
      territoryId,
      propertyId: parsed.data.propertyId
    }
  });
  return NextResponse.json({ territoryId, propertyId: parsed.data.propertyId });
}
