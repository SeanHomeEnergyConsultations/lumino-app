"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/client";
import { CommandSearch } from "@/components/shared/command-search";

export function AppTopbar() {
  const router = useRouter();
  const { supabase, appContext } = useAuth();

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <header className="flex flex-col gap-3 border-b border-slate-200/80 bg-white/70 px-4 py-3 backdrop-blur md:px-6 xl:flex-row xl:items-center xl:justify-between">
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-mist">Live Field Map</div>
        <h1 className="text-lg font-semibold text-ink md:text-xl">Work the neighborhood, not the menu</h1>
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
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-950 hover:text-white"
          >
            Sign out
          </button>
        ) : null}
      </div>
    </header>
  );
}
