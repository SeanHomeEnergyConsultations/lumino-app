import { z } from "zod";

export const taskInputSchema = z.object({
  propertyId: z.string().uuid().nullable().optional(),
  leadId: z.string().uuid().nullable().optional(),
  type: z.enum([
    "call",
    "text",
    "revisit",
    "appointment_confirm",
    "proposal_follow_up",
    "rebook_appointment",
    "customer_check_in",
    "referral_request",
    "manager_review",
    "custom"
  ]),
  dueAt: z.string().datetime().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional()
});
