import { NextResponse } from "next/server";
import { z } from "zod";
import { hasPlatformAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { publishImportBatchAsPlatformDataset } from "@/lib/db/mutations/platform-datasets";
import { getPlatformDatasets } from "@/lib/db/queries/platform-datasets";
import { recordSecurityEvent } from "@/lib/security/security-events";

const publishSchema = z.object({
  batchId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(400).nullable().optional()
});

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPlatformAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const items = await getPlatformDatasets(context);
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!context.isPlatformOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await request.json();
  const parsed = publishSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid dataset payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const result = await publishImportBatchAsPlatformDataset(parsed.data, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "platform_dataset_published",
    severity: "medium",
    metadata: {
      batchId: parsed.data.batchId,
      datasetId: result.datasetId,
      alreadyPublished: result.alreadyPublished
    }
  });
  return NextResponse.json(result);
}
