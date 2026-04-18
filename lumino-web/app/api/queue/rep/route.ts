import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { getRepQueue } from "@/lib/db/queries/queue";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const queue = await getRepQueue(context);
  return NextResponse.json(queue);
}
