"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { authFetch, useAuth } from "@/lib/auth/client";
import { getAppNavigationContext } from "@/components/app-shell/navigation";
import { CommandSearch } from "@/components/shared/command-search";
import { trackAppEvent } from "@/lib/analytics/app-events";
import type { OrganizationsResponse } from "@/types/api";

export function AppTopbar({ onOpenNav }: { onOpenNav?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { supabase, session, appContext, appBranding, organizationBranding, refreshSessionContext } = useAuth();
  const effectiveBranding = organizationBranding ?? appBranding;
  const appName = effectiveBranding?.appName ?? "Lumino";
  const primaryColor = effectiveBranding?.primaryColor ?? "#0b1220";
  const accentColor = effectiveBranding?.accentColor ?? "#94a3b8";
  const navigationContext = getAppNavigationContext({ pathname, appContext });
  const [organizations, setOrganizations] = useState<OrganizationsResponse["items"]>([]);
  const [switchingOrg, setSwitchingOrg] = useState(false);
  const [orgSwitchFeedback, setOrgSwitchFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!session?.access_token || !appContext?.isPlatformOwner) return;

    authFetch(session.access_token, "/api/organizations")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as OrganizationsResponse;
      })
      .then((json) => {
        if (json) setOrganizations(json.items);
      })
      .catch(() => {
        setOrganizations([]);
      });
  }, [appContext?.isPlatformOwner, session?.access_token]);

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function handleSwitchOrganization(nextOrganizationId: string) {
    if (!session?.access_token || !appContext?.isPlatformOwner || !nextOrganizationId) return;
    if (nextOrganizationId === appContext.organizationId) return;

    setSwitchingOrg(true);
    setOrgSwitchFeedback(null);
    try {
      const response = await authFetch(session.access_token, "/api/platform/active-organization", {
        method: "PATCH",
        body: JSON.stringify({ organizationId: nextOrganizationId })
      });

      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as { error?: string } | null;
        setOrgSwitchFeedback({
          tone: "error",
          message: json?.error ?? "Could not switch organizations."
        });
        return;
      }

      await refreshSessionContext();
      router.refresh();
      trackAppEvent("auth.organization_switched", {
        fromOrganizationId: appContext.organizationId,
        toOrganizationId: nextOrganizationId
      });
      setOrgSwitchFeedback({
        tone: "success",
        message: "Organization switched."
      });
    } catch {
      setOrgSwitchFeedback({
        tone: "error",
        message: "Could not switch organizations."
      });
    } finally {
      setSwitchingOrg(false);
    }
  }

  return (
    <header className="app-topbar-surface flex flex-col gap-3 border-b px-4 py-3 md:px-6 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onOpenNav}
          className="app-chip app-focus-button inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-3 text-[rgba(var(--app-primary-rgb),0.78)] transition hover:brightness-105 xl:hidden"
          aria-label="Open app menu"
        >
          <Menu className="h-5 w-5" />
          <span className="text-sm font-semibold">Menu</span>
        </button>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: accentColor }}>
            {navigationContext.activeSection ? `${appName} · ${navigationContext.activeSection.label}` : appName}
          </div>
          <h1 className="text-lg font-semibold text-ink md:text-xl">
            {navigationContext.activeItem?.label ?? "Work the neighborhood"}
          </h1>
          <p className="mt-1 text-sm text-[rgba(var(--app-primary-rgb),0.62)]">
            {navigationContext.activeItem?.description ?? "Keep the team moving without getting lost in the product."}
          </p>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center xl:px-6">
        <CommandSearch />
      </div>
      <div className="flex items-center gap-3 self-end xl:self-auto">
        {appContext?.isPlatformOwner ? (
          <select
            value={appContext.organizationId ?? ""}
            disabled={switchingOrg || !organizations.length}
            onChange={(event) => void handleSwitchOrganization(event.target.value)}
            className="app-glass-input app-focus-ring max-w-[15rem] rounded-full px-3 py-1.5 text-sm text-[rgba(var(--app-primary-rgb),0.78)] disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Switch organization"
          >
            {organizations.map((organization) => (
              <option key={organization.organizationId} value={organization.organizationId}>
                {organization.appName || organization.name}
              </option>
            ))}
          </select>
        ) : null}
        <div className="app-chip rounded-full px-3 py-1.5 text-sm text-[rgba(var(--app-primary-rgb),0.72)]">
          {appContext?.appUser.fullName || appContext?.appUser.email || "Signed in"}
        </div>
        {supabase ? (
          <button
            type="button"
            onClick={handleSignOut}
            className="app-glass-button app-focus-button rounded-full px-3 py-1.5 text-sm text-[rgba(var(--app-primary-rgb),0.72)] transition hover:bg-[rgba(var(--app-primary-rgb),0.92)] hover:text-white"
            style={{ borderColor: `${primaryColor}33` }}
          >
            Sign out
          </button>
        ) : null}
      </div>
      {orgSwitchFeedback ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            orgSwitchFeedback.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
          aria-live="polite"
        >
          {orgSwitchFeedback.message}
        </div>
      ) : null}
    </header>
  );
}
