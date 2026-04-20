import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestSessionContext } from "@/lib/auth/server";
import { createRouteRun } from "@/lib/db/mutations/routes";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";

const routeRunCreateSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(25),
  startedFromLat: z.number(),
  startedFromLng: z.number(),
  startedFromLabel: z.string().trim().max(255).nullable().optional(),
  optimizationMode: z.enum(["drive_time", "mileage"]).optional()
});

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
      bucket: "route_run_create",
      limit: 30,
      windowSeconds: 300,
      logEventType: "route_run_create_rate_limit_exceeded"
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many route builds in a short time. Please wait a moment and try again." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    const parsed = routeRunCreateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid route run payload",
          issues: parsed.error.flatten()
        },
        { status: 400 }
      );
    }

    const result = await createRouteRun(parsed.data, context);
    await recordSecurityEvent({
      request,
      context,
      eventType: "route_run_created",
      severity: "low",
      metadata: {
        routeRunId: result.routeRunId,
        selectedLeadCount: parsed.data.leadIds.length,
        totalStops: result.totalStops
      }
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create route run" },
      { status: 500 }
    );
  }
}
