"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { getVisibleAppNav } from "@/components/app-shell/app-sidebar";
import { useAuth } from "@/lib/auth/client";

export function MobileBottomNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();
  const { organizationBranding, appContext } = useAuth();
  const primaryColor = organizationBranding?.primaryColor ?? "#0b1220";
  const visibleNav = getVisibleAppNav({ appContext });
  const primaryItems = visibleNav.slice(0, 4);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/90 bg-white/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur xl:hidden">
      <div className="grid grid-cols-5 gap-1">
        {primaryItems.map(({ href, label, icon: Icon }) => {
          const active = pathname?.startsWith(href);
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
          className="flex min-h-[4rem] flex-col items-center justify-center rounded-2xl px-2 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100"
          aria-label="Open app menu"
        >
          <Menu className="mb-1 h-4 w-4" />
          <span>Menu</span>
        </button>
      </div>
    </div>
  );
}
