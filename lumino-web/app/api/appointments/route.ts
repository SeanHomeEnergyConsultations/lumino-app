import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { updateAppointmentStatus } from "@/lib/db/mutations/appointments";
import { getAppointments } from "@/lib/db/queries/appointments";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
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

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "appointment_status_update",
    limit: 90,
    windowSeconds: 300,
    logEventType: "appointment_status_update_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many appointment updates. Please slow down and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
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
  await recordSecurityEvent({
    request,
    context,
    eventType: "appointment_status_updated",
    severity: "low",
    metadata: {
      appointmentId: result.appointmentId,
      leadId: parsed.data.leadId,
      status: parsed.data.status
    }
  });
  return NextResponse.json(result);
}
