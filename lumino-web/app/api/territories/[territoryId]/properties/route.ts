import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import {
  assignPropertyToTerritory,
  removePropertyFromTerritory
} from "@/lib/db/mutations/territories";
import { territoryAssignmentSchema } from "@/lib/validation/territories";

function canManageTerritories(roles: string[]) {
  return roles.some((role) => ["owner", "admin", "manager"].includes(role));
}

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ territoryId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageTerritories(context.memberships.map((item) => item.role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await request.json();
  const parsed = territoryAssignmentSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid property assignment payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { territoryId } = await params;
  await assignPropertyToTerritory(territoryId, parsed.data.propertyId, context);
  return NextResponse.json({ territoryId, propertyId: parsed.data.propertyId });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ territoryId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageTerritories(context.memberships.map((item) => item.role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await request.json();
  const parsed = territoryAssignmentSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid property removal payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { territoryId } = await params;
  await removePropertyFromTerritory(territoryId, parsed.data.propertyId, context);
  return NextResponse.json({ territoryId, propertyId: parsed.data.propertyId });
}
