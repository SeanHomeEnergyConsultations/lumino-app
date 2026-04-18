import { z } from "zod";

export const teamInviteSchema = z.object({
  email: z.string().trim().email().max(255),
  fullName: z.string().trim().min(1).max(160),
  role: z.enum(["owner", "admin", "manager", "rep", "setter"])
});

export const teamMemberUpdateSchema = z.object({
  role: z.enum(["owner", "admin", "manager", "rep", "setter"]).optional(),
  isActive: z.boolean().optional()
});
