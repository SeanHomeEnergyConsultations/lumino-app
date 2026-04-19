import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { getRequestIpAddress } from "@/lib/security/request-meta";
import { recordSecurityEvent } from "@/lib/security/security-events";
import type { AuthSessionContext } from "@/types/auth";

function windowStart(now: Date, windowSeconds: number) {
  const startMs = Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000;
  return new Date(startMs);
}

export async function enforceRateLimit(input: {
  request: Request;
  context?: AuthSessionContext | null;
  bucket: string;
  limit: number;
  windowSeconds: number;
  logEventType?: string;
}) {
  const supabase = createServerSupabaseClient();
  const now = new Date();
  const startedAt = windowStart(now, input.windowSeconds);
  const ipAddress = getRequestIpAddress(input.request) ?? "unknown";
  const userKey = input.context?.appUser.id ?? "anonymous";
  const bucketKey = `${input.bucket}:${userKey}:${ipAddress}`;

  const { data: existing, error: existingError } = await supabase
    .from("security_rate_limits")
    .select("id,request_count")
    .eq("bucket_key", bucketKey)
    .eq("window_started_at", startedAt.toISOString())
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing && Number(existing.request_count ?? 0) >= input.limit) {
    await recordSecurityEvent({
      request: input.request,
      context: input.context ?? null,
      eventType: input.logEventType ?? "rate_limit_exceeded",
      severity: "medium",
      metadata: {
        bucket: input.bucket,
        limit: input.limit,
        windowSeconds: input.windowSeconds
      }
    });

    return {
      allowed: false as const,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((startedAt.getTime() + input.windowSeconds * 1000 - now.getTime()) / 1000)
      )
    };
  }

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from("security_rate_limits")
      .update({
        request_count: Number(existing.request_count ?? 0) + 1,
        updated_at: now.toISOString(),
        expires_at: new Date(startedAt.getTime() + input.windowSeconds * 2000).toISOString()
      })
      .eq("id", existing.id);

    if (updateError) throw updateError;
  } else {
    const { error: insertError } = await supabase.from("security_rate_limits").insert({
      bucket_key: bucketKey,
      window_started_at: startedAt.toISOString(),
      request_count: 1,
      expires_at: new Date(startedAt.getTime() + input.windowSeconds * 2000).toISOString(),
      updated_at: now.toISOString()
    });

    if (insertError) throw insertError;
  }

  return {
    allowed: true as const,
    retryAfterSeconds: 0
  };
}
