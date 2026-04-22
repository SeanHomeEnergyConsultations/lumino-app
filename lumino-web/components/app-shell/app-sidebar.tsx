"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import {
  Map,
  LayoutDashboard,
  ListTodo,
  CheckSquare2,
  Users,
  CalendarCheck2,
  ContactRound,
  Upload,
  Building2,
  Trophy,
  QrCode
} from "lucide-react";
import { LogoMark } from "@/components/shared/logo-mark";
import { useAuth } from "@/lib/auth/client";
import { hasFeatureAccess, hasManagerAccess, hasPlatformAccess } from "@/lib/auth/permissions";
import type { OrganizationFeatureAccess } from "@/types/entities";

type NavItem = {
  href: Route;
  label: string;
  icon: typeof Map;
  requiredFeature?: keyof OrganizationFeatureAccess;
  managerOnly?: boolean;
  platformOnly?: boolean;
};

export const appNavItems: readonly NavItem[] = [
  { href: "/map", label: "Map", icon: Map, requiredFeature: "mapEnabled" },
  { href: "/queue", label: "Queue", icon: ListTodo, requiredFeature: "visitLoggingEnabled" },
  { href: "/leads", label: "Leads", icon: ContactRound, requiredFeature: "leadsEnabled" },
  { href: "/appointments", label: "Appointments", icon: CalendarCheck2, requiredFeature: "appointmentsEnabled" },
  { href: "/qr", label: "QR", icon: QrCode },
  { href: "/wins", label: "Wins", icon: Trophy },
  { href: "/imports", label: "Imports", icon: Upload, requiredFeature: "selfImportsEnabled", managerOnly: true },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, managerOnly: true },
  { href: "/tasks", label: "Tasks", icon: CheckSquare2, requiredFeature: "tasksEnabled" },
  { href: "/team", label: "Team", icon: Users, requiredFeature: "teamManagementEnabled", managerOnly: true },
  { href: "/platform", label: "Platform", icon: Building2, platformOnly: true }
] as const;

export function getVisibleAppNav(input: {
  appContext: ReturnType<typeof useAuth>["appContext"];
}) {
  const { appContext } = input;
  const canManage = appContext ? hasManagerAccess(appContext) : false;
  const canAccessPlatform = appContext ? hasPlatformAccess(appContext) : false;

  return appNavItems.filter((item) => {
    if (item.platformOnly) {
      return canAccessPlatform;
    }
    if (item.managerOnly && !canManage) {
      return false;
    }
    if (item.requiredFeature && appContext && !hasFeatureAccess(appContext, item.requiredFeature)) {
      return false;
    }
    return !item.requiredFeature || Boolean(appContext);
  });
}

export function AppSidebar() {
  const pathname = usePathname();
  const { appBranding, organizationBranding, appContext } = useAuth();
  const effectiveBranding = organizationBranding ?? appBranding;
  const appName = effectiveBranding?.appName ?? "Lumino";
  const primaryColor = effectiveBranding?.primaryColor ?? "#0b1220";
  const accentColor = effectiveBranding?.accentColor ?? "#94a3b8";
  const filteredNav = getVisibleAppNav({ appContext });

  return (
    <aside className="app-sidebar-surface w-72 shrink-0 border-r px-5 py-6">
      <div className="flex items-center gap-3">
        <LogoMark appName={appName} logoUrl={effectiveBranding?.logoUrl ?? null} primaryColor={primaryColor} />
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
                : "text-slate-700 hover:bg-[rgba(var(--app-primary-rgb),0.92)] hover:text-white"
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
