import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { resolveOrCreateProperty } from "@/lib/db/mutations/properties";
import { maybeEscalateRepeatedSecurityEvent } from "@/lib/security/anomaly";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { resolvePropertyInputSchema } from "@/lib/validation/properties";
import { z } from "zod";

export const dynamic = "force-dynamic";

const propertyResolveRequestSchema = resolvePropertyInputSchema.extend({
  persist: z.boolean().optional()
});

export async function POST(request: Request) {
  let context = null;
  try {
    context = await getRequestSessionContext(request);
    if (!context) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = await enforceRateLimit({
      request,
      context,
      bucket: "property_resolve",
      limit: 40,
      windowSeconds: 60,
      logEventType: "property_resolve_rate_limit_exceeded"
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many property resolve requests. Please wait a moment and try again." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    const json = await request.json();
    const parsed = propertyResolveRequestSchema.safeParse(json);

    if (!parsed.success) {
      await recordSecurityEvent({
        request,
        context,
        eventType: "property_resolve_invalid_payload",
        severity: "low",
        metadata: {
          issueCount: parsed.error.issues.length
        }
      });
      await maybeEscalateRepeatedSecurityEvent({
        request,
        context,
        signalEventType: "property_resolve_invalid_payload",
        anomalyEventType: "property_resolve_invalid_payload_repeated",
        threshold: 5,
        windowSeconds: 900,
        severity: "high"
      });
      return NextResponse.json(
        {
          error: "Invalid property resolve payload",
          issues: parsed.error.flatten()
        },
        { status: 400 }
      );
    }

    const result = await resolveOrCreateProperty(parsed.data, context);
    return NextResponse.json(result);
  } catch (error) {
    await recordSecurityEvent({
      request,
      context,
      eventType: "property_resolve_failed",
      severity: "medium",
      metadata: {
        error:
          error instanceof Error
            ? error.message.slice(0, 200)
            : "Unknown property resolve failure"
      }
    }).catch((securityError) => {
      console.error("Failed to record property_resolve_failed event", securityError);
    });
    await maybeEscalateRepeatedSecurityEvent({
      request,
      context,
      signalEventType: "property_resolve_failed",
      anomalyEventType: "property_resolve_failures_repeated",
      threshold: 3,
      windowSeconds: 900,
      severity: "high"
    }).catch((securityError) => {
      console.error("Failed to escalate repeated property resolve failures", securityError);
    });
    console.error("[api/properties/resolve] request:error", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to resolve property"
      },
      { status: 500 }
    );
  }
}
