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
  id: z.string().trim().min(1).max(160),
  type: z.enum(["phone_call", "in_person_consult"]),
  enabled: z.boolean().optional(),
  label: z.string().trim().min(2).max(80),
  shortDescription: optionalTrimmedString(160),
  fullDescription: optionalTrimmedString(1200),
  durationMinutes: z.coerce.number().int().min(10).max(180),
  preBufferMinutes: z.coerce.number().int().min(0).max(240),
  postBufferMinutes: z.coerce.number().int().min(0).max(240)
}).passthrough();

const availabilitySettingsSchema = z.object({
  timezone: z.string().trim().min(1).max(80),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startTime: z.string().trim().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().trim().regex(/^\d{2}:\d{2}$/),
  minNoticeHours: z.number().int().min(0).max(72),
  maxDaysOut: z.number().int().min(1).max(60)
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
  bookingTypes: z.array(bookingTypeConfigSchema).max(20).nullable().optional(),
  bookingTypeIds: z.array(z.string().trim().min(1).max(160)).max(20).nullable().optional()
}).superRefine((value, ctx) => {
  if ((value.codeType ?? "contact_card") === "campaign_tracker" && !value.destinationUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["destinationUrl"],
      message: "Campaign trackers need a destination URL."
    });
  }

  if ((value.codeType ?? "contact_card") === "contact_card") {
    if (value.bookingEnabled !== false && (!value.bookingTypeIds || value.bookingTypeIds.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bookingTypeIds"],
        message: "Choose at least one saved appointment type for this card."
      });
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
    phone: optionalTrimmedString(40),
    email: z.string().trim().email().max(320).nullable().optional(),
    address: optionalTrimmedString(240),
    appointmentAt: z.string().trim().min(1),
    bookingTypeId: z.string().trim().min(1).max(160),
    notes: z.string().trim().max(2000).nullable().optional()
  })
  .superRefine((value, ctx) => {
    if (!value.phone && !value.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phone"],
        message: "Add a phone number or an email so the rep can confirm the appointment."
      });
    }

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
  bookingTypeId: z.string().trim().min(1).max(160)
});

export const qrBookingProfileSchema = z.object({
  availability: availabilitySettingsSchema,
  bookingTypes: z.array(bookingTypeConfigSchema).min(1).max(20)
}).superRefine((value, ctx) => {
  const anyEnabled = value.bookingTypes.some((config) => config.enabled !== false);
  if (!anyEnabled) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bookingTypes"],
      message: "Enable at least one appointment type."
    });
  }

  const ids = new Set<string>();
  for (const config of value.bookingTypes) {
    if (ids.has(config.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bookingTypes"],
        message: "Each appointment preset needs a unique ID."
      });
      break;
    }
    ids.add(config.id);
  }
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
