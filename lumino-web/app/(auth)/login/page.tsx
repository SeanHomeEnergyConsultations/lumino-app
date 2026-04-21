"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/client";
import { LogoMark } from "@/components/shared/logo-mark";

export default function LoginPage() {
  const router = useRouter();
  const { supabase, envReady } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetState, setResetState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [recoveryRedirecting, setRecoveryRedirecting] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!supabase || typeof window === "undefined") return;
    const supabaseClient = supabase;

    let cancelled = false;

    async function handleRecoveryFromLogin() {
      const url = new URL(window.location.href);
      const params = url.searchParams;
      const hashParams = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "");

      const code = params.get("code");
      const tokenHash = params.get("token_hash");
      const type = params.get("type") ?? hashParams.get("type");
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      const hasRecoveryPayload =
        Boolean(code) || Boolean(accessToken && refreshToken) || Boolean(tokenHash && type === "recovery");

      if (!hasRecoveryPayload) return;

      setRecoveryRedirecting(true);
      try {
        if (code) {
          const { error: exchangeError } = await supabaseClient.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (tokenHash && type === "recovery") {
          const { error: verifyError } = await supabaseClient.auth.verifyOtp({
            token_hash: tokenHash,
            type: "recovery"
          });
          if (verifyError) throw verifyError;
        } else if (accessToken && refreshToken) {
          const { error: setSessionError } = await supabaseClient.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });
          if (setSessionError) throw setSessionError;
        }

        if (cancelled) return;
        router.replace("/set-password?mode=recovery");
      } catch (recoveryError) {
        if (cancelled) return;
        setRecoveryRedirecting(false);
        setError(
          recoveryError instanceof Error
            ? recoveryError.message
            : "This password reset link is invalid or has expired."
        );
      }
    }

    void handleRecoveryFromLogin();

    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError("Supabase environment variables are missing.");
      return;
    }
    setLoading(true);
    setError(null);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        password
      })
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; session?: { access_token: string; refresh_token: string } }
      | null;

    if (!response.ok || !payload?.session) {
      setLoading(false);
      setError(payload?.error ?? "Invalid email or password.");
      return;
    }

    const { error: setSessionError } = await supabase.auth.setSession({
      access_token: payload.session.access_token,
      refresh_token: payload.session.refresh_token
    });

    setLoading(false);
    if (setSessionError) {
      setError(setSessionError.message);
      return;
    }

    router.replace("/map");
  }

  async function handleForgotPassword() {
    if (!supabase) {
      setError("Supabase environment variables are missing.");
      return;
    }
    if (!email.trim()) {
      setError("Enter your email first, then tap Forgot password.");
      return;
    }

    setError(null);
    setResetState("sending");
    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/set-password?mode=recovery`
        : undefined;

    const response = await fetch("/api/auth/password-reset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: email.trim(),
        redirectTo
      })
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setResetState("error");
      setError(payload?.error ?? "Unable to send a password reset right now.");
      return;
    }

    setResetState("sent");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white/80 p-8 shadow-panel backdrop-blur">
        <div className="flex items-center gap-3">
          <LogoMark appName="Lumino" primaryColor="#0b1220" />
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-mist">Lumino</div>
        </div>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Sign in</h1>
        <p className="mt-3 text-sm text-slate-600">
          Use your existing Supabase account to access the new map-first field CRM.
        </p>
        {mounted && !envReady ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Supabase environment variables are missing. Add them to <code>.env.local</code>.
          </div>
        ) : null}
        {recoveryRedirecting ? (
          <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
            Reset link verified. Redirecting you to set a new password…
          </div>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
            <input
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none ring-0 transition focus:border-ink"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
            <input
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none ring-0 transition focus:border-ink"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => void handleForgotPassword()}
              disabled={loading || resetState === "sending" || (mounted && !envReady)}
              className="text-sm font-medium text-slate-600 transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resetState === "sending" ? "Sending reset..." : "Forgot password?"}
            </button>
          </div>
          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
          ) : null}
          {resetState === "sent" ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Password reset email sent. Open the link in your inbox to set a new password.
            </div>
          ) : null}
          <button
            type="submit"
            disabled={loading || (mounted && !envReady)}
            className="w-full rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
