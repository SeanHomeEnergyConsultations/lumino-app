import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { searchEntities } from "@/lib/db/queries/search";
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
    bucket: "search",
    limit: 60,
    windowSeconds: 60,
    logEventType: "search_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many search requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const results = await searchEntities(q, context);
  return NextResponse.json(results);
}
