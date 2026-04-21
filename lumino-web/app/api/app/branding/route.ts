import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { getAppBranding } from "@/lib/db/queries/app-branding";
import { updateAppBranding } from "@/lib/db/mutations/app-branding";
import { organizationBrandingSchema } from "@/lib/validation/organization";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const item = await getAppBranding(context);
  return NextResponse.json({ item });
}

export async function PATCH(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!context.isPlatformOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "app_branding_update",
    limit: 20,
    windowSeconds: 3600,
    logEventType: "app_branding_update_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many app branding changes. Please wait before trying again." },
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

  const previous = await getAppBranding(context);
  const item = await updateAppBranding(
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
    eventType: "app_branding_updated",
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
