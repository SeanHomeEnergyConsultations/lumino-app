import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { searchEntities } from "@/lib/db/queries/search";
import { maybeEscalateRepeatedSecurityEvent } from "@/lib/security/anomaly";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";

export const dynamic = "force-dynamic";

function getSuspiciousSearchSignals(query: string) {
  const trimmed = query.trim();
  return {
    looksLikeEmail: trimmed.includes("@"),
    looksLikePhone: /\d{7,}/.test(trimmed.replace(/\D/g, "")),
    looksLikeWildcardProbe: /[%_*]/.test(trimmed)
  };
}

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "search",
    limit: 60,
    windowSeconds: 60,
    logEventType: "search_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many search requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const suspiciousSignals = getSuspiciousSearchSignals(q);

  if (
    suspiciousSignals.looksLikeEmail ||
    suspiciousSignals.looksLikePhone ||
    suspiciousSignals.looksLikeWildcardProbe
  ) {
    await recordSecurityEvent({
      request,
      context,
      eventType: "search_suspicious_query",
      severity: "low",
      metadata: {
        queryLength: q.trim().length,
        looksLikeEmail: suspiciousSignals.looksLikeEmail,
        looksLikePhone: suspiciousSignals.looksLikePhone,
        looksLikeWildcardProbe: suspiciousSignals.looksLikeWildcardProbe
      }
    });
    await maybeEscalateRepeatedSecurityEvent({
      request,
      context,
      signalEventType: "search_suspicious_query",
      anomalyEventType: "search_enumeration_detected",
      threshold: 5,
      windowSeconds: 900,
      severity: "high",
      metadata: {
        queryLength: q.trim().length
      }
    });
  }

  const results = await searchEntities(q, context);
  return NextResponse.json(results);
}
