import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const json = (await request.json()) as {
      name?: string;
      pathname?: string;
      recordedAt?: string;
      payload?: Record<string, unknown>;
    };

    if (!json.name || typeof json.name !== "string") {
      return NextResponse.json({ error: "Missing event name." }, { status: 400 });
    }

    console.info("[lumino-app-event]", {
      name: json.name,
      pathname: json.pathname ?? null,
      recordedAt: json.recordedAt ?? null,
      payload: json.payload ?? {}
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid event payload." }, { status: 400 });
  }
}
