import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { getAppointments } from "@/lib/db/queries/appointments";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const appointments = await getAppointments(context, searchParams.get("ownerId"));
  return NextResponse.json(appointments);
}
