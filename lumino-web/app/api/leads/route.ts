import { NextResponse } from "next/server";
import { getRequestSessionContext } from "@/lib/auth/server";
import { upsertLead } from "@/lib/db/mutations/leads";
import { getLeads } from "@/lib/db/queries/leads";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { leadInputSchema } from "@/lib/validation/leads";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const items = await getLeads(context, {
    ownerId: searchParams.get("ownerId"),
    q: searchParams.get("q"),
    status: searchParams.get("status"),
    city: searchParams.get("city"),
    state: searchParams.get("state"),
    followUp: (searchParams.get("followUp") as "all" | "overdue" | "scheduled" | "none" | null) ?? "all",
    appointment: (searchParams.get("appointment") as "all" | "scheduled" | "none" | null) ?? "all"
  });
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "lead_upsert",
    limit: 120,
    windowSeconds: 300,
    logEventType: "lead_upsert_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many lead updates. Please slow down and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json();
  const parsed = leadInputSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid lead payload",
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const result = await upsertLead(parsed.data, context);
  await recordSecurityEvent({
    request,
    context,
    eventType: "lead_upserted",
    severity: "low",
    metadata: {
      leadId: result.leadId,
      propertyId: result.propertyId
    }
  });
  return NextResponse.json(result);
}
