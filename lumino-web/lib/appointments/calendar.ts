import type { AppointmentScheduleItem } from "@/types/api";

export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 90;

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function formatCalendarTimestamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function buildAppointmentDescription(item: AppointmentScheduleItem, appUrl: string) {
  const propertyUrl = `${appUrl}/properties/${encodeURIComponent(item.propertyId)}`;
  const mapUrl = `${appUrl}/map?propertyId=${encodeURIComponent(item.propertyId)}`;

  return [
    `Contact: ${item.contactName ?? "Unknown homeowner"}`,
    `Phone: ${item.phone ?? "Not captured"}`,
    `Email: ${item.email ?? "Not captured"}`,
    `Lead status: ${item.leadStatus ?? "Unknown"}`,
    `Assigned owner: ${item.ownerName ?? "Unassigned"}`,
    `Property: ${propertyUrl}`,
    `Map: ${mapUrl}`
  ].join("\n");
}

function buildLocation(item: AppointmentScheduleItem) {
  return [item.address, [item.city, item.state].filter(Boolean).join(", ")].filter(Boolean).join(", ");
}

export function buildAppointmentIcs(item: AppointmentScheduleItem, options: { appUrl: string }) {
  const start = new Date(item.scheduledAt);
  const end = addMinutes(start, DEFAULT_APPOINTMENT_DURATION_MINUTES);
  const now = new Date();
  const summary = `${item.contactName ?? "Homeowner appointment"} - ${item.address}`;
  const description = buildAppointmentDescription(item, options.appUrl);
  const location = buildLocation(item);
  const status =
    item.appointmentStatus === "cancelled"
      ? "CANCELLED"
      : item.appointmentStatus === "completed"
        ? "CONFIRMED"
        : "CONFIRMED";

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lumino//Appointments//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:lumino-appointment-${item.leadId}@lumino.local`,
    `DTSTAMP:${formatCalendarTimestamp(now)}`,
    `DTSTART:${formatCalendarTimestamp(start)}`,
    `DTEND:${formatCalendarTimestamp(end)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(location)}`,
    `STATUS:${status}`,
    `URL:${escapeIcsText(`${options.appUrl}/properties/${encodeURIComponent(item.propertyId)}`)}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

export function buildGoogleCalendarUrl(item: AppointmentScheduleItem, options: { appUrl: string }) {
  const start = new Date(item.scheduledAt);
  const end = addMinutes(start, DEFAULT_APPOINTMENT_DURATION_MINUTES);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${item.contactName ?? "Homeowner appointment"} - ${item.address}`,
    dates: `${formatCalendarTimestamp(start)}/${formatCalendarTimestamp(end)}`,
    details: buildAppointmentDescription(item, options.appUrl),
    location: buildLocation(item)
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
