import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { getUserBookingProfile, upsertUserBookingProfile } from "@/lib/db/mutations/qr";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { qrBookingProfileSchema } from "@/lib/validation/qr";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const item = await getUserBookingProfile(context);
  return NextResponse.json({ item });
}

export async function PATCH(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "qr_booking_profile_update",
    limit: 30,
    windowSeconds: 3600,
    logEventType: "qr_booking_profile_update_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many booking profile changes. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json().catch(() => null);
  const parsed = qrBookingProfileSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid booking profile payload", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const item = await upsertUserBookingProfile(parsed.data, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "qr_booking_profile_updated",
    severity: "low",
    metadata: {
      enabledTypes: item.bookingTypes.filter((type) => type.enabled).map((type) => type.label)
    }
  });

  return NextResponse.json({ item });
}
