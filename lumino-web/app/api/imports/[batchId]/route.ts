import { NextResponse } from "next/server";
import { hasAdminAccess, hasManagerAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { deleteImportBatch, updateImportBatchScope } from "@/lib/db/mutations/imports";
import { getImportBatchDetail } from "@/lib/db/queries/imports";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { importBatchScopeUpdateSchema } from "@/lib/validation/imports";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasManagerAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { batchId } = await params;
  const { searchParams } = new URL(request.url);
  const page = Number(searchParams.get("page") ?? "1");
  const pageSize = Number(searchParams.get("pageSize") ?? "100");
  const item = await getImportBatchDetail(batchId, context, { page, pageSize });
  if (!item) return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasManagerAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await request.json();
  const parsed = importBatchScopeUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid batch scope payload", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { batchId } = await params;
  await updateImportBatchScope(batchId, parsed.data, context);
  const item = await getImportBatchDetail(batchId, context, { page: 1, pageSize: 100 });
  await recordSecurityEvent({
    request,
    context,
    eventType: "import_batch_scope_updated",
    severity: "medium",
    metadata: {
      batchId,
      listType: parsed.data.listType,
      visibilityScope: parsed.data.visibilityScope,
      assignedTeamId: parsed.data.assignedTeamId ?? null,
      assignedUserId: parsed.data.assignedUserId ?? null
    }
  });
  return NextResponse.json({ item });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAdminAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { batchId } = await params;
  const result = await deleteImportBatch(batchId, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "import_batch_deleted",
    severity: "high",
    metadata: {
      batchId
    }
  });
  return NextResponse.json(result);
}
