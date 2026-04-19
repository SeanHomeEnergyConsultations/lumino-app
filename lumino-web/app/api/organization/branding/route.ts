import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { updateOrganizationBranding } from "@/lib/db/mutations/organization";
import { getOrganizationBranding } from "@/lib/db/queries/organization";
import { organizationBrandingSchema } from "@/lib/validation/organization";

function canManageOrganization(roles: string[]) {
  return roles.some((role) => ["owner", "admin"].includes(role));
}

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
  if (!canManageOrganization(context.memberships.map((item) => item.role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await request.json();
  const parsed = organizationBrandingSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid branding payload", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const item = await updateOrganizationBranding(
    {
      appName: parsed.data.appName,
      logoUrl: parsed.data.logoUrl || null,
      primaryColor: parsed.data.primaryColor || null,
      accentColor: parsed.data.accentColor || null
    },
    context
  );
  return NextResponse.json({ item });
}
