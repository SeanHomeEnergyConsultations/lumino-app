import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import {
  CURRENT_AGREEMENT_COOKIE,
  CURRENT_AGREEMENT_HASH,
  CURRENT_AGREEMENT_VERSION
} from "@/lib/legal/clickwrap";
import { getRequestIpAddress } from "@/lib/security/request-meta";
import { recordSecurityEvent } from "@/lib/security/security-events";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || body.accepted !== true) {
    return NextResponse.json({ error: "You must explicitly accept the agreement." }, { status: 400 });
  }

  const acceptedAt = new Date().toISOString();

  const serviceClient = createServerSupabaseClient();
  const { error } = await serviceClient.from("agreements").upsert(
    {
      user_id: context.appUser.id,
      version: CURRENT_AGREEMENT_VERSION,
      accepted_at: acceptedAt,
      ip_address: getRequestIpAddress(request),
      user_agent: request.headers.get("user-agent"),
      agreement_hash: CURRENT_AGREEMENT_HASH
    },
    { onConflict: "user_id,version" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await recordSecurityEvent({
    request,
    context,
    eventType: "agreement_accepted",
    severity: "info",
    targetUserId: context.appUser.id,
    metadata: {
      version: CURRENT_AGREEMENT_VERSION,
      agreementHash: CURRENT_AGREEMENT_HASH
    }
  });

  const response = NextResponse.json({
    acceptedAt,
    version: CURRENT_AGREEMENT_VERSION
  });

  response.cookies.set(CURRENT_AGREEMENT_COOKIE, "accepted", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365
  });

  return response;
}
