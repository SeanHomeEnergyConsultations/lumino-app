import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestSessionContext } from "@/lib/auth/server";
import { grantPlatformDatasetToOrganization } from "@/lib/db/mutations/platform-datasets";
import { recordSecurityEvent } from "@/lib/security/security-events";

const grantSchema = z.object({
  organizationId: z.string().uuid(),
  visibilityScope: z.enum(["organization", "team", "assigned_user"]).default("organization"),
  assignedTeamId: z.string().uuid().nullable().optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  status: z.enum(["active", "paused", "revoked"]).default("active")
});

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ datasetId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!context.isPlatformOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await request.json();
  const parsed = grantSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid dataset grant payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { datasetId } = await params;
  const result = await grantPlatformDatasetToOrganization({ datasetId, ...parsed.data }, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "platform_dataset_granted",
    severity: "medium",
    metadata: {
      datasetId,
      organizationId: parsed.data.organizationId,
      status: parsed.data.status
    }
  });
  return NextResponse.json(result);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ datasetId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!context.isPlatformOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await request.json();
  const parsed = grantSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid dataset grant payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { datasetId } = await params;
  const result = await grantPlatformDatasetToOrganization({ datasetId, ...parsed.data }, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "platform_dataset_grant_updated",
    severity: "medium",
    metadata: {
      datasetId,
      organizationId: parsed.data.organizationId,
      status: parsed.data.status
    }
  });
  return NextResponse.json(result);
}
