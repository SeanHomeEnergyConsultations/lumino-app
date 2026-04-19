import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { resolveOrCreateProperty } from "@/lib/db/mutations/properties";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { resolvePropertyInputSchema } from "@/lib/validation/properties";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await getRequestSessionContext(request);
    if (!context) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = await enforceRateLimit({
      request,
      context,
      bucket: "property_resolve",
      limit: 40,
      windowSeconds: 60,
      logEventType: "property_resolve_rate_limit_exceeded"
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many property resolve requests. Please wait a moment and try again." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    const json = await request.json();
    const parsed = resolvePropertyInputSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid property resolve payload",
          issues: parsed.error.flatten()
        },
        { status: 400 }
      );
    }

    const result = await resolveOrCreateProperty(parsed.data, context);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/properties/resolve] request:error", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to resolve property"
      },
      { status: 500 }
    );
  }
}
