"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/shared/logo-mark";
import { useAuth } from "@/lib/auth/client";
import { getGroupedVisibleAppNav } from "@/components/app-shell/navigation";

export function AppSidebar() {
  const pathname = usePathname();
  const { appBranding, organizationBranding, appContext } = useAuth();
  const effectiveBranding = organizationBranding ?? appBranding;
  const appName = effectiveBranding?.appName ?? "Lumino";
  const primaryColor = effectiveBranding?.primaryColor ?? "#0b1220";
  const accentColor = effectiveBranding?.accentColor ?? "#94a3b8";
  const groupedNav = getGroupedVisibleAppNav({ appContext });

  return (
    <aside className="app-sidebar-surface w-72 shrink-0 border-r px-5 py-6">
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

      <nav className="mt-10 space-y-6">
        {groupedNav.map((section) => (
          <section key={section.id}>
            <div className="px-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(var(--app-primary-rgb),0.42)]">
                {section.label}
              </div>
              <div className="mt-1 text-xs leading-5 text-[rgba(var(--app-primary-rgb),0.6)]">
                {section.description}
              </div>
            </div>
            <div className="mt-2 space-y-1.5">
              {section.items.map(({ href, label, icon: Icon, description }) => {
                const active = pathname === href || pathname?.startsWith(`${href}/`);

                return (
                  <Link
                    key={href}
                    href={href}
                    className={`group flex items-start gap-3 rounded-[1.35rem] px-4 py-3 transition ${
                      active
                        ? "text-white shadow-panel"
                        : "text-slate-700 hover:bg-[rgba(var(--app-primary-rgb),0.92)] hover:text-white"
                    }`}
                    style={active ? { backgroundColor: primaryColor } : undefined}
                  >
                    <span
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl transition ${
                        active
                          ? "bg-white/14 text-white"
                          : "bg-white/70 text-[rgba(var(--app-primary-rgb),0.72)] group-hover:bg-white/12 group-hover:text-white"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{label}</span>
                      <span
                        className={`mt-1 block text-xs leading-5 ${
                          active ? "text-white/78" : "text-[rgba(var(--app-primary-rgb),0.56)] group-hover:text-white/78"
                        }`}
                      >
                        {description}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </nav>
    </aside>
  );
}
