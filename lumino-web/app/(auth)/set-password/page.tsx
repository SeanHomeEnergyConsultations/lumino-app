"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/client";

export default function SetPasswordPage() {
  const router = useRouter();
  const { supabase, session, loading, envReady } = useAuth();
  const [mode, setMode] = useState("recovery");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextMode = new URLSearchParams(window.location.search).get("mode") ?? "recovery";
    setMode(nextMode);
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError("Supabase environment variables are missing.");
      return;
    }
    if (!session) {
      setError("This link is invalid or expired. Ask your manager to send a fresh one.");
      return;
    }
    if (password.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess(true);
    router.replace("/map");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white/80 p-8 shadow-panel backdrop-blur">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-mist">Lumino</div>
        <h1 className="mt-2 text-3xl font-semibold text-ink">
          {mode === "invite" ? "Finish your invite" : "Set a new password"}
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          {mode === "invite"
            ? "Set your password once and we’ll bring you straight into the app."
            : "Choose a new password to regain access to Lumino."}
        </p>

        {!envReady ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Supabase environment variables are missing. Add them to <code>.env.local</code>.
          </div>
        ) : null}

        {!loading && !session ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            This link is invalid or has expired. Ask your manager to resend the invite or password reset.
          </div>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">New password</span>
            <input
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none ring-0 transition focus:border-ink"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Confirm password</span>
            <input
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none ring-0 transition focus:border-ink"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
          ) : null}
          {success ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Password updated. Redirecting you to the map…
            </div>
          ) : null}
          <button
            type="submit"
            disabled={submitting || loading || !session}
            className="w-full rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Saving..." : "Set password"}
          </button>
        </form>
      </div>
    </main>
  );
}
