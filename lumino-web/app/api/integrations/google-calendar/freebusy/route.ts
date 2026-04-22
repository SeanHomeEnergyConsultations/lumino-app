import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { checkGoogleCalendarConflicts } from "@/lib/google-calendar/service";
import { maybeEscalateRepeatedSecurityEvent } from "@/lib/security/anomaly";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { googleCalendarConflictCheckSchema } from "@/lib/validation/google-calendar";
import type { GoogleCalendarConflictCheckResponse } from "@/types/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "google_calendar_freebusy",
    limit: 120,
    windowSeconds: 3600,
    logEventType: "google_calendar_freebusy_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many calendar conflict checks. Please wait before checking again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json().catch(() => ({}));
  const parsed = googleCalendarConflictCheckSchema.safeParse(json);
  if (!parsed.success) {
    await recordSecurityEvent({
      request,
      context,
      eventType: "google_calendar_freebusy_invalid_payload",
      severity: "low",
      metadata: {
        issueCount: parsed.error.issues.length
      }
    });
    await maybeEscalateRepeatedSecurityEvent({
      request,
      context,
      signalEventType: "google_calendar_freebusy_invalid_payload",
      anomalyEventType: "google_calendar_freebusy_invalid_payload_repeated",
      threshold: 5,
      windowSeconds: 1800,
      severity: "high"
    });
    return NextResponse.json({ error: "Invalid Google Calendar conflict payload" }, { status: 400 });
  }

  try {
    const result = await checkGoogleCalendarConflicts({
      context,
      startAt: parsed.data.startAt,
      endAt: parsed.data.endAt ?? null
    });

    return NextResponse.json(result satisfies GoogleCalendarConflictCheckResponse);
  } catch (error) {
    await recordSecurityEvent({
      request,
      context,
      eventType: "google_calendar_freebusy_failed",
      severity: "medium",
      metadata: {
        error:
          error instanceof Error
            ? error.message.slice(0, 200)
            : "Unknown Google Calendar freebusy failure"
      }
    });
    await maybeEscalateRepeatedSecurityEvent({
      request,
      context,
      signalEventType: "google_calendar_freebusy_failed",
      anomalyEventType: "google_calendar_freebusy_failures_repeated",
      threshold: 3,
      windowSeconds: 1800,
      severity: "high"
    });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to check Google Calendar availability."
      },
      { status: 400 }
    );
  }
}
