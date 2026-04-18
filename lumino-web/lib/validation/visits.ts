import { z } from "zod";

export const visitInputSchema = z.object({
  propertyId: z.string().uuid(),
  outcome: z.string().min(1),
  notes: z.string().trim().max(4000).optional(),
  interestLevel: z.enum(["low", "medium", "high"]).nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  capturedAt: z.string().datetime().nullable().optional()
});
