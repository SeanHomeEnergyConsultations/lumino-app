"use client";

import type { Route } from "next";
import {
  Building2,
  CalendarCheck2,
  ContactRound,
  FolderOpen,
  LayoutDashboard,
  ListTodo,
  Map,
  QrCode,
  Trophy,
  Upload,
  Users,
  type LucideIcon
} from "lucide-react";
import { hasFeatureAccess, hasManagerAccess, hasPlatformAccess } from "@/lib/auth/permissions";
import type { AuthSessionContext } from "@/types/auth";
import type { OrganizationFeatureAccess } from "@/types/entities";

export type AppNavSectionId = "workspace" | "growth" | "admin";

export type AppNavSection = {
  id: AppNavSectionId;
  label: string;
  description: string;
};

export type AppNavItem = {
  href: Route;
  label: string;
  icon: LucideIcon;
  description: string;
  section: AppNavSectionId;
  mobilePrimary?: boolean;
  requiredFeature?: keyof OrganizationFeatureAccess;
  managerOnly?: boolean;
  platformOnly?: boolean;
  platformOwnerOnly?: boolean;
};

export const appNavSections: readonly AppNavSection[] = [
  {
    id: "workspace",
    label: "Daily Workflow",
    description: "Run the field, follow through, and keep momentum."
  },
  {
    id: "growth",
    label: "Pipeline & Growth",
    description: "Support reps with enablement, campaigns, and wins."
  },
  {
    id: "admin",
    label: "Admin & Ops",
    description: "Manage the business, the team, and the platform."
  }
] as const;

export const appNavItems: readonly AppNavItem[] = [
  {
    href: "/map",
    label: "Map",
    icon: Map,
    description: "See live territory activity and work the next property.",
    section: "workspace",
    mobilePrimary: true,
    requiredFeature: "mapEnabled"
  },
  {
    href: "/follow-up",
    label: "Follow Up",
    icon: ListTodo,
    description: "Stay on top of callbacks, missed doors, and due touchpoints.",
    section: "workspace",
    mobilePrimary: true,
    requiredFeature: "visitLoggingEnabled"
  },
  {
    href: "/leads",
    label: "Leads",
    icon: ContactRound,
    description: "Review and update homeowner records without losing context.",
    section: "workspace",
    mobilePrimary: true,
    requiredFeature: "leadsEnabled"
  },
  {
    href: "/appointments",
    label: "Appointments",
    icon: CalendarCheck2,
    description: "Track booked consults and schedule the next conversation.",
    section: "workspace",
    mobilePrimary: true,
    requiredFeature: "appointmentsEnabled"
  },
  {
    href: "/resources",
    label: "Resources",
    icon: FolderOpen,
    description: "Keep sales collateral, playbooks, and files close at hand.",
    section: "growth"
  },
  {
    href: "/qr",
    label: "QR",
    icon: QrCode,
    description: "Publish rep QR experiences and measure engagement.",
    section: "growth"
  },
  {
    href: "/wins",
    label: "Wins",
    icon: Trophy,
    description: "Celebrate momentum and reinforce what is working.",
    section: "growth"
  },
  {
    href: "/imports",
    label: "Imports",
    icon: Upload,
    description: "Bring in new territory data and enrich it for the field.",
    section: "admin",
    requiredFeature: "selfImportsEnabled",
    managerOnly: true
  },
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    description: "Monitor rep activity, territory health, and daily performance.",
    section: "admin",
    managerOnly: true
  },
  {
    href: "/team",
    label: "Team",
    icon: Users,
    description: "Manage territory setup, rep access, and branding controls.",
    section: "admin",
    requiredFeature: "teamManagementEnabled",
    managerOnly: true
  },
  {
    href: "/platform",
    label: "Platform",
    icon: Building2,
    description: "Operate organizations, datasets, and platform-level controls.",
    section: "admin",
    platformOwnerOnly: true
  }
] as const;

export function getVisibleAppNav(input: { appContext: AuthSessionContext | null }) {
  const { appContext } = input;
  const canManage = appContext ? hasManagerAccess(appContext) : false;
  const canAccessPlatform = appContext ? hasPlatformAccess(appContext) : false;

  return appNavItems.filter((item) => {
    if (item.platformOwnerOnly) {
      return Boolean(appContext?.isPlatformOwner);
    }
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

export function getGroupedVisibleAppNav(input: { appContext: AuthSessionContext | null }) {
  const visibleItems = getVisibleAppNav(input);

  return appNavSections
    .map((section) => ({
      ...section,
      items: visibleItems.filter((item) => item.section === section.id)
    }))
    .filter((section) => section.items.length > 0);
}

export function getPrimaryMobileNav(input: { appContext: AuthSessionContext | null }) {
  const visibleItems = getVisibleAppNav(input);
  const primaryItems = visibleItems.filter((item) => item.mobilePrimary);

  if (primaryItems.length >= 4) {
    return primaryItems.slice(0, 4);
  }

  const fallbackItems = visibleItems.filter((item) => !primaryItems.some((primaryItem) => primaryItem.href === item.href));
  return [...primaryItems, ...fallbackItems].slice(0, 4);
}

export function getActiveAppNavItem(pathname: string | null, visibleItems: readonly AppNavItem[]) {
  if (!pathname) return null;

  return (
    [...visibleItems]
      .sort((left, right) => right.href.length - left.href.length)
      .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)) ?? null
  );
}

export function getAppNavigationContext(input: {
  pathname: string | null;
  appContext: AuthSessionContext | null;
}) {
  const visibleItems = getVisibleAppNav({ appContext: input.appContext });
  const activeItem = getActiveAppNavItem(input.pathname, visibleItems);
  const activeSection = activeItem
    ? appNavSections.find((section) => section.id === activeItem.section) ?? null
    : null;

  return {
    visibleItems,
    activeItem,
    activeSection
  };
}
