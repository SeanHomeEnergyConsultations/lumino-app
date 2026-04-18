import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { getDailySummaryReport } from "@/lib/db/queries/reporting";

function canViewManagerReporting(roles: string[]) {
  return roles.some((role) => ["owner", "admin", "manager"].includes(role));
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewManagerReporting(context.memberships.map((item) => item.role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const summary = await getDailySummaryReport(context);
  return NextResponse.json(summary);
}
