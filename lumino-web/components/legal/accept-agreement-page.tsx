"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authFetch, useAuth } from "@/lib/auth/client";
import { CLICKWRAP_TITLE, CURRENT_AGREEMENT_VERSION } from "@/lib/legal/clickwrap";

export function AcceptAgreementPage({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const { session, loading, appContext } = useAuth();
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !session) {
      router.replace("/login");
    }
  }, [loading, router, session]);

  useEffect(() => {
    if (!loading && session && appContext?.hasAcceptedRequiredAgreement) {
      router.replace(nextPath as Route);
    }
  }, [appContext?.hasAcceptedRequiredAgreement, loading, nextPath, router, session]);

  async function handleAccept() {
    if (!session?.access_token) return;
    if (!checked) {
      setError("You must check the box before continuing.");
      return;
    }

    setSubmitting(true);
    setError(null);
    const response = await authFetch(session.access_token, "/api/agreements/accept", {
      method: "POST",
      body: JSON.stringify({ accepted: true })
    });

    if (!response.ok) {
      const json = (await response.json().catch(() => null)) as { error?: string } | null;
      setSubmitting(false);
      setError(json?.error ?? "Could not save your agreement acceptance.");
      return;
    }

    router.replace(nextPath as Route);
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f7f3ea_0%,#edf2f8_100%)] px-6">
      <div className="w-full max-w-xl rounded-[2rem] border border-white/70 bg-white/85 p-8 shadow-panel backdrop-blur">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-mist">Agreement Required</div>
        <h1 className="mt-2 text-3xl font-semibold text-ink">{CLICKWRAP_TITLE}</h1>
        <p className="mt-3 text-sm leading-7 text-slate-600">
          Before entering Lumino, please review and accept version {CURRENT_AGREEMENT_VERSION}. This acceptance is stored for accountability.
        </p>

        <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <p>
            Read the full legal documents here:{" "}
            <Link href="/terms" className="font-semibold text-ink underline decoration-slate-300 underline-offset-4">
              Terms of Use
            </Link>
            {" · "}
            <Link href="/privacy" className="font-semibold text-ink underline decoration-slate-300 underline-offset-4">
              Privacy Policy
            </Link>
          </p>
        </div>

        <label className="mt-6 flex items-start gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-ink focus:ring-ink"
          />
          <span>I have reviewed the Terms of Use and acknowledge the Privacy Policy for this version of Lumino.</span>
        </label>

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : null}

        <button
          type="button"
          onClick={() => void handleAccept()}
          disabled={loading || !session || submitting}
          className="mt-6 w-full rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Saving agreement..." : "I Agree"}
        </button>
      </div>
    </main>
  );
}
