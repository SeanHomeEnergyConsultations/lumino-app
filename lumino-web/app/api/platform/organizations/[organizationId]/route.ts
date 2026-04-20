import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { updatePlatformOrganization } from "@/lib/db/mutations/platform";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { organizationPlatformUpdateSchema } from "@/lib/validation/organization";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!context.isPlatformOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "platform_organization_update",
    limit: 60,
    windowSeconds: 3600,
    logEventType: "platform_organization_update_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many organization plan changes. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json();
  const parsed = organizationPlatformUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid organization payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { organizationId } = await params;
  const item = await updatePlatformOrganization(organizationId, parsed.data, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "platform_organization_updated",
    severity: "medium",
    metadata: {
      organizationId,
      billingPlan: parsed.data.billingPlan ?? null,
      status: parsed.data.status ?? null
    }
  });

  return NextResponse.json({ item });
}
