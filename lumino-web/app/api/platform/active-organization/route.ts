import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { hasPlatformAccess } from "@/lib/auth/permissions";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const context = await getRequestSessionContext(request, { allowBlocked: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPlatformAccess(context)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { organizationId?: string | null } | null;
  const organizationId = body?.organizationId;

  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required." }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const orgResponse = await supabase
    .from("organizations")
    .select("id")
    .eq("id", organizationId)
    .maybeSingle();

  if (orgResponse.error) {
    return NextResponse.json({ error: orgResponse.error.message }, { status: 500 });
  }

  if (!orgResponse.data?.id) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  const updateResponse = await supabase
    .from("app_users")
    .update({
      default_organization_id: organizationId,
      updated_at: new Date().toISOString()
    })
    .eq("id", context.appUser.id);

  if (updateResponse.error) {
    return NextResponse.json({ error: updateResponse.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true as const, organizationId });
}
