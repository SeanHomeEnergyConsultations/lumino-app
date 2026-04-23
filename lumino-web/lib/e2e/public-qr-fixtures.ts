import type { PublicQRCodeResponse } from "@/types/api";

export function getE2EPublicQrCode(slug: string): PublicQRCodeResponse["item"] | null {
  if (slug !== "e2e-booking") {
    return null;
  }

  return {
    qrCodeId: "qr_e2e_1",
    organizationId: "org_1",
    label: "E2E Booking",
    slug,
    publicUrl: `https://lumino.test/connect/${slug}`,
    publicBookingUrl: `https://lumino.test/book/${slug}`,
    ownerName: "Jordan Rep",
    payload: {
      firstName: "Jordan",
      lastName: "Rep",
      title: "Energy Consultant",
      photoUrl: null,
      phone: "555-111-2222",
      email: "jordan@lumino.test",
      website: "https://lumino.test",
      bookingEnabled: true,
      bookingBlurb: "Pick any real opening below to book time.",
      organizationName: "Lumino",
      appName: "Lumino",
      logoUrl: null,
      primaryColor: "#0b1220",
      accentColor: "#d97706",
      bookingTypes: [
        {
          id: "consult_in_person",
          type: "in_person_consult",
          enabled: true,
          label: "Home Consult",
          shortDescription: "Best for a full home energy walkthrough.",
          fullDescription: "We can look at usage, roof layout, and answer decision-maker questions in person.",
          durationMinutes: 45,
          preBufferMinutes: 15,
          postBufferMinutes: 15,
          slotStepMinutes: 30
        }
      ],
      availability: {
        timezone: "America/New_York",
        workingDays: [1, 2, 3, 4, 5],
        startTime: "09:00",
        endTime: "17:00",
        minNoticeHours: 2,
        maxDaysOut: 21
      }
    }
  };
}
