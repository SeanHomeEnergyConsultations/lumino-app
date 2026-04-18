import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { getLeadDetail } from "@/lib/db/queries/leads";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { leadId } = await params;
  const item = await getLeadDetail(leadId, context);
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ item });
}
