import { NextResponse } from "next/server";
import { hasPlatformAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { updateOrganizationFeatures } from "@/lib/db/mutations/platform";
import { getOrganizationFeatureAccess } from "@/lib/db/queries/platform";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { organizationFeatureUpdateSchema } from "@/lib/validation/organization";

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
  const item = await getOrganizationFeatureAccess(organizationId);
  return NextResponse.json({ item });
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
  const parsed = organizationFeatureUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid organization feature payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { organizationId } = await params;
  const item = await updateOrganizationFeatures(organizationId, parsed.data, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "platform_organization_features_updated",
    severity: "medium",
    metadata: {
      organizationId,
      ...parsed.data
    }
  });
  return NextResponse.json({ item });
}
