import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { searchEntities } from "@/lib/db/queries/search";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const results = await searchEntities(q, context);
  return NextResponse.json(results);
}
