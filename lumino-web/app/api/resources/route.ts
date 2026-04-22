import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { createResource } from "@/lib/db/mutations/resources";
import { getResourcesLibrary } from "@/lib/db/queries/resources";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { resourceCreateSchema } from "@/lib/validation/resources";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const library = await getResourcesLibrary(context);
  return NextResponse.json(library);
}

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "resource_create",
    limit: 80,
    windowSeconds: 3600,
    logEventType: "resource_create_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many resource changes. Please wait before adding another material." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json();
  const parsed = resourceCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid resource payload", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await createResource(parsed.data, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "resource_created",
    severity: "low",
    metadata: {
      resourceId: result.resourceId,
      resourceType: parsed.data.resourceType,
      territoryId: parsed.data.territoryId ?? null
    }
  });

  return NextResponse.json(result);
}
