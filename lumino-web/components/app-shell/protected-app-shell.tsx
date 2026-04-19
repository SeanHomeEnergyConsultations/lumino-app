"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { hasAnyRole, hasPlatformAccess } from "@/lib/auth/permissions";
import { useAuth } from "@/lib/auth/client";

export function ProtectedAppShell({
  children,
  allowedRoles,
  platformOnly = false
}: {
  children: React.ReactNode;
  allowedRoles?: string[];
  platformOnly?: boolean;
}) {
  const router = useRouter();
  const { session, loading, envReady, appContext } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!loading && !session) {
      router.replace("/login");
    }
  }, [loading, router, session]);

  useEffect(() => {
    if (!loading && session && appContext && !appContext.hasAcceptedRequiredAgreement) {
      router.replace("/accept-agreement");
    }
  }, [appContext, loading, router, session]);

  useEffect(() => {
    if (!loading && session && platformOnly) {
      const allowed = appContext ? hasPlatformAccess(appContext) : false;
      if (!allowed) {
        router.replace("/map");
      }
    }
  }, [appContext, loading, platformOnly, router, session]);

  useEffect(() => {
    if (!loading && session && allowedRoles?.length) {
      const allowed = appContext ? hasAnyRole(appContext, allowedRoles) : false;
      if (!allowed) {
        router.replace("/map");
      }
    }
  }, [allowedRoles, appContext?.memberships, loading, router, session]);

  if (mounted && !envReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f7f3ea_0%,#edf2f8_100%)] px-6">
        <div className="max-w-md rounded-3xl border border-white/70 bg-white/80 p-6 text-sm text-slate-600 shadow-panel backdrop-blur">
          Missing Supabase environment variables. Add them to <code>.env.local</code> to use the new app.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f7f3ea_0%,#edf2f8_100%)]">
        <div className="rounded-3xl border border-white/70 bg-white/80 px-6 py-4 text-sm text-slate-600 shadow-panel backdrop-blur">
          Loading Lumino…
        </div>
      </div>
    );
  }

  if (!session) return null;
  if (!appContext) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f7f3ea_0%,#edf2f8_100%)] px-6">
        <div className="max-w-md rounded-3xl border border-white/70 bg-white/80 p-6 text-sm text-slate-600 shadow-panel backdrop-blur">
          Your session could not be verified for this organization. Sign out and back in, or ask an admin to confirm your access.
        </div>
      </div>
    );
  }
  if (!appContext.hasActiveAccess) {
    const message =
      appContext.accessBlockedReason === "user_disabled"
        ? "Your account is currently disabled. Contact your organization admin for access."
        : appContext.accessBlockedReason === "organization_disabled"
          ? "This organization is currently suspended. Contact Sean Dotts for account help."
          : "You no longer have an active organization membership. Ask an admin to restore your access.";

    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f7f3ea_0%,#edf2f8_100%)] px-6">
        <div className="max-w-md rounded-3xl border border-white/70 bg-white/80 p-6 text-sm text-slate-600 shadow-panel backdrop-blur">
          {message}
        </div>
      </div>
    );
  }
  if (appContext && !appContext.hasAcceptedRequiredAgreement) return null;
  if (platformOnly) {
    const allowed = appContext ? hasPlatformAccess(appContext) : false;
    if (!allowed) return null;
  }
  if (allowedRoles?.length) {
    const allowed = appContext ? hasAnyRole(appContext, allowedRoles) : false;
    if (!allowed) return null;
  }

  return <AppShell>{children}</AppShell>;
}
