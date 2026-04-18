import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { getTasksBoard } from "@/lib/db/queries/tasks";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const board = await getTasksBoard(context, searchParams.get("ownerId"));
  return NextResponse.json(board);
}
