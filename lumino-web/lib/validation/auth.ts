import { z } from "zod";

export const loginRequestSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(512)
});

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().email().max(320),
  redirectTo: z.string().trim().url().max(500).optional()
});
