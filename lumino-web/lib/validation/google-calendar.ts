import { z } from "zod";

export const googleCalendarConnectSchema = z.object({
  redirectPath: z.string().trim().max(200).optional().nullable()
});

export const googleCalendarConflictCheckSchema = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional().nullable()
});
