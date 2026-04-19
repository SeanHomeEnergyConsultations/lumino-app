import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { CURRENT_AGREEMENT_COOKIE } from "@/lib/legal/clickwrap";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request, { allowBlocked: true });
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const response = NextResponse.json(context);

  if (context.hasAcceptedRequiredAgreement) {
    response.cookies.set(CURRENT_AGREEMENT_COOKIE, "accepted", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365
    });
  } else {
    response.cookies.delete(CURRENT_AGREEMENT_COOKIE);
  }

  return response;
}
