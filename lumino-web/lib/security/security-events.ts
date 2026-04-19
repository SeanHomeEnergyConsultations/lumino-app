import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { getRequestIpAddress, getRequestUserAgent } from "@/lib/security/request-meta";
import type { AuthSessionContext } from "@/types/auth";

export async function recordSecurityEvent(input: {
  request?: Request;
  context?: AuthSessionContext | null;
  eventType: string;
  severity?: "info" | "low" | "medium" | "high";
  targetUserId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const supabase = createServerSupabaseClient();

  await supabase.from("security_events").insert({
    organization_id: input.context?.organizationId ?? null,
    actor_user_id: input.context?.appUser.id ?? null,
    target_user_id: input.targetUserId ?? null,
    event_type: input.eventType,
    severity: input.severity ?? "info",
    ip_address: input.request ? getRequestIpAddress(input.request) : null,
    user_agent: input.request ? getRequestUserAgent(input.request) : null,
    metadata: input.metadata ?? {}
  });
}
