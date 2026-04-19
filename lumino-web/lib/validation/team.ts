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

export const teamMemberActionSchema = z.object({
  action: z.enum(["resend_invite", "send_password_reset"])
});

export const teamCleanupSchema = z.object({
  action: z.enum(["delete_orphan_app_user"]),
  userId: z.string().uuid()
});
