import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { createResourceUploadTarget } from "@/lib/db/mutations/resources";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { resourceUploadTargetSchema } from "@/lib/validation/resources";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "resource_upload_target",
    limit: 80,
    windowSeconds: 3600,
    logEventType: "resource_upload_target_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many upload attempts. Please wait before trying another file." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json();
  const parsed = resourceUploadTargetSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid upload target payload", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await createResourceUploadTarget(parsed.data, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "resource_upload_target_created",
    severity: "low",
    metadata: {
      bucket: result.bucket,
      path: result.path
    }
  });

  return NextResponse.json(result);
}
