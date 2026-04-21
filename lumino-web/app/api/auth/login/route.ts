import { NextResponse } from "next/server";
import { createServerSupabaseAnonClient } from "@/lib/db/supabase-server";
import { maybeEscalateRepeatedSecurityEvent } from "@/lib/security/anomaly";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { loginRequestSchema } from "@/lib/validation/auth";

export const dynamic = "force-dynamic";

function getEmailDomain(email: string) {
  return email.split("@")[1] ?? null;
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = loginRequestSchema.safeParse(json);

  if (!parsed.success) {
    await recordSecurityEvent({
      request,
      eventType: "auth_login_invalid_payload",
      severity: "low",
      metadata: {
        issueCount: parsed.error.issues.length
      }
    });
    await maybeEscalateRepeatedSecurityEvent({
      request,
      signalEventType: "auth_login_invalid_payload",
      anomalyEventType: "auth_login_invalid_payload_repeated",
      threshold: 5,
      windowSeconds: 1800,
      severity: "high"
    });

    return NextResponse.json({ error: "Invalid login request." }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const rateLimit = await enforceRateLimit({
    request,
    bucket: `auth_login:${email}`,
    limit: 8,
    windowSeconds: 900,
    logEventType: "auth_login_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const supabase = createServerSupabaseAnonClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password
  });

  if (error || !data.session) {
    await recordSecurityEvent({
      request,
      eventType: "auth_login_failed",
      severity: "low",
      metadata: {
        emailDomain: getEmailDomain(email)
      }
    });
    await maybeEscalateRepeatedSecurityEvent({
      request,
      signalEventType: "auth_login_failed",
      anomalyEventType: "auth_login_failures_repeated",
      threshold: 5,
      windowSeconds: 1800,
      severity: "high",
      metadata: {
        emailDomain: getEmailDomain(email)
      }
    });

    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  await recordSecurityEvent({
    request,
    eventType: "auth_login_succeeded",
    severity: "info",
    metadata: {
      emailDomain: getEmailDomain(email)
    }
  });

  return NextResponse.json({
    session: data.session
  });
}
