import { NextResponse } from "next/server";
import { recordQrEvent } from "@/lib/db/mutations/qr";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { qrCodeEventSchema } from "@/lib/validation/qr";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const rateLimit = await enforceRateLimit({
    request,
    context: null,
    bucket: `qr_public_event:${slug}`,
    limit: 80,
    windowSeconds: 300,
    logEventType: "qr_public_event_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many QR interactions. Please slow down and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json().catch(() => null);
  const parsed = qrCodeEventSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid QR event payload", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const supabase = createServerSupabaseClient();
  const { data: qrCode, error } = await supabase
    .from("qr_codes")
    .select("id,organization_id")
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!qrCode) {
    return NextResponse.json({ error: "QR code not found." }, { status: 404 });
  }

  await recordQrEvent({
    qrCodeId: qrCode.id as string,
    organizationId: qrCode.organization_id as string,
    eventType: parsed.data.eventType,
    request
  });

  return NextResponse.json({ ok: true });
}
