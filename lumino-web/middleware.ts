import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { CURRENT_AGREEMENT_COOKIE } from "@/lib/legal/clickwrap";

const PROTECTED_PATHS = [
  "/map",
  "/queue",
  "/leads",
  "/appointments",
  "/tasks",
  "/dashboard",
  "/imports",
  "/team",
  "/properties"
];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  if (request.cookies.get(CURRENT_AGREEMENT_COOKIE)?.value === "accepted") {
    return NextResponse.next();
  }

  const redirectUrl = new URL("/accept-agreement", request.url);
  redirectUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ["/map/:path*", "/queue/:path*", "/leads/:path*", "/appointments/:path*", "/tasks/:path*", "/dashboard/:path*", "/imports/:path*", "/team/:path*", "/properties/:path*"]
};
