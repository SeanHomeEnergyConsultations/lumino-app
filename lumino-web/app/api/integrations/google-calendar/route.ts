import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import {
  createGoogleCalendarConnectUrl,
  disconnectGoogleCalendar,
  getGoogleCalendarConnectionStatus
} from "@/lib/google-calendar/service";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { googleCalendarConnectSchema } from "@/lib/validation/google-calendar";
import type {
  GoogleCalendarConnectResponse,
  GoogleCalendarConnectionStatusResponse
} from "@/types/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const item = await getGoogleCalendarConnectionStatus(context);
  return NextResponse.json({ item } satisfies GoogleCalendarConnectionStatusResponse);
}

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => ({}));
  const parsed = googleCalendarConnectSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Google Calendar connect payload" }, { status: 400 });
  }

  const authUrl = await createGoogleCalendarConnectUrl(context, {
    redirectPath: parsed.data.redirectPath ?? "/appointments"
  });

  await recordSecurityEvent({
    request,
    context,
    eventType: "google_calendar_connect_started",
    severity: "low",
    metadata: {
      redirectPath: parsed.data.redirectPath ?? "/appointments"
    }
  });

  return NextResponse.json({ authUrl } satisfies GoogleCalendarConnectResponse);
}

export async function DELETE(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await disconnectGoogleCalendar(context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "google_calendar_disconnected",
    severity: "medium",
    metadata: {}
  });
  return NextResponse.json({ ok: true });
}
