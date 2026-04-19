import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { updateAppointmentStatus } from "@/lib/db/mutations/appointments";
import { getAppointments } from "@/lib/db/queries/appointments";
import { appointmentStatusSchema } from "@/lib/validation/appointments";

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

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json();
  const parsed = appointmentStatusSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid appointment payload",
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const result = await updateAppointmentStatus(parsed.data, context);
  return NextResponse.json(result);
}
