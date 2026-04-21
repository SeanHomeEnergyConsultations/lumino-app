import { z } from "zod";

export const performanceCompetitionInputSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(1000).nullable().optional(),
    metric: z.enum(["knocks", "opportunities", "appointments", "doorhangers"]),
    periodType: z.enum(["day", "week", "custom"]),
    startAt: z.string().datetime(),
    endAt: z.string().datetime()
  })
  .superRefine((value, ctx) => {
    if (new Date(value.endAt).getTime() <= new Date(value.startAt).getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endAt"],
        message: "End time must be after the start time."
      });
    }
  });
