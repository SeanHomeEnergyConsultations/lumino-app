import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { createVisit } from "@/lib/db/mutations/visits";
import { visitInputSchema } from "@/lib/validation/visits";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    console.info("[api/visits] request:start");
    const context = await getRequestSessionContext(request);
    if (!context) {
      console.warn("[api/visits] request:unauthorized");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.info("[api/visits] auth:resolved", {
      appUserId: context.appUser.id,
      organizationId: context.organizationId
    });

    const json = await request.json();
    const parsed = visitInputSchema.safeParse(json);

    if (!parsed.success) {
      console.warn("[api/visits] request:invalid", parsed.error.flatten());
      return NextResponse.json(
        {
          error: "Invalid visit payload",
          issues: parsed.error.flatten()
        },
        { status: 400 }
      );
    }

    console.info("[api/visits] request:validated", {
      propertyId: parsed.data.propertyId,
      outcome: parsed.data.outcome
    });

    const result = await createVisit(parsed.data, context);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/visits] request:error", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to log visit"
      },
      { status: 500 }
    );
  }
}
