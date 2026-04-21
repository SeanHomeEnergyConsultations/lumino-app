import { getRequestSessionContext } from "@/lib/auth/server";
import { buildAppointmentIcs } from "@/lib/appointments/calendar";
import { getAppointmentByLeadId } from "@/lib/db/queries/appointments";

export const dynamic = "force-dynamic";

function sanitizeFileName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ leadId: string }> }
) {
  const sessionContext = await getRequestSessionContext(request);
  if (!sessionContext) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { leadId } = await context.params;
  const item = await getAppointmentByLeadId(sessionContext, leadId);
  if (!item) {
    return new Response("Appointment not found", { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const ics = buildAppointmentIcs(item, {
    appUrl: requestUrl.origin
  });
  const fileName = sanitizeFileName(`${item.address || "appointment"}-${item.scheduledAt}`) || "lumino-appointment";

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}.ics"`,
      "Cache-Control": "no-store"
    }
  });
}
