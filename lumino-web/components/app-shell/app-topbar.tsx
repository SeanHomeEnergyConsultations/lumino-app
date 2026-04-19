"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { authFetch, useAuth } from "@/lib/auth/client";
import { CommandSearch } from "@/components/shared/command-search";
import type { OrganizationsResponse } from "@/types/api";

export function AppTopbar({ onOpenNav }: { onOpenNav?: () => void }) {
  const router = useRouter();
  const { supabase, session, appContext, organizationBranding } = useAuth();
  const appName = organizationBranding?.appName ?? "Lumino";
  const primaryColor = organizationBranding?.primaryColor ?? "#0b1220";
  const accentColor = organizationBranding?.accentColor ?? "#94a3b8";
  const [organizations, setOrganizations] = useState<OrganizationsResponse["items"]>([]);
  const [switchingOrg, setSwitchingOrg] = useState(false);

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
    try {
      const response = await authFetch(session.access_token, "/api/platform/active-organization", {
        method: "PATCH",
        body: JSON.stringify({ organizationId: nextOrganizationId })
      });

      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as { error?: string } | null;
        window.alert(json?.error ?? "Could not switch organizations.");
        setSwitchingOrg(false);
        return;
      }

      window.location.reload();
    } catch {
      window.alert("Could not switch organizations.");
      setSwitchingOrg(false);
    }
  }

  return (
    <header className="flex flex-col gap-3 border-b border-slate-200/80 bg-white/70 px-4 py-3 backdrop-blur md:px-6 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onOpenNav}
          className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 xl:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: accentColor }}>
            {appName}
          </div>
          <h1 className="text-lg font-semibold text-ink md:text-xl">Work the neighborhood, not the menu</h1>
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
            className="max-w-[15rem] rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none transition focus:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {organizations.map((organization) => (
              <option key={organization.organizationId} value={organization.organizationId}>
                {organization.appName || organization.name}
              </option>
            ))}
          </select>
        ) : null}
        <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600">
          {appContext?.appUser.fullName || appContext?.appUser.email || "Signed in"}
        </div>
        {supabase ? (
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-full border bg-white px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-950 hover:text-white"
            style={{ borderColor: `${primaryColor}33` }}
          >
            Sign out
          </button>
        ) : null}
      </div>
    </header>
  );
}
