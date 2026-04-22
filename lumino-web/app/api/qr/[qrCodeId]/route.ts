import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { archiveQrCode } from "@/lib/db/mutations/qr";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ qrCodeId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "qr_code_archive",
    limit: 20,
    windowSeconds: 3600,
    logEventType: "qr_code_archive_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many QR code archive attempts. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const { qrCodeId } = await params;

  try {
    const result = await archiveQrCode(qrCodeId, context);
    await recordSecurityEvent({
      request,
      context,
      eventType: "qr_code_archived",
      severity: "low",
      metadata: {
        qrCodeId
      }
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not archive QR code.";
    if (message === "QR code not found.") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message === "You do not have permission to delete this QR code.") {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
