import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { getRequestIpAddress } from "@/lib/security/request-meta";
import { recordSecurityEvent } from "@/lib/security/security-events";
import type { AuthSessionContext } from "@/types/auth";

function buildScopeQuery(input: {
  baseQuery: any;
  actorUserId?: string | null;
  ipAddress?: string | null;
}) {
  if (input.actorUserId) {
    return input.baseQuery.eq("actor_user_id", input.actorUserId);
  }

  if (input.ipAddress) {
    return input.baseQuery.eq("ip_address", input.ipAddress);
  }

  return null;
}

export async function maybeEscalateRepeatedSecurityEvent(input: {
  request?: Request;
  context?: AuthSessionContext | null;
  signalEventType: string;
  anomalyEventType: string;
  threshold: number;
  windowSeconds: number;
  severity?: "info" | "low" | "medium" | "high";
  metadata?: Record<string, unknown>;
  targetUserId?: string | null;
}) {
  const supabase = createServerSupabaseClient();
  const actorUserId = input.context?.appUser.id ?? null;
  const ipAddress = input.request ? getRequestIpAddress(input.request) : null;
  const windowStart = new Date(Date.now() - input.windowSeconds * 1000).toISOString();

  const signalQuery = buildScopeQuery({
    baseQuery: supabase
      .from("security_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", input.signalEventType)
      .gte("created_at", windowStart),
    actorUserId,
    ipAddress
  });

  if (!signalQuery) return;

  const { count: signalCount, error: signalError } = await signalQuery;
  if (signalError) {
    console.error("Failed to inspect security event threshold", signalError);
    return;
  }

  if ((signalCount ?? 0) < input.threshold) return;

  const anomalyQuery = buildScopeQuery({
    baseQuery: supabase
      .from("security_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", input.anomalyEventType)
      .gte("created_at", windowStart),
    actorUserId,
    ipAddress
  });

  if (!anomalyQuery) return;

  const { count: anomalyCount, error: anomalyError } = await anomalyQuery;
  if (anomalyError) {
    console.error("Failed to inspect prior anomaly event threshold", anomalyError);
    return;
  }

  if ((anomalyCount ?? 0) > 0) return;

  await recordSecurityEvent({
    request: input.request,
    context: input.context ?? null,
    eventType: input.anomalyEventType,
    severity: input.severity ?? "high",
    targetUserId: input.targetUserId ?? null,
    triggerAlert: true,
    metadata: {
      signalEventType: input.signalEventType,
      threshold: input.threshold,
      windowSeconds: input.windowSeconds,
      observedCount: signalCount ?? 0,
      ...input.metadata
    }
  });
}
