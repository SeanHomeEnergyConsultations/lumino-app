import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { getManagerDashboard } from "@/lib/db/queries/dashboard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activeRoles = new Set(context.memberships.map((membership) => membership.role));
  if (![...activeRoles].some((role) => ["owner", "admin", "manager"].includes(role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dashboard = await getManagerDashboard(context);
  return NextResponse.json(dashboard);
}
