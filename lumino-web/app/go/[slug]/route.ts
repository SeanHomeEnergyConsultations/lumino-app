import { NextResponse } from "next/server";
import { recordQrEvent } from "@/lib/db/mutations/qr";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("qr_codes")
    .select("id,organization_id,payload")
    .eq("slug", slug)
    .eq("code_type", "campaign_tracker")
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Campaign tracker not found." }, { status: 404 });
  }

  const destinationUrl =
    typeof data.payload?.destinationUrl === "string" ? data.payload.destinationUrl : null;
  if (!destinationUrl) {
    return NextResponse.json({ error: "Campaign tracker is missing a destination URL." }, { status: 404 });
  }

  await recordQrEvent({
    qrCodeId: data.id as string,
    organizationId: data.organization_id as string,
    eventType: "scan",
    request
  }).catch(() => null);

  return NextResponse.redirect(destinationUrl, 302);
}
