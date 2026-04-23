import type { Session, User } from "@supabase/supabase-js";
import type { AppBranding, OrganizationBranding } from "@/types/api";
import type { AuthSessionContext } from "@/types/auth";

export const E2E_AUTH_STORAGE_KEY = "__lumino_e2e_auth";
export const E2E_AUTH_EVENT = "lumino:e2e-auth-changed";

export type E2ESessionShape = Pick<Session, "access_token" | "refresh_token"> & {
  user: Pick<User, "id" | "email"> & Partial<User>;
};

export type E2EAuthState = {
  session: E2ESessionShape | null;
  appContext: AuthSessionContext | null;
  appBranding?: AppBranding | null;
  organizationBranding?: OrganizationBranding | null;
};

export function readE2EAuthState() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(E2E_AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as E2EAuthState;
  } catch {
    return null;
  }
}

export function hasE2EAuthState() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(E2E_AUTH_STORAGE_KEY) !== null;
}
