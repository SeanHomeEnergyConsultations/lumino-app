"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { MobileBottomNav } from "@/components/app-shell/mobile-bottom-nav";
import { AppTopbar } from "@/components/app-shell/app-topbar";
import { useAuth } from "@/lib/auth/client";
import { getOrganizationThemeStyle, getResolvedOrganizationTheme } from "@/lib/branding/theme";

export function AppShell({ children }: { children: ReactNode }) {
  const { organizationBranding } = useAuth();
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
    const theme = getResolvedOrganizationTheme(organizationBranding);
    const root = document.documentElement;

    root.style.setProperty("--app-primary", theme.primaryColor);
    root.style.setProperty("--app-primary-rgb", theme.primaryColor.replace("#", "").match(/.{1,2}/g)?.map((value) => Number.parseInt(value, 16)).join(" ") ?? "11 18 32");
    root.style.setProperty("--app-accent", theme.accentColor);
    root.style.setProperty("--app-accent-rgb", theme.accentColor.replace("#", "").match(/.{1,2}/g)?.map((value) => Number.parseInt(value, 16)).join(" ") ?? "148 163 184");
    root.style.setProperty("--app-background", theme.backgroundColor);
    root.style.setProperty("--app-background-rgb", theme.backgroundColor.replace("#", "").match(/.{1,2}/g)?.map((value) => Number.parseInt(value, 16)).join(" ") ?? "244 239 230");
    root.style.setProperty("--app-background-accent", theme.backgroundAccentColor);
    root.style.setProperty("--app-background-accent-rgb", theme.backgroundAccentColor.replace("#", "").match(/.{1,2}/g)?.map((value) => Number.parseInt(value, 16)).join(" ") ?? "219 232 246");
    root.style.setProperty("--app-surface", theme.surfaceColor);
    root.style.setProperty("--app-surface-rgb", theme.surfaceColor.replace("#", "").match(/.{1,2}/g)?.map((value) => Number.parseInt(value, 16)).join(" ") ?? "255 255 255");
    root.style.setProperty("--app-sidebar", theme.sidebarColor);
    root.style.setProperty("--app-sidebar-rgb", theme.sidebarColor.replace("#", "").match(/.{1,2}/g)?.map((value) => Number.parseInt(value, 16)).join(" ") ?? "246 242 234");
  }, [organizationBranding]);

  return (
    <div className="app-frame flex min-h-screen" style={getOrganizationThemeStyle(organizationBranding)}>
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
