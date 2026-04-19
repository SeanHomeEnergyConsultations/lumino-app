"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { Map, LayoutDashboard, ListTodo, CheckSquare2, Users, CalendarCheck2, ContactRound, Upload } from "lucide-react";
import { LogoMark } from "@/components/shared/logo-mark";
import { useAuth } from "@/lib/auth/client";

const nav = [
  { href: "/map", label: "Map", icon: Map },
  { href: "/queue", label: "Queue", icon: ListTodo },
  { href: "/leads", label: "Leads", icon: ContactRound },
  { href: "/appointments", label: "Appointments", icon: CalendarCheck2 },
  { href: "/imports", label: "Imports", icon: Upload },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", icon: CheckSquare2 },
  { href: "/team", label: "Team", icon: Users }
] as const satisfies ReadonlyArray<{
  href: Route;
  label: string;
  icon: typeof Map;
}>;

export function AppSidebar() {
  const pathname = usePathname();
  const { organizationBranding, appContext } = useAuth();
  const appName = organizationBranding?.appName ?? "Lumino";
  const primaryColor = organizationBranding?.primaryColor ?? "#0b1220";
  const accentColor = organizationBranding?.accentColor ?? "#94a3b8";
  const roles = appContext?.memberships.map((item) => item.role) ?? [];
  const canManage = roles.some((role) => ["owner", "admin", "manager"].includes(role));
  const filteredNav = nav.filter((item) => {
    if (["/imports", "/dashboard", "/team"].includes(item.href)) {
      return canManage;
    }
    return true;
  });

  return (
    <aside className="w-72 shrink-0 border-r border-slate-200/80 bg-white/70 px-5 py-6 backdrop-blur">
      <div className="flex items-center gap-3">
        <LogoMark appName={appName} logoUrl={organizationBranding?.logoUrl ?? null} primaryColor={primaryColor} />
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.24em]" style={{ color: accentColor }}>
            {appName}
          </div>
          <div className="text-lg font-semibold text-ink">Field CRM</div>
        </div>
      </div>

      <nav className="mt-10 space-y-2">
        {filteredNav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition ${
              pathname?.startsWith(href)
                ? "text-white"
                : "text-slate-700 hover:bg-slate-950 hover:text-white"
            }`}
            style={pathname?.startsWith(href) ? { backgroundColor: primaryColor } : undefined}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
