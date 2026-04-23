"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { hasAnyRole, hasFeatureAccess, hasPlatformAccess } from "@/lib/auth/permissions";
import { useAuth } from "@/lib/auth/client";
import type { OrganizationFeatureAccess } from "@/types/entities";

export function ProtectedAppShell({
  children,
  allowedRoles,
  platformOnly = false,
  platformOwnerOnly = false,
  requiredFeature
}: {
  children: React.ReactNode;
  allowedRoles?: string[];
  platformOnly?: boolean;
  platformOwnerOnly?: boolean;
  requiredFeature?: keyof OrganizationFeatureAccess;
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
    if (!loading && session && platformOwnerOnly) {
      const allowed = Boolean(appContext?.isPlatformOwner);
      if (!allowed) {
        router.replace("/map");
      }
    }
  }, [appContext?.isPlatformOwner, loading, platformOwnerOnly, router, session]);

  useEffect(() => {
    if (!loading && session && allowedRoles?.length) {
      const allowed = appContext ? hasAnyRole(appContext, allowedRoles) : false;
      if (!allowed) {
        router.replace("/map");
      }
    }
  }, [allowedRoles, appContext?.memberships, loading, router, session]);

  useEffect(() => {
    if (!loading && session && requiredFeature) {
      const allowed = appContext ? hasFeatureAccess(appContext, requiredFeature) : false;
      if (!allowed) {
        router.replace("/map");
      }
    }
  }, [appContext, loading, requiredFeature, router, session]);

  if (mounted && !envReady) {
    return (
      <div className="app-frame flex min-h-screen items-center justify-center px-6">
        <div className="app-panel max-w-md rounded-3xl border p-6 text-sm text-[rgba(var(--app-primary-rgb),0.72)]">
          Missing Supabase environment variables. Add them to <code>.env.local</code> to use the new app.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="app-frame flex min-h-screen items-center justify-center">
        <div className="app-panel rounded-3xl border px-6 py-4 text-sm text-[rgba(var(--app-primary-rgb),0.72)]">
          Loading Lumino…
        </div>
      </div>
    );
  }

  if (!session) return null;
  if (!appContext) {
    return (
      <div className="app-frame flex min-h-screen items-center justify-center px-6">
        <div className="app-panel max-w-md rounded-3xl border p-6 text-sm text-[rgba(var(--app-primary-rgb),0.72)]">
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
      <div className="app-frame flex min-h-screen items-center justify-center px-6">
        <div className="app-panel max-w-md rounded-3xl border p-6 text-sm text-[rgba(var(--app-primary-rgb),0.72)]">
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
  if (platformOwnerOnly && !appContext.isPlatformOwner) {
    return null;
  }
  if (allowedRoles?.length) {
    const allowed = appContext ? hasAnyRole(appContext, allowedRoles) : false;
    if (!allowed) return null;
  }
  if (requiredFeature) {
    const allowed = appContext ? hasFeatureAccess(appContext, requiredFeature) : false;
    if (!allowed) return null;
  }

  return <AppShell>{children}</AppShell>;
}
