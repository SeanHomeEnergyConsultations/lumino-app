import type { AuthSessionContext } from "@/types/auth";

export const ADMIN_ROLES = ["owner", "admin"] as const;
export const MANAGER_ROLES = ["owner", "admin", "manager"] as const;

export function hasAnyRole(context: AuthSessionContext, roles: readonly string[]) {
  if (context.isPlatformOwner) return true;
  return context.memberships.some((membership) => roles.includes(membership.role));
}

export function hasAdminAccess(context: AuthSessionContext) {
  return hasAnyRole(context, ADMIN_ROLES);
}

export function hasManagerAccess(context: AuthSessionContext) {
  return hasAnyRole(context, MANAGER_ROLES);
}

export function hasPlatformAccess(context: AuthSessionContext) {
  return context.isPlatformOwner || context.isPlatformSupport;
}
