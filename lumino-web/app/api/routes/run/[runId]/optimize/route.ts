import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestSessionContext } from "@/lib/auth/server";
import { optimizeRemainingRouteRunStops } from "@/lib/db/mutations/routes";
import { maybeEscalateRepeatedSecurityEvent } from "@/lib/security/anomaly";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";

const optimizeRouteRunSchema = z.object({
  originLat: z.number(),
  originLng: z.number(),
  optimizationMode: z.enum(["drive_time", "mileage"]).optional()
});

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const context = await getRequestSessionContext(request);
    if (!context) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = await enforceRateLimit({
      request,
      context,
      bucket: "route_run_optimize",
      limit: 30,
      windowSeconds: 3600,
      logEventType: "route_run_optimize_rate_limit_exceeded"
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many route optimization attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    const parsed = optimizeRouteRunSchema.safeParse(await request.json());
    if (!parsed.success) {
      await recordSecurityEvent({
        request,
        context,
        eventType: "route_run_optimize_invalid_payload",
        severity: "low",
        metadata: {
          issueCount: parsed.error.issues.length
        }
      });
      await maybeEscalateRepeatedSecurityEvent({
        request,
        context,
        signalEventType: "route_run_optimize_invalid_payload",
        anomalyEventType: "route_run_optimize_invalid_payload_repeated",
        threshold: 5,
        windowSeconds: 1800,
        severity: "high"
      });
      return NextResponse.json(
        {
          error: "Invalid route optimization payload",
          issues: parsed.error.flatten()
        },
        { status: 400 }
      );
    }

    const resolvedParams = await params;
    const result = await optimizeRemainingRouteRunStops({
      routeRunId: resolvedParams.runId,
      originLat: parsed.data.originLat,
      originLng: parsed.data.originLng,
      optimizationMode: parsed.data.optimizationMode,
      context
    });

    await recordSecurityEvent({
      request,
      context,
      eventType: "route_run_reoptimized",
      severity: "low",
      metadata: {
        routeRunId: resolvedParams.runId,
        updatedStops: result.updatedStops,
        optimizationMode: parsed.data.optimizationMode ?? "drive_time"
      }
    });

    return NextResponse.json(result);
  } catch (error) {
    await recordSecurityEvent({
      request,
      context: null,
      eventType: "route_run_optimize_failed",
      severity: "medium",
      metadata: {
        error: error instanceof Error ? error.message.slice(0, 200) : "Unknown route optimize failure"
      }
    }).catch(() => undefined);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to optimize route run" },
      { status: 500 }
    );
  }
}
