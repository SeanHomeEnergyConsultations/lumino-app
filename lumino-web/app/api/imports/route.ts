import { NextResponse } from "next/server";
import { hasManagerAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { ingestImportUpload } from "@/lib/db/mutations/imports";
import { getRecentImportBatches } from "@/lib/db/queries/imports";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { importUploadSchema } from "@/lib/validation/imports";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasManagerAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const items = await getRecentImportBatches(context);
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasManagerAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "imports_create",
    limit: 10,
    windowSeconds: 600,
    logEventType: "import_create_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many import uploads. Please wait before creating another batch." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json();
  const parsed = importUploadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid import payload",
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const result = await ingestImportUpload(parsed.data, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "import_batch_created",
    severity: "info",
    metadata: {
      batchId: result.batchId,
      filename: parsed.data.filename,
      rowCount: parsed.data.rows.length
    }
  });
  return NextResponse.json(result);
}
