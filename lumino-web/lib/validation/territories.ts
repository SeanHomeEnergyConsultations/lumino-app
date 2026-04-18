import { z } from "zod";

export const territoryInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  status: z.enum(["active", "archived"]).default("active")
});

export const territoryAssignmentSchema = z.object({
  propertyId: z.string().uuid()
});
