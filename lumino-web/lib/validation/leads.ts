import { z } from "zod";

export const leadInputSchema = z.object({
  propertyId: z.string().uuid(),
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(50).optional(),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  notes: z.string().trim().max(4000).optional(),
  leadStatus: z.enum(["New", "Attempting Contact", "Connected", "Nurture", "Appointment Set", "Qualified", "Closed Lost"]).optional(),
  interestLevel: z.enum(["low", "medium", "high"]).nullable().optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  appointmentAt: z.string().datetime().nullable().optional(),
  decisionMakerStatus: z.enum(["all_present", "spouse_missing", "other_missing"]).nullable().optional(),
  preferredChannel: z.enum(["text", "call", "door"]).nullable().optional(),
  bestContactTime: z.string().trim().max(120).nullable().optional(),
  textConsent: z.boolean().nullable().optional(),
  objectionType: z.enum(["price", "timing", "trust", "roof", "needs_numbers", "spouse", "none"]).nullable().optional(),
  billReceived: z.boolean().nullable().optional(),
  proposalPresented: z.boolean().nullable().optional(),
  appointmentOutcome: z.enum(["sat_not_closed", "moved", "canceled", "no_show", "closed"]).nullable().optional(),
  rescheduleReason: z.string().trim().max(255).nullable().optional(),
  cancellationReason: z.string().trim().max(255).nullable().optional(),
  engagementScore: z.number().int().min(1).max(5).nullable().optional(),
  cadenceTrack: z
    .enum([
      "warm_no_contact",
      "warm_with_contact",
      "appointment_active",
      "post_appt_spouse",
      "post_appt_numbers",
      "post_appt_price",
      "post_appt_timing",
      "post_appt_trust",
      "rebook_recovery",
      "customer_onboarding"
    ])
    .nullable()
    .optional()
});
