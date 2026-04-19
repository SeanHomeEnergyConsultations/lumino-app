import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { getMapPropertiesForViewport } from "@/lib/db/queries/map";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "map_properties",
    limit: 120,
    windowSeconds: 60,
    logEventType: "map_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many map refresh requests. Please slow down and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const { searchParams } = new URL(request.url);

  const data = await getMapPropertiesForViewport(context, {
    minLat: searchParams.get("minLat") ? Number(searchParams.get("minLat")) : undefined,
    maxLat: searchParams.get("maxLat") ? Number(searchParams.get("maxLat")) : undefined,
    minLng: searchParams.get("minLng") ? Number(searchParams.get("minLng")) : undefined,
    maxLng: searchParams.get("maxLng") ? Number(searchParams.get("maxLng")) : undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
    ownerId: searchParams.get("ownerId") || undefined,
    city: searchParams.get("city") || undefined,
    state: searchParams.get("state") || undefined,
    showTeamKnocks: searchParams.get("showTeamKnocks") === "1"
  });

  return NextResponse.json(data);
}
