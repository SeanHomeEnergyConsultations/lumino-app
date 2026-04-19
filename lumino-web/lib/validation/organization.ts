import { z } from "zod";

const hexColor = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const organizationBrandingSchema = z.object({
  appName: z.string().trim().min(1).max(120),
  logoUrl: z.string().trim().url().max(2048).nullable().optional().or(z.literal("")),
  primaryColor: z.string().trim().regex(hexColor).nullable().optional().or(z.literal("")),
  accentColor: z.string().trim().regex(hexColor).nullable().optional().or(z.literal(""))
});

export const organizationCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/).nullable().optional().or(z.literal("")),
  appName: z.string().trim().min(1).max(120).nullable().optional().or(z.literal(""))
});
