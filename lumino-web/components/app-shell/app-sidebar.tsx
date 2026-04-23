"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { LogoMark } from "@/components/shared/logo-mark";
import { useAuth } from "@/lib/auth/client";
import { getSidebarNavigation } from "@/components/app-shell/navigation";
import { trackAppEvent } from "@/lib/analytics/app-events";

export function AppSidebar() {
  const pathname = usePathname();
  const { appBranding, organizationBranding, appContext } = useAuth();
  const effectiveBranding = organizationBranding ?? appBranding;
  const appName = effectiveBranding?.appName ?? "Lumino";
  const primaryColor = effectiveBranding?.primaryColor ?? "#0b1220";
  const accentColor = effectiveBranding?.accentColor ?? "#94a3b8";
  const { activeItem, primaryItems, secondarySections, secondaryCount, activeInSecondary } = getSidebarNavigation({
    pathname,
    appContext
  });
  const [secondaryOpen, setSecondaryOpen] = useState(activeInSecondary);

  useEffect(() => {
    if (activeInSecondary) {
      setSecondaryOpen(true);
    }
  }, [activeInSecondary]);

  function renderNavItem(input: {
    href: Route;
    label: string;
    icon: ComponentType<{ className?: string }>;
    compact?: boolean;
  }) {
    const { href, label, icon: Icon, compact = false } = input;
    const active = pathname === href || pathname?.startsWith(`${href}/`);

    return (
      <Link
        key={href}
        href={href}
        className={`group flex items-center gap-3 rounded-[1.25rem] px-3 transition ${
          compact ? "py-2.5" : "py-3"
        } ${active ? "text-white shadow-panel" : "text-slate-700 hover:bg-[rgba(var(--app-primary-rgb),0.92)] hover:text-white"}`}
        style={active ? { backgroundColor: primaryColor } : undefined}
      >
        <span
          className={`flex shrink-0 items-center justify-center rounded-2xl transition ${
            compact ? "h-8 w-8" : "h-9 w-9"
          } ${
            active
              ? "bg-white/14 text-white"
              : "bg-white/70 text-[rgba(var(--app-primary-rgb),0.72)] group-hover:bg-white/12 group-hover:text-white"
          }`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className={`min-w-0 truncate ${compact ? "text-sm font-medium" : "text-sm font-semibold"}`}>{label}</span>
      </Link>
    );
  }

  return (
    <aside className="app-sidebar-surface flex h-full w-64 shrink-0 flex-col border-r px-4 py-6">
      <div className="flex items-center gap-3">
        <LogoMark
          appName={appName}
          logoUrl={effectiveBranding?.logoUrl ?? null}
          logoScale={effectiveBranding?.logoScale ?? 1}
          primaryColor={primaryColor}
        />
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.24em]" style={{ color: accentColor }}>
            {appName}
          </div>
          <div className="text-lg font-semibold text-ink">Field OS</div>
        </div>
      </div>

      <nav className="mt-8 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-1">
        <section>
          <div className="px-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(var(--app-primary-rgb),0.42)]">
              Core Workflow
            </div>
          </div>
          <div className="mt-2 space-y-1.5">
            {primaryItems.map(({ href, label, icon }) => renderNavItem({ href, label, icon }))}
          </div>
        </section>

        {secondarySections.length ? (
          <section>
            <button
              type="button"
              onClick={() =>
                setSecondaryOpen((current) => {
                  const next = !current;
                  trackAppEvent("sidebar.secondary_toggled", {
                    open: next,
                    count: secondaryCount
                  });
                  return next;
                })
              }
              className="flex w-full items-center justify-between rounded-[1.25rem] px-3 py-2 text-left transition hover:bg-white/70"
              aria-expanded={secondaryOpen}
            >
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(var(--app-primary-rgb),0.42)]">
                  More Tools
                </div>
                <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.56)]">{secondaryCount} additional surfaces</div>
              </div>
              <ChevronDown
                className={`h-4 w-4 text-[rgba(var(--app-primary-rgb),0.5)] transition ${secondaryOpen ? "rotate-180" : ""}`}
              />
            </button>

            {secondaryOpen ? (
              <div className="mt-3 space-y-4">
                {secondarySections.map((section) => (
                  <div key={section.id}>
                    <div className="px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgba(var(--app-primary-rgb),0.36)]">
                      {section.label}
                    </div>
                    <div className="mt-1.5 space-y-1">
                      {section.items.map(({ href, label, icon }) => renderNavItem({ href, label, icon, compact: true }))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {activeItem ? (
          <section className="mt-auto rounded-[1.5rem] border border-[rgba(var(--app-primary-rgb),0.08)] bg-white/72 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(var(--app-primary-rgb),0.42)]">
              Current Surface
            </div>
            <div className="mt-2 text-sm font-semibold text-ink">{activeItem.label}</div>
            <div className="mt-1 text-xs leading-5 text-[rgba(var(--app-primary-rgb),0.56)]">
              {activeItem.description}
            </div>
          </section>
        ) : null}
      </nav>
    </aside>
  );
}
