import { z } from "zod";

export const appointmentStatusSchema = z.object({
  leadId: z.string().uuid(),
  status: z.enum(["scheduled", "confirmed", "completed", "no_show", "cancelled", "rescheduled"]),
  notes: z.string().trim().max(2000).nullable().optional()
});
