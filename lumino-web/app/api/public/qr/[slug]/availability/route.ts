import { NextResponse } from "next/server";
import { getPublicQrAvailability } from "@/lib/db/mutations/qr";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { qrAvailabilityQuerySchema } from "@/lib/validation/qr";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const rateLimit = await enforceRateLimit({
    request,
    context: null,
    bucket: `qr_public_availability:${slug}`,
    limit: 60,
    windowSeconds: 300,
    logEventType: "qr_public_availability_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many availability checks. Please slow down and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const { searchParams } = new URL(request.url);
  const parsed = qrAvailabilityQuerySchema.safeParse({
    bookingTypeId: searchParams.get("bookingTypeId") ?? undefined
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid availability query", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const availability = await getPublicQrAvailability({
      slug,
      bookingTypeId: parsed.data.bookingTypeId
    });
    return NextResponse.json(availability);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load availability." },
      { status: 500 }
    );
  }
}
