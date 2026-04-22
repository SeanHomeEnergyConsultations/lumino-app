import { z } from "zod";
import { ORGANIZATION_BILLING_PLANS } from "@/lib/platform/features";

const hexColor = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const organizationBrandingSchema = z.object({
  appName: z.string().trim().min(1).max(120),
  logoUrl: z.string().trim().url().max(2048).nullable().optional().or(z.literal("")),
  logoScale: z.number().min(0.4).max(1.6).nullable().optional(),
  primaryColor: z.string().trim().regex(hexColor).nullable().optional().or(z.literal("")),
  accentColor: z.string().trim().regex(hexColor).nullable().optional().or(z.literal("")),
  backgroundColor: z.string().trim().regex(hexColor).nullable().optional().or(z.literal("")),
  backgroundAccentColor: z.string().trim().regex(hexColor).nullable().optional().or(z.literal("")),
  surfaceColor: z.string().trim().regex(hexColor).nullable().optional().or(z.literal("")),
  sidebarColor: z.string().trim().regex(hexColor).nullable().optional().or(z.literal(""))
});

export const organizationBrandLogoUploadTargetSchema = z
  .object({
    fileName: z.string().trim().min(1).max(240),
    mimeType: z.string().trim().min(1).max(120),
    fileSizeBytes: z.number().int().min(1).max(10 * 1024 * 1024)
  })
  .superRefine((value, ctx) => {
    if (!value.mimeType.startsWith("image/")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mimeType"],
        message: "Brand logo must be an image file."
      });
    }
  });

export const organizationCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/).nullable().optional().or(z.literal("")),
  appName: z.string().trim().min(1).max(120).nullable().optional().or(z.literal(""))
});

export const organizationPlatformUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).nullable().optional().or(z.literal("")),
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/).nullable().optional().or(z.literal("")),
  billingPlan: z.enum(ORGANIZATION_BILLING_PLANS).nullable().optional(),
  status: z.enum(["active", "disabled"]).nullable().optional()
});

export const organizationFeatureUpdateSchema = z.object({
  enrichmentEnabled: z.boolean().nullable().optional(),
  priorityScoringEnabled: z.boolean().nullable().optional(),
  advancedImportsEnabled: z.boolean().nullable().optional(),
  securityConsoleEnabled: z.boolean().nullable().optional()
});

const geographyListSchema = z.array(z.string().trim().min(1).max(120)).max(200);

export const organizationDatasetEntitlementsUpdateSchema = z.object({
  sold_properties: z.object({
    cities: geographyListSchema,
    zips: geographyListSchema
  }),
  solar_permits: z.object({
    cities: geographyListSchema,
    zips: geographyListSchema
  }),
  roofing_permits: z.object({
    cities: geographyListSchema,
    zips: geographyListSchema
  })
});
