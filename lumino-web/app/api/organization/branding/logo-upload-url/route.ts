import { NextResponse } from "next/server";
import { hasAdminAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { createOrganizationBrandLogoUploadTarget } from "@/lib/db/mutations/organization";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { organizationBrandLogoUploadTargetSchema } from "@/lib/validation/organization";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasAdminAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "organization_brand_logo_upload_target",
    limit: 30,
    windowSeconds: 3600,
    logEventType: "organization_brand_logo_upload_target_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many logo upload attempts. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json();
  const parsed = organizationBrandLogoUploadTargetSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid logo upload payload", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await createOrganizationBrandLogoUploadTarget(parsed.data, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "organization_brand_logo_upload_target_created",
    severity: "low",
    metadata: {
      bucket: result.bucket,
      path: result.path
    }
  });

  return NextResponse.json(result);
}
