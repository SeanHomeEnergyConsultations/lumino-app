import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { createTerritory } from "@/lib/db/mutations/territories";
import { getTerritories } from "@/lib/db/queries/territories";
import { territoryInputSchema } from "@/lib/validation/territories";

function canManageTerritories(roles: string[]) {
  return roles.some((role) => ["owner", "admin", "manager"].includes(role));
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items = await getTerritories(context);
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageTerritories(context.memberships.map((item) => item.role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await request.json();
  const parsed = territoryInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid territory payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const result = await createTerritory(parsed.data, context);
  return NextResponse.json(result);
}
