import { z } from "zod";

export const qrCodeCreateSchema = z.object({
  codeType: z.enum(["contact_card", "campaign_tracker"]).optional(),
  label: z.string().trim().min(2).max(120),
  territoryId: z.string().uuid().nullable().optional(),
  title: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  website: z.string().trim().url().max(500).nullable().optional(),
  bookingEnabled: z.boolean().optional(),
  bookingBlurb: z.string().trim().max(240).nullable().optional(),
  destinationUrl: z.string().trim().url().max(500).nullable().optional(),
  description: z.string().trim().max(240).nullable().optional()
}).superRefine((value, ctx) => {
  if ((value.codeType ?? "contact_card") === "campaign_tracker" && !value.destinationUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["destinationUrl"],
      message: "Campaign trackers need a destination URL."
    });
  }
});

export const qrCodeEventSchema = z.object({
  eventType: z.enum([
    "call_click",
    "text_click",
    "email_click",
    "website_click",
    "book_click",
    "save_contact"
  ])
});

export const qrBookingSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().max(80).nullable().optional(),
    phone: z.string().trim().min(7).max(40),
    email: z.string().trim().email().max(320).nullable().optional(),
    address: z.string().trim().min(6).max(240),
    appointmentAt: z.string().datetime(),
    notes: z.string().trim().max(2000).nullable().optional()
  })
  .superRefine((value, ctx) => {
    const appointmentAt = new Date(value.appointmentAt).getTime();
    if (Number.isNaN(appointmentAt) || appointmentAt <= Date.now()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["appointmentAt"],
        message: "Appointment time must be in the future."
      });
    }
  });
