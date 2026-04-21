import { NextResponse } from "next/server";
import { hasManagerAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { createPerformanceCompetition } from "@/lib/db/mutations/performance";
import { getPerformanceHub } from "@/lib/db/queries/performance";
import { performanceCompetitionInputSchema } from "@/lib/validation/performance";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hub = await getPerformanceHub(context);
  return NextResponse.json(hub);
}

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasManagerAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await request.json();
  const parsed = performanceCompetitionInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid competition payload",
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const result = await createPerformanceCompetition(parsed.data, context);
  return NextResponse.json(result);
}
