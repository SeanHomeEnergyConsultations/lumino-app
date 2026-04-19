import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { getImportBatchDetail } from "@/lib/db/queries/imports";

function canManageImports(roles: string[]) {
  return roles.some((role) => ["owner", "admin", "manager"].includes(role));
}

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageImports(context.memberships.map((item) => item.role))) {
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
