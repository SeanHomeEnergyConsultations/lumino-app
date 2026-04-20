import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestSessionContext } from "@/lib/auth/server";
import { skipRouteRunStop } from "@/lib/db/mutations/routes";
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

    const parsed = routeStopUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update route stop" },
      { status: 500 }
    );
  }
}
