"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { MobileBottomNav } from "@/components/app-shell/mobile-bottom-nav";
import { AppTopbar } from "@/components/app-shell/app-topbar";
import { useAuth } from "@/lib/auth/client";
import { getOrganizationThemeStyle, getOrganizationThemeVariables } from "@/lib/branding/theme";

export function AppShell({ children }: { children: ReactNode }) {
  const { appBranding, organizationBranding } = useAuth();
  const effectiveBranding = organizationBranding ?? appBranding;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    const root = document.documentElement;
    const variables = getOrganizationThemeVariables(effectiveBranding);
    for (const [key, value] of Object.entries(variables)) {
      root.style.setProperty(key, value);
    }
  }, [effectiveBranding]);

  return (
    <div className="app-frame flex min-h-screen" style={getOrganizationThemeStyle(effectiveBranding)}>
      <div className="hidden xl:block">
        <AppSidebar />
      </div>
      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-slate-950/35"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative h-full w-[19rem] max-w-[86vw]">
            <AppSidebar />
          </div>
        </div>
      ) : null}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <AppTopbar onOpenNav={() => setMobileNavOpen(true)} />
        <main className="min-h-0 flex-1 pb-24 xl:pb-0">{children}</main>
      </div>
      <MobileBottomNav onOpenMenu={() => setMobileNavOpen(true)} />
    </div>
  );
}
