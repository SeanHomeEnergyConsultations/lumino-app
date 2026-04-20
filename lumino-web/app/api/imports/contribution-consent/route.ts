import { NextResponse } from "next/server";
import { hasManagerAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import {
  getOrganizationUploadConsentStatus,
  recordOrganizationUploadConsent
} from "@/lib/platform/upload-consent";
import { recordSecurityEvent } from "@/lib/security/security-events";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasManagerAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const item = await getOrganizationUploadConsentStatus(context);
  return NextResponse.json({ item });
}

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasManagerAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const item = await recordOrganizationUploadConsent(request, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "organization_upload_consent_recorded",
    severity: "medium",
    metadata: {
      organizationId: context.organizationId,
      consentVersion: item.consentVersion
    }
  });
  return NextResponse.json({ item });
}
