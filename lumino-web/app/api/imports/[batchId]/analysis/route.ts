import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestSessionContext } from "@/lib/auth/server";
import { runImportBatchAnalysis } from "@/lib/db/mutations/imports";

const schema = z.object({
  action: z.enum(["run", "retry_failed"]).default("run")
});

function canManageImports(roles: string[]) {
  return roles.some((role) => ["owner", "admin", "manager"].includes(role));
}

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const context = await getRequestSessionContext(request);
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canManageImports(context.memberships.map((item) => item.role))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid analysis payload" }, { status: 400 });
    }

    const { batchId } = await params;
    const result = await runImportBatchAnalysis(batchId, context, {
      retryFailed: parsed.data.action === "retry_failed"
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to analyze import batch." },
      { status: 500 }
    );
  }
}
