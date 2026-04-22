import { NextResponse } from "next/server";
import { hasManagerAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { createPerformanceCompetition } from "@/lib/db/mutations/performance";
import { getPerformanceHub } from "@/lib/db/queries/performance";
import { maybeEscalateRepeatedSecurityEvent } from "@/lib/security/anomaly";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { performanceCompetitionInputSchema } from "@/lib/validation/performance";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hub = await getPerformanceHub(context);
  return NextResponse.json(hub);
}

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasManagerAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "performance_competition_create",
    limit: 20,
    windowSeconds: 3600,
    logEventType: "performance_competition_create_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many competition changes. Please wait before creating another competition." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json();
  const parsed = performanceCompetitionInputSchema.safeParse(json);
  if (!parsed.success) {
    await recordSecurityEvent({
      request,
      context,
      eventType: "performance_competition_invalid_payload",
      severity: "low",
      metadata: {
        issueCount: parsed.error.issues.length
      }
    });
    await maybeEscalateRepeatedSecurityEvent({
      request,
      context,
      signalEventType: "performance_competition_invalid_payload",
      anomalyEventType: "performance_competition_invalid_payload_repeated",
      threshold: 5,
      windowSeconds: 1800,
      severity: "high"
    });
    return NextResponse.json(
      {
        error: "Invalid competition payload",
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const result = await createPerformanceCompetition(parsed.data, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "performance_competition_created",
    severity: "medium",
    metadata: {
      metric: parsed.data.metric,
      scope: parsed.data.scope,
      periodType: parsed.data.periodType,
      startAt: parsed.data.startAt,
      endAt: parsed.data.endAt
    }
  });
  return NextResponse.json(result);
}
