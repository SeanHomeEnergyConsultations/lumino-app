import { NextResponse } from "next/server";
import { hasPlatformAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import {
  getPlatformOrganizationOverview
} from "@/lib/db/queries/platform";
import { replaceOrganizationDatasetEntitlements } from "@/lib/db/mutations/platform";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { organizationDatasetEntitlementsUpdateSchema } from "@/lib/validation/organization";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPlatformAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { organizationId } = await params;
  const items = await getPlatformOrganizationOverview(context);
  const item = items.find((entry) => entry.organizationId === organizationId);
  if (!item) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  return NextResponse.json({ item: item.datasetEntitlements });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> }
) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!context.isPlatformOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await request.json();
  const parsed = organizationDatasetEntitlementsUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid organization dataset entitlement payload", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { organizationId } = await params;
  const item = await replaceOrganizationDatasetEntitlements(organizationId, parsed.data, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "platform_organization_dataset_entitlements_updated",
    severity: "medium",
    metadata: {
      organizationId,
      ...parsed.data
    }
  });
  return NextResponse.json({ item });
}
