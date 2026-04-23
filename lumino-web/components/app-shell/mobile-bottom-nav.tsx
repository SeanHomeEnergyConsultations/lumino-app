"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { getPrimaryMobileNav } from "@/components/app-shell/navigation";
import { useAuth } from "@/lib/auth/client";

export function MobileBottomNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();
  const { appBranding, organizationBranding, appContext } = useAuth();
  const effectiveBranding = organizationBranding ?? appBranding;
  const primaryColor = effectiveBranding?.primaryColor ?? "#0b1220";
  const primaryItems = getPrimaryMobileNav({ appContext });

  return (
    <div className="app-mobile-nav-surface fixed inset-x-0 bottom-0 z-40 border-t px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 xl:hidden">
      <div className="grid grid-cols-5 gap-1">
        {primaryItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname?.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={`flex min-h-[4rem] flex-col items-center justify-center rounded-2xl px-2 py-2 text-[11px] font-semibold transition ${
                active ? "text-white shadow-panel" : "text-slate-600"
              }`}
              style={active ? { backgroundColor: primaryColor } : undefined}
            >
              <Icon className="mb-1 h-4 w-4" />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onOpenMenu}
          className="flex min-h-[4rem] flex-col items-center justify-center rounded-2xl px-2 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-white/80"
          aria-label="Open app menu"
        >
          <Menu className="mb-1 h-4 w-4" />
          <span>More</span>
        </button>
      </div>
    </div>
  );
}
