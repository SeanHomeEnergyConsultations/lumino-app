import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { resolveOrCreateProperty } from "@/lib/db/mutations/properties";
import { resolvePropertyInputSchema } from "@/lib/validation/properties";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await getRequestSessionContext(request);
    if (!context) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
