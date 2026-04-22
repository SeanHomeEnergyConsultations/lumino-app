import type { QRCodeEventType } from "@/types/api";

export function detectDevice(userAgent: string | null) {
  if (!userAgent) return "Unknown";
  if (/iPad/i.test(userAgent)) return "Tablet";
  if (/iPhone|Android.*Mobile|Mobile/i.test(userAgent)) return "Mobile";
  if (/Android/i.test(userAgent)) return "Tablet";
  return "Desktop";
}

export function detectBrowser(userAgent: string | null) {
  if (!userAgent) return "Unknown";
  if (/CriOS/i.test(userAgent)) return "Chrome (iOS)";
  if (/FxiOS/i.test(userAgent)) return "Firefox (iOS)";
  if (/EdgA?/i.test(userAgent)) return "Edge";
  if (/Chrome/i.test(userAgent) && !/Chromium/i.test(userAgent)) return "Chrome";
  if (/Firefox/i.test(userAgent)) return "Firefox";
  if (/Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)) return "Safari";
  if (/Samsung/i.test(userAgent)) return "Samsung";
  return "Other";
}

export function getRequestGeo(request: Request) {
  return {
    country:
      request.headers.get("x-vercel-ip-country") ??
      request.headers.get("x-country-code") ??
      null,
    region:
      request.headers.get("x-vercel-ip-country-region") ??
      request.headers.get("x-region") ??
      null,
    city: request.headers.get("x-vercel-ip-city") ?? null,
    postalCode: request.headers.get("x-vercel-ip-postal-code") ?? null
  };
}

export function summarizeQrEventCounts(eventType: QRCodeEventType | string) {
  switch (eventType) {
    case "appointment_booked":
      return "appointmentsBooked";
    case "save_contact":
      return "saveContacts";
    case "call_click":
      return "calls";
    case "text_click":
      return "texts";
    case "email_click":
      return "emails";
    case "website_click":
      return "websiteClicks";
    default:
      return "scans";
  }
}
