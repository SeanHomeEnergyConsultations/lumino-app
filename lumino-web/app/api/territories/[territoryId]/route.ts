import { NextResponse } from "next/server";
import { hasManagerAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { updateTerritory } from "@/lib/db/mutations/territories";
import { getTerritoryDetail } from "@/lib/db/queries/territories";
import { territoryInputSchema } from "@/lib/validation/territories";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ territoryId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { territoryId } = await params;
  const item = await getTerritoryDetail(territoryId, context);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ item });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ territoryId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasManagerAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await request.json();
  const parsed = territoryInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid territory payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { territoryId } = await params;
  const result = await updateTerritory(territoryId, parsed.data, context);
  return NextResponse.json(result);
}
