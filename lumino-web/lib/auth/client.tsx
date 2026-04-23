"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { E2E_AUTH_EVENT, hasE2EAuthState, readE2EAuthState } from "@/lib/auth/e2e";
import { createBrowserSupabaseClient } from "@/lib/db/supabase-browser";
import type { AuthSessionContext } from "@/types/auth";
import type {
  AppBranding,
  AppBrandingResponse,
  OrganizationBranding,
  OrganizationBrandingResponse
} from "@/types/api";

interface AuthContextValue {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  session: Session | null;
  user: User | null;
  appContext: AuthSessionContext | null;
  appBranding: AppBranding | null;
  organizationBranding: OrganizationBranding | null;
  loading: boolean;
  envReady: boolean;
  refreshSessionContext: () => Promise<AuthSessionContext | null>;
  refreshAppBranding: () => Promise<void>;
  refreshOrganizationBranding: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const canUseE2EAuth = process.env.NODE_ENV !== "production";
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [appContext, setAppContext] = useState<AuthSessionContext | null>(null);
  const [appBranding, setAppBranding] = useState<AppBranding | null>(null);
  const [organizationBranding, setOrganizationBranding] = useState<OrganizationBranding | null>(null);
  const [loading, setLoading] = useState(true);
  const [usingE2EAuth, setUsingE2EAuth] = useState(false);

  async function refreshSessionContext(accessToken: string | null = session?.access_token ?? null) {
    if (!accessToken) {
      setAppContext(null);
      setAppBranding(null);
      setOrganizationBranding(null);
      return null;
    }

    try {
      const response = await fetch("/api/auth/me", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      if (!response.ok) {
        setAppContext(null);
        return null;
      }

      const json = (await response.json()) as AuthSessionContext;
      setAppContext(json);
      await Promise.all([loadAppBranding(accessToken), loadOrganizationBranding(accessToken)]);
      return json;
    } catch {
      setAppContext(null);
      setAppBranding(null);
      setOrganizationBranding(null);
      return null;
    }
  }

  async function loadAppBranding(accessToken: string | null) {
    if (!accessToken) {
      setAppBranding(null);
      return;
    }
    try {
      const response = await fetch("/api/app/branding", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      if (!response.ok) {
        setAppBranding(null);
        return;
      }
      const json = (await response.json()) as AppBrandingResponse;
      setAppBranding(json.item);
    } catch {
      setAppBranding(null);
    }
  }

  async function loadOrganizationBranding(accessToken: string | null) {
    if (!accessToken) {
      setOrganizationBranding(null);
      return;
    }
    try {
      const response = await fetch("/api/organization/branding", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      if (!response.ok) {
        setOrganizationBranding(null);
        return;
      }
      const json = (await response.json()) as OrganizationBrandingResponse;
      setOrganizationBranding(json.item);
    } catch {
      setOrganizationBranding(null);
    }
  }

  useEffect(() => {
    if (canUseE2EAuth && typeof window !== "undefined" && hasE2EAuthState()) {
      const hydrateFromE2E = () => {
        const state = readE2EAuthState();
        setUsingE2EAuth(true);
        setSession((state?.session ?? null) as Session | null);
        setUser((state?.session?.user ?? null) as User | null);
        setAppContext(state?.appContext ?? null);
        setAppBranding(state?.appBranding ?? null);
        setOrganizationBranding(state?.organizationBranding ?? null);
        setLoading(false);
      };

      hydrateFromE2E();
      window.addEventListener("storage", hydrateFromE2E);
      window.addEventListener(E2E_AUTH_EVENT, hydrateFromE2E as EventListener);
      return () => {
        window.removeEventListener("storage", hydrateFromE2E);
        window.removeEventListener(E2E_AUTH_EVENT, hydrateFromE2E as EventListener);
      };
    }

    setUsingE2EAuth(false);

    if (!supabase) {
      setLoading(false);
      setAppContext(null);
      setSession(null);
      setUser(null);
      return;
    }

    let mounted = true;

    async function hydrate(nextSession: Session | null) {
      if (!mounted) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (!nextSession?.access_token) {
        setAppContext(null);
        setAppBranding(null);
        setOrganizationBranding(null);
        setLoading(false);
        return;
      }

      try {
        if (!mounted) return;
        await refreshSessionContext(nextSession.access_token);
      } catch {
        if (mounted) {
          setAppContext(null);
          setAppBranding(null);
          setOrganizationBranding(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      void hydrate(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setLoading(true);
      void hydrate(nextSession);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [canUseE2EAuth, supabase]);

  return (
    <AuthContext.Provider
      value={{
        supabase,
        session,
        user,
        appContext,
        appBranding,
        organizationBranding,
        loading,
        envReady: usingE2EAuth ? true : Boolean(supabase),
        refreshSessionContext: async () => {
          if (usingE2EAuth) {
            const state = readE2EAuthState();
            setAppContext(state?.appContext ?? null);
            setAppBranding(state?.appBranding ?? null);
            setOrganizationBranding(state?.organizationBranding ?? null);
            return state?.appContext ?? null;
          }

          return refreshSessionContext(session?.access_token ?? null);
        },
        refreshAppBranding: async () => {
          if (usingE2EAuth) {
            const state = readE2EAuthState();
            setAppBranding(state?.appBranding ?? null);
            return;
          }

          await loadAppBranding(session?.access_token ?? null);
        },
        refreshOrganizationBranding: async () => {
          if (usingE2EAuth) {
            const state = readE2EAuthState();
            setOrganizationBranding(state?.organizationBranding ?? null);
            return;
          }

          await loadOrganizationBranding(session?.access_token ?? null);
        }
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

export async function authFetch(
  accessToken: string,
  input: RequestInfo | URL,
  init?: RequestInit
) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(input, {
    ...init,
    headers
  });
}
