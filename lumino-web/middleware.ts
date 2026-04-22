import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { CURRENT_AGREEMENT_COOKIE } from "@/lib/legal/clickwrap";

const PROTECTED_PATHS = [
  "/map",
  "/queue",
  "/leads",
  "/appointments",
  "/qr",
  "/tasks",
  "/dashboard",
  "/imports",
  "/team",
  "/properties"
];

function applySecurityHeaders(request: NextRequest, response: NextResponse) {
  const isHttps = request.nextUrl.protocol === "https:";
  const isProduction = process.env.NODE_ENV === "production";
  const contentSecurityPolicy = [
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self' https://accounts.google.com",
    "object-src 'none'"
  ].join("; ");

  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), payment=(), geolocation=(self)"
  );
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-site");

  if (isProduction && isHttps) {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }

  return response;
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return applySecurityHeaders(request, NextResponse.next());
  }

  if (request.cookies.get(CURRENT_AGREEMENT_COOKIE)?.value === "accepted") {
    return applySecurityHeaders(request, NextResponse.next());
  }

  const redirectUrl = new URL("/accept-agreement", request.url);
  redirectUrl.searchParams.set("next", `${pathname}${search}`);
  return applySecurityHeaders(request, NextResponse.redirect(redirectUrl));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[^/]+$).*)"]
};
