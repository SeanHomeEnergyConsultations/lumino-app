import { z } from "zod";

export const importUploadRowSchema = z.record(z.string(), z.string());

export const importListTypeSchema = z.enum([
  "general_canvass_list",
  "homeowner_leads",
  "sold_properties",
  "solar_permits",
  "roofing_permits",
  "custom"
]);

export const importVisibilityScopeSchema = z.enum([
  "organization",
  "team",
  "assigned_user"
]);

export const importUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  listType: importListTypeSchema,
  visibilityScope: importVisibilityScopeSchema,
  assignedTeamId: z.string().uuid().nullable().optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  rows: z.array(importUploadRowSchema).min(1).max(5000)
}).superRefine((value, ctx) => {
  if (value.visibilityScope === "team" && !value.assignedTeamId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assignedTeamId"],
      message: "Choose a team when visibility is team-scoped."
    });
  }

  if (value.visibilityScope === "assigned_user" && !value.assignedUserId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assignedUserId"],
      message: "Choose a rep or manager when visibility is assigned-user."
    });
  }
});
