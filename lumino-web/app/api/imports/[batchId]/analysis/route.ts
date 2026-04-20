import { NextResponse } from "next/server";
import { z } from "zod";
import { hasManagerAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { runImportBatchAnalysis } from "@/lib/db/mutations/imports";
import { maybeEscalateRepeatedSecurityEvent } from "@/lib/security/anomaly";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";

const schema = z.object({
  action: z.enum(["run", "retry_failed"]).default("run")
});

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Failed to analyze import batch.";
}

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  let context = null;
  let batchId = "";
  try {
    context = await getRequestSessionContext(request);
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasManagerAccess(context)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rateLimit = await enforceRateLimit({
      request,
      context,
      bucket: "imports_analysis",
      limit: 90,
      windowSeconds: 600,
      logEventType: "import_analysis_rate_limit_exceeded"
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many analysis runs. Please wait before retrying this batch." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      await recordSecurityEvent({
        request,
        context,
        eventType: "import_analysis_invalid_payload",
        severity: "low"
      });
      await maybeEscalateRepeatedSecurityEvent({
        request,
        context,
        signalEventType: "import_analysis_invalid_payload",
        anomalyEventType: "import_analysis_invalid_payload_repeated",
        threshold: 5,
        windowSeconds: 1800,
        severity: "high"
      });
      return NextResponse.json({ error: "Invalid analysis payload" }, { status: 400 });
    }

    ({ batchId } = await params);
    const result = await runImportBatchAnalysis(batchId, context, {
      retryFailed: parsed.data.action === "retry_failed"
    });
    await recordSecurityEvent({
      request,
      context,
      eventType: parsed.data.action === "retry_failed" ? "import_analysis_retry_started" : "import_analysis_started",
      severity: "info",
      metadata: {
        batchId,
        action: parsed.data.action
      }
    });
    return NextResponse.json(result);
  } catch (error) {
    await recordSecurityEvent({
      request,
      context,
      eventType: "import_analysis_failed",
      severity: "medium",
      metadata: {
        batchId: batchId || null,
        error: errorMessage(error).slice(0, 200)
      }
    }).catch((securityError) => {
      console.error("Failed to record import_analysis_failed security event", securityError);
    });
    await maybeEscalateRepeatedSecurityEvent({
      request,
      context,
      signalEventType: "import_analysis_failed",
      anomalyEventType: "import_analysis_failures_repeated",
      threshold: 3,
      windowSeconds: 1800,
      severity: "high",
      metadata: {
        batchId: batchId || null
      }
    }).catch((securityError) => {
      console.error("Failed to escalate repeated import analysis failures", securityError);
    });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500 }
    );
  }
}
