import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { getRequestIpAddress, getRequestUserAgent } from "@/lib/security/request-meta";
import { getSecurityAlertWebhookUrl } from "@/lib/utils/env";
import type { AuthSessionContext } from "@/types/auth";

async function sendSecurityAlert(input: {
  eventType: string;
  severity: "info" | "low" | "medium" | "high";
  organizationId?: string | null;
  actorUserId?: string | null;
  targetUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata: Record<string, unknown>;
}) {
  const webhookUrl = getSecurityAlertWebhookUrl();
  if (!webhookUrl) return;

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      source: "lumino-web",
      timestamp: new Date().toISOString(),
      ...input
    })
  });

  if (!response.ok) {
    throw new Error(`Security alert webhook returned ${response.status}`);
  }
}

export async function recordSecurityEvent(input: {
  request?: Request;
  context?: AuthSessionContext | null;
  eventType: string;
  severity?: "info" | "low" | "medium" | "high";
  targetUserId?: string | null;
  metadata?: Record<string, unknown>;
  triggerAlert?: boolean;
  throwOnAlertFailure?: boolean;
}) {
  const supabase = createServerSupabaseClient();
  const severity = input.severity ?? "info";
  const ipAddress = input.request ? getRequestIpAddress(input.request) : null;
  const userAgent = input.request ? getRequestUserAgent(input.request) : null;
  const metadata = input.metadata ?? {};

  await supabase.from("security_events").insert({
    organization_id: input.context?.organizationId ?? null,
    actor_user_id: input.context?.appUser.id ?? null,
    target_user_id: input.targetUserId ?? null,
    event_type: input.eventType,
    severity,
    ip_address: ipAddress,
    user_agent: userAgent,
    metadata
  });

  const shouldAlert = Boolean(input.triggerAlert || severity === "high");
  if (!shouldAlert) {
    return {
      alertAttempted: false,
      alertDelivered: false,
      alertError: null as string | null
    };
  }

  const webhookUrl = getSecurityAlertWebhookUrl();
  if (!webhookUrl) {
    const message = "SECURITY_ALERT_WEBHOOK_URL is not configured.";
    if (input.throwOnAlertFailure) {
      throw new Error(message);
    }
    return {
      alertAttempted: false,
      alertDelivered: false,
      alertError: message
    };
  }

  try {
    await sendSecurityAlert({
      eventType: input.eventType,
      severity,
      organizationId: input.context?.organizationId ?? null,
      actorUserId: input.context?.appUser.id ?? null,
      targetUserId: input.targetUserId ?? null,
      ipAddress,
      userAgent,
      metadata
    });
    return {
      alertAttempted: true,
      alertDelivered: true,
      alertError: null as string | null
    };
  } catch (error) {
    console.error("Failed to send security alert", error);
    const message =
      error instanceof Error ? error.message : "Unknown security alert delivery failure";
    if (input.throwOnAlertFailure) {
      throw new Error(message);
    }
    return {
      alertAttempted: true,
      alertDelivered: false,
      alertError: message
    };
  }
}
