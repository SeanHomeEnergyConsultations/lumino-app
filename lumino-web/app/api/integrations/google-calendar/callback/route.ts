import { NextResponse } from "next/server";
import { completeGoogleCalendarOAuthCallback } from "@/lib/google-calendar/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${origin}/appointments?googleCalendar=error`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/appointments?googleCalendar=invalid`);
  }

  try {
    const result = await completeGoogleCalendarOAuthCallback({ code, state });
    const separator = result.redirectPath.includes("?") ? "&" : "?";
    return NextResponse.redirect(`${origin}${result.redirectPath}${separator}googleCalendar=connected`);
  } catch {
    return NextResponse.redirect(`${origin}/appointments?googleCalendar=error`);
  }
}
