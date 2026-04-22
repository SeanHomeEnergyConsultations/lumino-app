import { NextResponse } from "next/server";
import { bookAppointmentFromQr } from "@/lib/db/mutations/qr";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { qrBookingSchema } from "@/lib/validation/qr";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const rateLimit = await enforceRateLimit({
    request,
    context: null,
    bucket: `qr_public_booking:${slug}`,
    limit: 12,
    windowSeconds: 3600,
    logEventType: "qr_public_booking_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many booking attempts. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json().catch(() => null);
  const parsed = qrBookingSchema.safeParse(json);
  if (!parsed.success) {
    await recordSecurityEvent({
      request,
      context: null,
      eventType: "qr_public_booking_invalid_payload",
      severity: "low",
      metadata: {
        slug,
        issueCount: parsed.error.issues.length
      }
    });
    return NextResponse.json(
      { error: "Invalid booking payload", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await bookAppointmentFromQr({
      slug,
      ...parsed.data,
      request
    });

    return NextResponse.json(result);
  } catch (error) {
    await recordSecurityEvent({
      request,
      context: null,
      eventType: "qr_public_booking_failed",
      severity: "medium",
      metadata: {
        slug,
        error: error instanceof Error ? error.message.slice(0, 200) : "Unknown QR booking failure"
      }
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to book appointment." },
      { status: 500 }
    );
  }
}
