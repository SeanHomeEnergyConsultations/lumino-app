import { NextResponse } from "next/server";
import { createServerSupabaseAnonClient } from "@/lib/db/supabase-server";
import { maybeEscalateRepeatedSecurityEvent } from "@/lib/security/anomaly";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { getAppBaseUrl } from "@/lib/utils/env";
import { passwordResetRequestSchema } from "@/lib/validation/auth";

export const dynamic = "force-dynamic";

function getSafeResetRedirectUrl(request: Request, requestedRedirectTo?: string) {
  const appBaseUrl = getAppBaseUrl();
  const allowedOrigin = appBaseUrl ? new URL(appBaseUrl).origin : new URL(request.url).origin;
  const fallback = new URL("/set-password?mode=recovery", allowedOrigin);

  if (!requestedRedirectTo) {
    return fallback.toString();
  }

  try {
    const candidate = new URL(requestedRedirectTo);
    if (candidate.origin !== allowedOrigin) {
      return fallback.toString();
    }
    return candidate.toString();
  } catch {
    return fallback.toString();
  }
}

function getEmailDomain(email: string) {
  return email.split("@")[1] ?? null;
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = passwordResetRequestSchema.safeParse(json);

  if (!parsed.success) {
    await recordSecurityEvent({
      request,
      eventType: "auth_password_reset_invalid_payload",
      severity: "low",
      metadata: {
        issueCount: parsed.error.issues.length
      }
    });
    await maybeEscalateRepeatedSecurityEvent({
      request,
      signalEventType: "auth_password_reset_invalid_payload",
      anomalyEventType: "auth_password_reset_invalid_payload_repeated",
      threshold: 5,
      windowSeconds: 1800,
      severity: "high"
    });

    return NextResponse.json({ error: "Invalid password reset request." }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const rateLimit = await enforceRateLimit({
    request,
    bucket: `auth_password_reset:${email}`,
    limit: 3,
    windowSeconds: 3600,
    logEventType: "auth_password_reset_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many password reset requests. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const supabase = createServerSupabaseAnonClient();
  const redirectTo = getSafeResetRedirectUrl(request, parsed.data.redirectTo);
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo
  });

  if (error) {
    await recordSecurityEvent({
      request,
      eventType: "auth_password_reset_failed",
      severity: "medium",
      metadata: {
        emailDomain: getEmailDomain(email),
        reason: error.message.slice(0, 160)
      }
    });
    await maybeEscalateRepeatedSecurityEvent({
      request,
      signalEventType: "auth_password_reset_failed",
      anomalyEventType: "auth_password_reset_failures_repeated",
      threshold: 3,
      windowSeconds: 3600,
      severity: "high",
      metadata: {
        emailDomain: getEmailDomain(email)
      }
    });
  } else {
    await recordSecurityEvent({
      request,
      eventType: "auth_password_reset_requested",
      severity: "info",
      metadata: {
        emailDomain: getEmailDomain(email)
      }
    });
  }

  return NextResponse.json({
    ok: true
  });
}
