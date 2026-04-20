import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { createTask } from "@/lib/db/mutations/tasks";
import { getTasksBoard } from "@/lib/db/queries/tasks";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
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

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "task_create",
    limit: 120,
    windowSeconds: 300,
    logEventType: "task_create_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many task updates. Please slow down and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
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
  await recordSecurityEvent({
    request,
    context,
    eventType: "task_created",
    severity: "low",
    metadata: {
      taskId: result.taskId,
      propertyId: parsed.data.propertyId ?? null,
      leadId: parsed.data.leadId ?? null,
      type: parsed.data.type
    }
  });
  return NextResponse.json(result);
}
