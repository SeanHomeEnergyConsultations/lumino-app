import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { createTask } from "@/lib/db/mutations/tasks";
import { getTasksBoard } from "@/lib/db/queries/tasks";
import { taskInputSchema } from "@/lib/validation/tasks";

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

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json();
  const parsed = taskInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid task payload",
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const result = await createTask(parsed.data, context);
  return NextResponse.json(result);
}
