import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { createVisit } from "@/lib/db/mutations/visits";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { visitInputSchema } from "@/lib/validation/visits";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await getRequestSessionContext(request);
    if (!context) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = await enforceRateLimit({
      request,
      context,
      bucket: "visit_create",
      limit: 240,
      windowSeconds: 300,
      logEventType: "visit_create_rate_limit_exceeded"
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many visits logged too quickly. Please slow down and try again." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    const json = await request.json();
    const parsed = visitInputSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid visit payload",
          issues: parsed.error.flatten()
        },
        { status: 400 }
      );
    }

    const result = await createVisit(parsed.data, context);
    await recordSecurityEvent({
      request,
      context,
      eventType: "visit_logged",
      severity: "low",
      metadata: {
        visitId: result.visitId,
        propertyId: result.propertyId,
        outcome: parsed.data.outcome
      }
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to log visit"
      },
      { status: 500 }
    );
  }
}
