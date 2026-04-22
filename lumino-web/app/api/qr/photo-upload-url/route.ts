import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { createQrPhotoUploadTarget } from "@/lib/db/mutations/qr";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { qrPhotoUploadTargetSchema } from "@/lib/validation/qr";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "qr_photo_upload_target",
    limit: 40,
    windowSeconds: 3600,
    logEventType: "qr_photo_upload_target_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many photo upload attempts. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json();
  const parsed = qrPhotoUploadTargetSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid photo upload payload", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await createQrPhotoUploadTarget(parsed.data, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "qr_photo_upload_target_created",
    severity: "low",
    metadata: {
      bucket: result.bucket,
      path: result.path
    }
  });

  return NextResponse.json(result);
}
