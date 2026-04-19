"use client";

import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { useAuth } from "@/lib/auth/client";
import { CommandSearch } from "@/components/shared/command-search";

export function AppTopbar({ onOpenNav }: { onOpenNav?: () => void }) {
  const router = useRouter();
  const { supabase, appContext, organizationBranding } = useAuth();
  const appName = organizationBranding?.appName ?? "Lumino";
  const primaryColor = organizationBranding?.primaryColor ?? "#0b1220";
  const accentColor = organizationBranding?.accentColor ?? "#94a3b8";

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    router.replace("/login");
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
