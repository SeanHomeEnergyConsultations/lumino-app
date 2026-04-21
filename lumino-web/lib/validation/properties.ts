import { z } from "zod";

export const resolvePropertyInputSchema = z
  .object({
    lat: z.number().gte(-90).lte(90).optional(),
    lng: z.number().gte(-180).lte(180).optional(),
    address: z.string().trim().min(5).max(200).optional()
  })
  .superRefine((value, ctx) => {
    const hasCoordinates = typeof value.lat === "number" && typeof value.lng === "number";
    const hasAddress = typeof value.address === "string" && value.address.trim().length >= 5;

    if (!hasCoordinates && !hasAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide coordinates or an address."
      });
    }
  });
