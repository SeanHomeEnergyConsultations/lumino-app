import { NextResponse } from "next/server";
import { hasAdminAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { deleteOrphanAppUser } from "@/lib/db/mutations/team";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { teamCleanupSchema } from "@/lib/validation/team";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await getRequestSessionContext(request);
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasAdminAccess(context)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const json = await request.json();
    const parsed = teamCleanupSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid cleanup payload", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    if (parsed.data.action === "delete_orphan_app_user") {
      const result = await deleteOrphanAppUser(parsed.data.userId, context);
      await recordSecurityEvent({
        request,
        context,
        eventType: "team_cleanup_orphan_user",
        severity: "high",
        metadata: {
          userId: parsed.data.userId
        }
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Unsupported cleanup action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to clean up team issue." },
      { status: 500 }
    );
  }
}
