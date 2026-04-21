import { NextResponse } from "next/server";
import { hasAdminAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { updateOrganizationBranding } from "@/lib/db/mutations/organization";
import { getOrganizationBranding } from "@/lib/db/queries/organization";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { organizationBrandingSchema } from "@/lib/validation/organization";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const item = await getOrganizationBranding(context);
  return NextResponse.json({ item });
}

export async function PATCH(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAdminAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "organization_branding_update",
    limit: 30,
    windowSeconds: 3600,
    logEventType: "organization_branding_update_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many branding changes. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json();
  const parsed = organizationBrandingSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid branding payload", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const previous = await getOrganizationBranding(context);
  const item = await updateOrganizationBranding(
    {
      appName: parsed.data.appName,
      logoUrl: parsed.data.logoUrl || null,
      primaryColor: parsed.data.primaryColor || null,
      accentColor: parsed.data.accentColor || null,
      backgroundColor: parsed.data.backgroundColor || null,
      backgroundAccentColor: parsed.data.backgroundAccentColor || null,
      surfaceColor: parsed.data.surfaceColor || null,
      sidebarColor: parsed.data.sidebarColor || null
    },
    context
  );
  await recordSecurityEvent({
    request,
    context,
    eventType: "organization_branding_updated",
    severity: "medium",
    metadata: {
      previousAppName: previous.appName,
      previousLogoUrl: previous.logoUrl,
      previousPrimaryColor: previous.primaryColor,
      previousAccentColor: previous.accentColor,
      previousBackgroundColor: previous.backgroundColor,
      previousBackgroundAccentColor: previous.backgroundAccentColor,
      previousSurfaceColor: previous.surfaceColor,
      previousSidebarColor: previous.sidebarColor,
      appName: parsed.data.appName,
      hasLogoUrl: Boolean(parsed.data.logoUrl),
      logoUrl: parsed.data.logoUrl || null,
      primaryColor: parsed.data.primaryColor || null,
      accentColor: parsed.data.accentColor || null,
      backgroundColor: parsed.data.backgroundColor || null,
      backgroundAccentColor: parsed.data.backgroundAccentColor || null,
      surfaceColor: parsed.data.surfaceColor || null,
      sidebarColor: parsed.data.sidebarColor || null
    }
  });
  return NextResponse.json({ item });
}
