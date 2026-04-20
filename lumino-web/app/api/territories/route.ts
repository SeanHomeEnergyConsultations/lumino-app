import { NextResponse } from "next/server";
import { hasManagerAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { createTerritory } from "@/lib/db/mutations/territories";
import { getTerritories } from "@/lib/db/queries/territories";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { territoryInputSchema } from "@/lib/validation/territories";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items = await getTerritories(context);
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasManagerAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "territory_create",
    limit: 40,
    windowSeconds: 3600,
    logEventType: "territory_create_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many territory changes. Please wait before creating another territory." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json();
  const parsed = territoryInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid territory payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const result = await createTerritory(parsed.data, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "territory_created",
    severity: "medium",
    metadata: {
      territoryId: result.territoryId,
      name: parsed.data.name,
      status: parsed.data.status
    }
  });
  return NextResponse.json(result);
}
