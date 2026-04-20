import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { hasPlatformAccess } from "@/lib/auth/permissions";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { organizationCreateSchema } from "@/lib/validation/organization";
import type { OrganizationCreateResponse, OrganizationsResponse } from "@/types/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request, { allowBlocked: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPlatformAccess(context)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = createServerSupabaseClient();
  const response = await supabase
    .from("organizations")
    .select("id,name,slug,status,billing_plan,brand_name,created_at")
    .order("created_at", { ascending: false });

  if (response.error?.message?.includes("brand_name")) {
    const fallback = await supabase
      .from("organizations")
      .select("id,name,slug,status,billing_plan,created_at")
      .order("created_at", { ascending: false });

    if (fallback.error) {
      return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    }

    const items: OrganizationsResponse["items"] = (fallback.data ?? []).map((row) => ({
      organizationId: row.id as string,
      name: row.name as string,
      slug: (row.slug as string | null | undefined) ?? null,
      status: row.status as string,
      billingPlan: row.billing_plan as string,
      appName: null,
      createdAt: row.created_at as string
    }));

    return NextResponse.json({ items } satisfies OrganizationsResponse);
  }

  if (response.error) {
    return NextResponse.json({ error: response.error.message }, { status: 500 });
  }

  const items: OrganizationsResponse["items"] = (response.data ?? []).map((row) => ({
    organizationId: row.id as string,
    name: row.name as string,
    slug: (row.slug as string | null | undefined) ?? null,
    status: row.status as string,
    billingPlan: row.billing_plan as string,
    appName: (row.brand_name as string | null | undefined) ?? null,
    createdAt: row.created_at as string
  }));

  return NextResponse.json({ items } satisfies OrganizationsResponse);
}

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request, { allowBlocked: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPlatformAccess(context)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = organizationCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid organization payload." }, { status: 400 });
  }

  const input = parsed.data;
  const supabase = createServerSupabaseClient();
  const insertResponse = await supabase
    .from("organizations")
    .insert({
      name: input.name.trim(),
      slug: input.slug?.trim() || null,
      status: "active",
      billing_plan: "free"
    })
    .select("id,name,slug,status,billing_plan,created_at")
    .single();

  if (insertResponse.error) {
    return NextResponse.json({ error: insertResponse.error.message }, { status: 500 });
  }

  if (input.appName?.trim()) {
    await supabase
      .from("organizations")
      .update({ brand_name: input.appName.trim(), updated_at: new Date().toISOString() })
      .eq("id", insertResponse.data.id);
  }

  const item = {
    organizationId: insertResponse.data.id as string,
    name: insertResponse.data.name as string,
    slug: (insertResponse.data.slug as string | null | undefined) ?? null,
    status: insertResponse.data.status as string,
    billingPlan: insertResponse.data.billing_plan as string,
    appName: input.appName?.trim() || null,
    createdAt: insertResponse.data.created_at as string
  };

  return NextResponse.json({ item } satisfies OrganizationCreateResponse);
}
