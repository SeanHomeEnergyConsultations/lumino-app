import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { checkGoogleCalendarConflicts } from "@/lib/google-calendar/service";
import { googleCalendarConflictCheckSchema } from "@/lib/validation/google-calendar";
import type { GoogleCalendarConflictCheckResponse } from "@/types/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => ({}));
  const parsed = googleCalendarConflictCheckSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Google Calendar conflict payload" }, { status: 400 });
  }

  try {
    const result = await checkGoogleCalendarConflicts({
      context,
      startAt: parsed.data.startAt,
      endAt: parsed.data.endAt ?? null
    });

    return NextResponse.json(result satisfies GoogleCalendarConflictCheckResponse);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to check Google Calendar availability."
      },
      { status: 400 }
    );
  }
}
