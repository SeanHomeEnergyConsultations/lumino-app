"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/client";

export default function HomePage() {
  const router = useRouter();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const params = url.searchParams;
    const hashParams = new URLSearchParams(
      window.location.hash.startsWith("#") ? window.location.hash.slice(1) : ""
    );

    const code = params.get("code");
    const tokenHash = params.get("token_hash");
    const type = params.get("type") ?? hashParams.get("type");
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");

    const hasRecoveryPayload =
      Boolean(code) || Boolean(accessToken && refreshToken) || Boolean(tokenHash && type === "recovery");

    if (hasRecoveryPayload) {
      const redirectUrl = new URL("/set-password", window.location.origin);
      params.forEach((value, key) => {
        redirectUrl.searchParams.set(key, value);
      });
      if (!redirectUrl.searchParams.has("mode")) {
        redirectUrl.searchParams.set("mode", "recovery");
      }
      const hash = window.location.hash;
      window.location.replace(`${redirectUrl.toString()}${hash}`);
      return;
    }

    if (loading) return;
    router.replace(session ? "/map" : "/login");
  }, [loading, router, session]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f7f3ea_0%,#edf2f8_100%)] px-6">
      <div className="rounded-3xl border border-white/70 bg-white/80 px-6 py-4 text-sm text-slate-600 shadow-panel backdrop-blur">
        Loading Lumino…
      </div>
    </main>
  );
}
