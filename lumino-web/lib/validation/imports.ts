import { z } from "zod";

export const importUploadRowSchema = z.record(z.string(), z.string());

export const importUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  rows: z.array(importUploadRowSchema).min(1).max(5000)
});
