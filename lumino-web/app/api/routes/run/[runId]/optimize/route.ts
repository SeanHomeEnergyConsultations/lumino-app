import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestSessionContext } from "@/lib/auth/server";
import { optimizeRemainingRouteRunStops } from "@/lib/db/mutations/routes";
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

    const parsed = optimizeRouteRunSchema.safeParse(await request.json());
    if (!parsed.success) {
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to optimize route run" },
      { status: 500 }
    );
  }
}
