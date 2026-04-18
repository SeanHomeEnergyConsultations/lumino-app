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
  appointmentAt: z.string().datetime().nullable().optional()
});
