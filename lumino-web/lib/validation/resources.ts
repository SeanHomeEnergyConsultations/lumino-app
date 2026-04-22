import { z } from "zod";

const optionalTrimmedString = (maxLength: number) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }, z.string().max(maxLength).nullable().optional());

export const resourceUploadTargetSchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  mimeType: optionalTrimmedString(120),
  fileSizeBytes: z.number().int().min(1).max(1024 * 1024 * 1024)
});

export const resourceCreateSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: optionalTrimmedString(1000),
  resourceType: z.enum(["document", "video", "printable"]),
  territoryId: z.string().uuid().nullable().optional(),
  storageBucket: z.string().trim().min(1).max(120),
  storagePath: z.string().trim().min(1).max(500),
  fileName: z.string().trim().min(1).max(240),
  mimeType: optionalTrimmedString(120),
  fileSizeBytes: z.number().int().min(1).max(1024 * 1024 * 1024)
});
