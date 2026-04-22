import { z } from "zod";

const optionalTrimmedString = (maxLength: number) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }, z.string().max(maxLength).nullable().optional());

const optionalEmail = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}, z.string().email().max(320).nullable().optional());

const optionalUrl = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}, z.string().url().max(500).nullable().optional());

const bookingTypeConfigSchema = z.object({
  enabled: z.boolean().optional(),
  label: z.string().trim().min(2).max(80),
  shortDescription: optionalTrimmedString(160),
  fullDescription: optionalTrimmedString(1200),
  durationMinutes: z.number().int().min(10).max(180),
  preBufferMinutes: z.number().int().min(0).max(240),
  postBufferMinutes: z.number().int().min(0).max(240)
});

export const qrCodeCreateSchema = z.object({
  codeType: z.enum(["contact_card", "campaign_tracker"]).optional(),
  label: z.string().trim().min(2).max(120),
  territoryId: z.string().uuid().nullable().optional(),
  title: optionalTrimmedString(120),
  phone: optionalTrimmedString(40),
  email: optionalEmail,
  photoUrl: optionalUrl,
  website: optionalUrl,
  bookingEnabled: z.boolean().optional(),
  bookingBlurb: optionalTrimmedString(240),
  destinationUrl: optionalUrl,
  description: optionalTrimmedString(240),
  availabilityTimezone: optionalTrimmedString(80),
  availabilityWorkingDays: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
  availabilityStartTime: optionalTrimmedString(5),
  availabilityEndTime: optionalTrimmedString(5),
  availabilityMinNoticeHours: z.number().int().min(0).max(72).nullable().optional(),
  availabilityMaxDaysOut: z.number().int().min(1).max(60).nullable().optional(),
  bookingTypes: z
    .object({
      phone_call: bookingTypeConfigSchema,
      in_person_consult: bookingTypeConfigSchema
    })
    .nullable()
    .optional()
}).superRefine((value, ctx) => {
  if ((value.codeType ?? "contact_card") === "campaign_tracker" && !value.destinationUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["destinationUrl"],
      message: "Campaign trackers need a destination URL."
    });
  }

  if ((value.codeType ?? "contact_card") === "contact_card") {
    const startTime = value.availabilityStartTime;
    const endTime = value.availabilityEndTime;
    if (startTime && !/^\d{2}:\d{2}$/.test(startTime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["availabilityStartTime"],
        message: "Start time must use HH:MM format."
      });
    }
    if (endTime && !/^\d{2}:\d{2}$/.test(endTime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["availabilityEndTime"],
        message: "End time must use HH:MM format."
      });
    }

    const bookingTypes = value.bookingTypes;
    if (bookingTypes) {
      const anyEnabled = Object.values(bookingTypes).some((config) => config.enabled !== false);
      if (!anyEnabled) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["bookingTypes"],
          message: "Enable at least one appointment type for booking."
        });
      }
    }
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
    appointmentType: z.enum(["phone_call", "in_person_consult"]).default("in_person_consult"),
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

export const qrAvailabilityQuerySchema = z.object({
  appointmentType: z.enum(["phone_call", "in_person_consult"]).default("in_person_consult")
});

export const qrPhotoUploadTargetSchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(1).max(120),
  fileSizeBytes: z.number().int().min(1).max(10 * 1024 * 1024)
}).superRefine((value, ctx) => {
  if (!value.mimeType.startsWith("image/")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["mimeType"],
      message: "Rep photo must be an image file."
    });
  }
});
