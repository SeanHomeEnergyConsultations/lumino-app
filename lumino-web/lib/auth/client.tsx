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
  refreshAppBranding: () => Promise<void>;
  refreshOrganizationBranding: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [appContext, setAppContext] = useState<AuthSessionContext | null>(null);
  const [appBranding, setAppBranding] = useState<AppBranding | null>(null);
  const [organizationBranding, setOrganizationBranding] = useState<OrganizationBranding | null>(null);
  const [loading, setLoading] = useState(true);

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
        const response = await fetch("/api/auth/me", {
          headers: {
            Authorization: `Bearer ${nextSession.access_token}`
          }
        });
        if (!mounted) return;
        if (!response.ok) {
          setAppContext(null);
          setLoading(false);
          return;
        }
        const json = (await response.json()) as AuthSessionContext;
        setAppContext(json);
        await Promise.all([
          loadAppBranding(nextSession.access_token),
          loadOrganizationBranding(nextSession.access_token)
        ]);
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
  }, [supabase]);

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
        envReady: Boolean(supabase),
        refreshAppBranding: async () => {
          await loadAppBranding(session?.access_token ?? null);
        },
        refreshOrganizationBranding: async () => {
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
