import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { createQrCode } from "@/lib/db/mutations/qr";
import { getQrHub } from "@/lib/db/queries/qr";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { qrCodeCreateSchema } from "@/lib/validation/qr";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hub = await getQrHub(context);
  return NextResponse.json(hub);
}

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "qr_code_create",
    limit: 40,
    windowSeconds: 3600,
    logEventType: "qr_code_create_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many QR code changes. Please wait before creating another code." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json();
  const parsed = qrCodeCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid QR code payload", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await createQrCode(parsed.data, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "qr_code_created",
    severity: "low",
    metadata: {
      qrCodeId: result.item.qrCodeId,
      label: result.item.label,
      territoryId: result.item.territoryId
    }
  });

  return NextResponse.json(result);
}
