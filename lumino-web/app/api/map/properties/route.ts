import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { getMapPropertiesForViewport } from "@/lib/db/queries/map";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  const data = await getMapPropertiesForViewport({
    minLat: searchParams.get("minLat") ? Number(searchParams.get("minLat")) : undefined,
    maxLat: searchParams.get("maxLat") ? Number(searchParams.get("maxLat")) : undefined,
    minLng: searchParams.get("minLng") ? Number(searchParams.get("minLng")) : undefined,
    maxLng: searchParams.get("maxLng") ? Number(searchParams.get("maxLng")) : undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
    ownerId: searchParams.get("ownerId") || undefined,
    city: searchParams.get("city") || undefined,
    state: searchParams.get("state") || undefined
  });

  return NextResponse.json(data);
}
