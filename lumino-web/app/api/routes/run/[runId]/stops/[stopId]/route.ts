import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestSessionContext } from "@/lib/auth/server";
import { skipRouteRunStop } from "@/lib/db/mutations/routes";
import { maybeEscalateRepeatedSecurityEvent } from "@/lib/security/anomaly";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";

const routeStopUpdateSchema = z.object({
  action: z.enum(["skip"]),
  skippedReason: z.string().trim().max(2000).nullable().optional()
});

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ runId: string; stopId: string }> }
) {
  try {
    const context = await getRequestSessionContext(request);
    if (!context) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = await enforceRateLimit({
      request,
      context,
      bucket: "route_stop_skip",
      limit: 240,
      windowSeconds: 3600,
      logEventType: "route_stop_skip_rate_limit_exceeded"
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many route stop updates. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    const parsed = routeStopUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      await recordSecurityEvent({
        request,
        context,
        eventType: "route_stop_skip_invalid_payload",
        severity: "low",
        metadata: {
          issueCount: parsed.error.issues.length
        }
      });
      await maybeEscalateRepeatedSecurityEvent({
        request,
        context,
        signalEventType: "route_stop_skip_invalid_payload",
        anomalyEventType: "route_stop_skip_invalid_payload_repeated",
        threshold: 5,
        windowSeconds: 1800,
        severity: "high"
      });
      return NextResponse.json(
        {
          error: "Invalid route stop action",
          issues: parsed.error.flatten()
        },
        { status: 400 }
      );
    }

    const resolvedParams = await params;

    await skipRouteRunStop({
      routeRunId: resolvedParams.runId,
      routeRunStopId: resolvedParams.stopId,
      skippedReason: parsed.data.skippedReason ?? null,
      context
    });

    await recordSecurityEvent({
      request,
      context,
      eventType: "route_stop_skipped",
      severity: "low",
      metadata: {
        routeRunId: resolvedParams.runId,
        routeRunStopId: resolvedParams.stopId
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    await recordSecurityEvent({
      request,
      context: null,
      eventType: "route_stop_skip_failed",
      severity: "medium",
      metadata: {
        error: error instanceof Error ? error.message.slice(0, 200) : "Unknown route stop update failure"
      }
    }).catch(() => undefined);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update route stop" },
      { status: 500 }
    );
  }
}
