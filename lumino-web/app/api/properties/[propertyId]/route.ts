import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { getPropertyDetail } from "@/lib/db/queries/properties";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { propertyId } = await params;
  const item = await getPropertyDetail(propertyId);
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ item });
}
