"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch, useAuth } from "@/lib/auth/client";
import { hasAdminAccess } from "@/lib/auth/permissions";
import type {
  ManagerDashboardResponse,
  OrganizationCreateResponse,
  OrganizationBrandingResponse,
  OrganizationsResponse,
  TeamCleanupIssue,
  TeamMembersResponse,
  TeamMemberItem,
  TerritoriesResponse,
  TerritoryDetailResponse,
  TerritoryListItem,
  TerritoryPropertyItem,
  TerritoryPropertySearchResponse
} from "@/types/api";
import { DEFAULT_ORGANIZATION_THEME, ORGANIZATION_THEME_PRESETS } from "@/lib/branding/theme";

function statusPill(status: string) {
  return status === "active"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-slate-200 bg-slate-100 text-slate-600";
}

export function TerritoryAdminPage() {
  const { session, appContext, organizationBranding, refreshOrganizationBranding } = useAuth();
  const accessToken = session?.access_token ?? null;

  const [organizations, setOrganizations] = useState<OrganizationsResponse["items"]>([]);
  const [territories, setTerritories] = useState<TerritoryListItem[]>([]);
  const [selectedTerritoryId, setSelectedTerritoryId] = useState<string | null>(null);
  const [selectedTerritory, setSelectedTerritory] = useState<TerritoryDetailResponse["item"] | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createStatus, setCreateStatus] = useState<"active" | "archived">("active");
  const [territoryState, setTerritoryState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [inviteState, setInviteState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [brandingState, setBrandingState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [organizationState, setOrganizationState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [memberState, setMemberState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [cleanupState, setCleanupState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [detailName, setDetailName] = useState("");
  const [detailStatus, setDetailStatus] = useState<"active" | "archived">("active");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<TerritoryPropertyItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [dashboard, setDashboard] = useState<ManagerDashboardResponse | null>(null);
  const [members, setMembers] = useState<TeamMemberItem[]>([]);
  const [issues, setIssues] = useState<TeamCleanupIssue[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"owner" | "admin" | "manager" | "rep" | "setter">("rep");
  const [brandName, setBrandName] = useState("Lumino");
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState<string>(DEFAULT_ORGANIZATION_THEME.primaryColor);
  const [accentColor, setAccentColor] = useState<string>(DEFAULT_ORGANIZATION_THEME.accentColor);
  const [backgroundColor, setBackgroundColor] = useState<string>(DEFAULT_ORGANIZATION_THEME.backgroundColor);
  const [backgroundAccentColor, setBackgroundAccentColor] = useState<string>(
    DEFAULT_ORGANIZATION_THEME.backgroundAccentColor
  );
  const [surfaceColor, setSurfaceColor] = useState<string>(DEFAULT_ORGANIZATION_THEME.surfaceColor);
  const [sidebarColor, setSidebarColor] = useState<string>(DEFAULT_ORGANIZATION_THEME.sidebarColor);
  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [organizationAppName, setOrganizationAppName] = useState("");

  const assignedPropertyIds = useMemo(
    () => new Set((selectedTerritory?.properties ?? []).map((item) => item.propertyId)),
    [selectedTerritory?.properties]
  );
  const canEditBranding = useMemo(
    () => (appContext ? hasAdminAccess(appContext) : false),
    [appContext]
  );
  const canDeleteMembers = canEditBranding;
  const currentAppUserId = appContext?.appUser.id ?? null;
  const isPlatformOwner = appContext?.isPlatformOwner ?? false;

  async function readErrorMessage(response: Response, fallback: string) {
    try {
      const json = (await response.json()) as { error?: string };
      return json.error || fallback;
    } catch {
      return fallback;
    }
  }

  const loadTerritories = useCallback(async () => {
    if (!accessToken) return;

    setLoadingList(true);
    try {
      const response = await authFetch(accessToken, "/api/territories");
      if (!response.ok) throw new Error("Failed to load territories");
      const json = (await response.json()) as TerritoriesResponse;
      setTerritories(json.items);

      setSelectedTerritoryId((current) => current ?? json.items[0]?.territoryId ?? null);
    } finally {
      setLoadingList(false);
    }
  }, [accessToken]);

  const loadTerritoryDetail = useCallback(
    async (territoryId: string | null) => {
      if (!accessToken || !territoryId) {
        setSelectedTerritory(null);
        return;
      }

      setLoadingDetail(true);
      try {
        const response = await authFetch(accessToken, `/api/territories/${territoryId}`);
        if (!response.ok) throw new Error("Failed to load territory detail");
        const json = (await response.json()) as TerritoryDetailResponse;
        setSelectedTerritory(json.item);
        setDetailName(json.item.name);
        setDetailStatus(json.item.status as "active" | "archived");
      } finally {
        setLoadingDetail(false);
      }
    },
    [accessToken]
  );

  useEffect(() => {
    void loadTerritories();
  }, [loadTerritories]);

  useEffect(() => {
    if (!accessToken || !isPlatformOwner) return;

    authFetch(accessToken, "/api/organizations")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as OrganizationsResponse;
      })
      .then((json) => {
        if (json) setOrganizations(json.items);
      })
      .catch(() => {
        setOrganizations([]);
      });
  }, [accessToken, isPlatformOwner]);

  useEffect(() => {
    if (!accessToken) return;

    authFetch(accessToken, "/api/dashboard/manager")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as ManagerDashboardResponse;
      })
      .then((json) => {
        if (json) setDashboard(json);
      })
      .catch(() => {
        setDashboard(null);
      });
  }, [accessToken]);

  const loadMembers = useCallback(async () => {
    if (!accessToken) return;

    const response = await authFetch(accessToken, "/api/team/members");
    if (!response.ok) throw new Error("Failed to load team members");
    const json = (await response.json()) as TeamMembersResponse;
    setMembers(json.items);
    setIssues(json.issues ?? []);
  }, [accessToken]);

  useEffect(() => {
    void loadMembers().catch(() => {
      setMembers([]);
    });
  }, [loadMembers]);

  useEffect(() => {
    if (!organizationBranding) return;
    setBrandName(organizationBranding.appName || "Lumino");
    setLogoUrl(organizationBranding.logoUrl || "");
    setPrimaryColor(organizationBranding.primaryColor || DEFAULT_ORGANIZATION_THEME.primaryColor);
    setAccentColor(organizationBranding.accentColor || DEFAULT_ORGANIZATION_THEME.accentColor);
    setBackgroundColor(organizationBranding.backgroundColor || DEFAULT_ORGANIZATION_THEME.backgroundColor);
    setBackgroundAccentColor(
      organizationBranding.backgroundAccentColor || DEFAULT_ORGANIZATION_THEME.backgroundAccentColor
    );
    setSurfaceColor(organizationBranding.surfaceColor || DEFAULT_ORGANIZATION_THEME.surfaceColor);
    setSidebarColor(organizationBranding.sidebarColor || DEFAULT_ORGANIZATION_THEME.sidebarColor);
  }, [organizationBranding]);

  useEffect(() => {
    void loadTerritoryDetail(selectedTerritoryId);
  }, [loadTerritoryDetail, selectedTerritoryId]);

  const runSearch = useCallback(
    async (term: string) => {
      if (!accessToken) return;
      const trimmed = term.trim();
      if (trimmed.length < 3) {
        setSearchResults([]);
        return;
      }

      setSearching(true);
      try {
        const response = await authFetch(
          accessToken,
          `/api/territories/property-search?q=${encodeURIComponent(trimmed)}`
        );
        if (!response.ok) throw new Error("Failed to search properties");
        const json = (await response.json()) as TerritoryPropertySearchResponse;
        setSearchResults(json.items);
      } finally {
        setSearching(false);
      }
    },
    [accessToken]
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      void runSearch(searchTerm);
    }, 250);

    return () => clearTimeout(timeout);
  }, [runSearch, searchTerm]);

  async function handleCreateTerritory() {
    if (!accessToken || !createName.trim()) return;

    setTerritoryState("saving");
    try {
      const response = await authFetch(accessToken, "/api/territories", {
        method: "POST",
        body: JSON.stringify({
          name: createName.trim(),
          status: createStatus
        })
      });

      if (!response.ok) throw new Error("Failed to create territory");

      const json = (await response.json()) as { territoryId: string };
      setCreateName("");
      setCreateStatus("active");
      await loadTerritories();
      setSelectedTerritoryId(json.territoryId);
      setTerritoryState("saved");
    } catch {
      setTerritoryState("error");
    }
  }

  async function handleUpdateTerritory() {
    if (!accessToken || !selectedTerritoryId || !detailName.trim()) return;

    setTerritoryState("saving");
    try {
      const response = await authFetch(accessToken, `/api/territories/${selectedTerritoryId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: detailName.trim(),
          status: detailStatus
        })
      });

      if (!response.ok) throw new Error("Failed to update territory");

      await Promise.all([loadTerritories(), loadTerritoryDetail(selectedTerritoryId)]);
      setTerritoryState("saved");
    } catch {
      setTerritoryState("error");
    }
  }

  async function handleAssignProperty(propertyId: string) {
    if (!accessToken || !selectedTerritoryId) return;

    setTerritoryState("saving");
    try {
      const response = await authFetch(
        accessToken,
        `/api/territories/${selectedTerritoryId}/properties`,
        {
          method: "POST",
          body: JSON.stringify({ propertyId })
        }
      );

      if (!response.ok) throw new Error("Failed to assign property");
      await Promise.all([loadTerritories(), loadTerritoryDetail(selectedTerritoryId)]);
      setSearchTerm("");
      setSearchResults([]);
      setTerritoryState("saved");
    } catch {
      setTerritoryState("error");
    }
  }

  async function handleRemoveProperty(propertyId: string) {
    if (!accessToken || !selectedTerritoryId) return;

    setTerritoryState("saving");
    try {
      const response = await authFetch(
        accessToken,
        `/api/territories/${selectedTerritoryId}/properties`,
        {
          method: "DELETE",
          body: JSON.stringify({ propertyId })
        }
      );

      if (!response.ok) throw new Error("Failed to remove property");
      await Promise.all([loadTerritories(), loadTerritoryDetail(selectedTerritoryId)]);
      setTerritoryState("saved");
    } catch {
      setTerritoryState("error");
    }
  }

  async function handleInviteMember() {
    if (!accessToken || !inviteEmail.trim() || !inviteName.trim()) return;

    setInviteState("saving");
    try {
      const response = await authFetch(accessToken, "/api/team/members", {
        method: "POST",
        body: JSON.stringify({
          email: inviteEmail.trim(),
          fullName: inviteName.trim(),
          role: inviteRole
        })
      });

      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to invite member"));
      setInviteEmail("");
      setInviteName("");
      setInviteRole("rep");
      await loadMembers();
      setInviteState("saved");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to invite member.");
      setInviteState("error");
    }
  }

  async function handleUpdateMember(
    memberId: string,
    payload: { role?: "owner" | "admin" | "manager" | "rep" | "setter"; isActive?: boolean }
  ) {
    if (!accessToken) return;

    setMemberState("saving");
    try {
      const response = await authFetch(accessToken, `/api/team/members/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update member"));
      await loadMembers();
      setMemberState("saved");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to update member.");
      setMemberState("error");
    }
  }

  async function handleMemberAction(memberId: string, action: "resend_invite" | "send_password_reset") {
    if (!accessToken) return;

    setMemberState("saving");
    try {
      const response = await authFetch(accessToken, `/api/team/members/${memberId}`, {
        method: "POST",
        body: JSON.stringify({ action })
      });

      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to send access email"));
      setMemberState("saved");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to send access email.");
      setMemberState("error");
    }
  }

  async function handleDeleteMember(memberId: string, memberName: string, mode: "remove" | "account") {
    if (!accessToken || !canDeleteMembers) return;
    if (typeof window !== "undefined") {
      const message =
        mode === "account"
          ? `Delete ${memberName}'s account entirely? This removes them from Lumino, deletes their login, and should only be used if they are not attached anywhere else.`
          : `Remove ${memberName} from this organization? They will lose access to this team's data, but their underlying account can still exist.`;
      const confirmed = window.confirm(message);
      if (!confirmed) return;
    }

    setMemberState("saving");
    try {
      const response = await authFetch(accessToken, `/api/team/members/${memberId}?mode=${mode}`, {
        method: "DELETE"
      });

      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to delete member"));
      await loadMembers();
      setMemberState("saved");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to delete member.");
      setMemberState("error");
    }
  }

  async function handleCleanupIssue(issue: TeamCleanupIssue) {
    if (!accessToken || !issue.cleanupAction || !issue.userId) return;
    const confirmed = window.confirm(`Clean up ${issue.email ?? "this stale user record"}? This permanently deletes the orphaned app user.`);
    if (!confirmed) return;

    setCleanupState("saving");
    try {
      const response = await authFetch(accessToken, "/api/team/cleanup", {
        method: "POST",
        body: JSON.stringify({
          action: issue.cleanupAction,
          userId: issue.userId
        })
      });

      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to clean up team issue"));
      await loadMembers();
      setCleanupState("saved");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to clean up team issue.");
      setCleanupState("error");
    }
  }

  async function handleSaveBranding() {
    if (!accessToken || !brandName.trim()) return;

    setBrandingState("saving");
    try {
      const response = await authFetch(accessToken, "/api/organization/branding", {
        method: "PATCH",
        body: JSON.stringify({
          appName: brandName.trim(),
          logoUrl: logoUrl.trim() || null,
          primaryColor: primaryColor.trim(),
          accentColor: accentColor.trim(),
          backgroundColor: backgroundColor.trim(),
          backgroundAccentColor: backgroundAccentColor.trim(),
          surfaceColor: surfaceColor.trim(),
          sidebarColor: sidebarColor.trim()
        })
      });

      if (!response.ok) throw new Error("Failed to save branding");
      await response.json() as OrganizationBrandingResponse;
      await refreshOrganizationBranding();
      setBrandingState("saved");
    } catch {
      setBrandingState("error");
    }
  }

  function applyThemePreset(presetId: (typeof ORGANIZATION_THEME_PRESETS)[number]["id"]) {
    const preset = ORGANIZATION_THEME_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;

    setPrimaryColor(preset.theme.primaryColor);
    setAccentColor(preset.theme.accentColor);
    setBackgroundColor(preset.theme.backgroundColor);
    setBackgroundAccentColor(preset.theme.backgroundAccentColor);
    setSurfaceColor(preset.theme.surfaceColor);
    setSidebarColor(preset.theme.sidebarColor);
    setBrandingState("idle");
  }

  async function handleCreateOrganization() {
    if (!accessToken || !isPlatformOwner || !organizationName.trim()) return;

    setOrganizationState("saving");
    try {
      const response = await authFetch(accessToken, "/api/organizations", {
        method: "POST",
        body: JSON.stringify({
          name: organizationName.trim(),
          slug: organizationSlug.trim() || null,
          appName: organizationAppName.trim() || null
        })
      });

      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to create organization"));
      const json = (await response.json()) as OrganizationCreateResponse;
      setOrganizationName("");
      setOrganizationSlug("");
      setOrganizationAppName("");
      setOrganizations((current) => [json.item, ...current]);
      setOrganizationState("saved");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to create organization.");
      setOrganizationState("error");
    }
  }

  return (
    <div className="p-4 md:p-6">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Team</div>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Roster, coaching, and territory control</h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">
          Keep reps visible, surface coaching risk quickly, and ground manager reporting in real territory assignments.
        </p>
      </div>

      {isPlatformOwner ? (
        <section className="mt-6 rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Organizations</div>
              <p className="mt-2 text-sm text-slate-500">
                Create new customer organizations without adding your platform account to their visible roster.
              </p>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
              {organizations.length}
            </div>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[1.1fr_0.8fr_0.8fr_auto]">
            <input
              type="text"
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              placeholder="Organization name"
              className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            />
            <input
              type="text"
              value={organizationSlug}
              onChange={(event) => setOrganizationSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              placeholder="slug"
              className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            />
            <input
              type="text"
              value={organizationAppName}
              onChange={(event) => setOrganizationAppName(event.target.value)}
              placeholder="App name (optional)"
              className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            />
            <button
              type="button"
              onClick={() => void handleCreateOrganization()}
              disabled={organizationState === "saving" || !organizationName.trim()}
              className="rounded-2xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {organizationState === "saving" ? "Creating..." : "Create"}
            </button>
          </div>

          <div className="mt-3 text-sm text-slate-500">
            {organizationState === "saved"
              ? "Organization created."
              : organizationState === "error"
                ? "Could not create organization."
                : "New organizations start active on the starter plan. You can invite their first admin afterward."}
          </div>

          <div className="mt-4 space-y-2">
            {organizations.length ? (
              organizations.slice(0, 8).map((organization) => (
                <div key={organization.organizationId} className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink">{organization.appName || organization.name}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {organization.slug ? `${organization.slug} · ` : ""}
                      {organization.status} · {organization.billingPlan}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500">
                    Created {new Date(organization.createdAt).toLocaleDateString()}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No organizations created from the app yet.
              </div>
            )}
          </div>
        </section>
      ) : null}

      {canEditBranding ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <section className="app-panel rounded-[2rem] border p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Branding</div>
              <p className="mt-2 text-sm text-slate-500">
                Set the organization name, logo URL, and shell colors that make the app feel like your team&apos;s product.
              </p>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
              Live preview
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_0.9fr]">
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Presets</div>
                <div className="grid gap-2">
                  {ORGANIZATION_THEME_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyThemePreset(preset.id)}
                      className="app-chip flex items-center justify-between gap-3 rounded-2xl px-3 py-3 text-left transition hover:translate-y-[-1px]"
                    >
                      <div>
                        <div className="text-sm font-semibold text-ink">{preset.label}</div>
                        <div className="mt-1 text-xs text-slate-500">{preset.description}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {[
                          preset.theme.primaryColor,
                          preset.theme.accentColor,
                          preset.theme.backgroundColor,
                          preset.theme.sidebarColor
                        ].map((color) => (
                          <span
                            key={`${preset.id}-${color}`}
                            className="h-4 w-4 rounded-full border border-white/70 shadow-sm"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="text"
                value={brandName}
                onChange={(event) => setBrandName(event.target.value)}
                placeholder="Organization name"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              />
              <input
                type="url"
                value={logoUrl}
                onChange={(event) => setLogoUrl(event.target.value)}
                placeholder="Logo URL"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              />
              <div className="grid gap-3 md:grid-cols-2">
                <label className="app-chip rounded-2xl px-3 py-2 text-sm text-slate-600">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Primary</span>
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(event) => setPrimaryColor(event.target.value)}
                    className="app-color-swatch rounded-xl"
                  />
                </label>
                <label className="app-chip rounded-2xl px-3 py-2 text-sm text-slate-600">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Accent</span>
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(event) => setAccentColor(event.target.value)}
                    className="app-color-swatch rounded-xl"
                  />
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="app-chip rounded-2xl px-3 py-2 text-sm text-slate-600">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Background</span>
                  <input
                    type="color"
                    value={backgroundColor}
                    onChange={(event) => setBackgroundColor(event.target.value)}
                    className="app-color-swatch rounded-xl"
                  />
                </label>
                <label className="app-chip rounded-2xl px-3 py-2 text-sm text-slate-600">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Background Glow</span>
                  <input
                    type="color"
                    value={backgroundAccentColor}
                    onChange={(event) => setBackgroundAccentColor(event.target.value)}
                    className="app-color-swatch rounded-xl"
                  />
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="app-chip rounded-2xl px-3 py-2 text-sm text-slate-600">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Surface</span>
                  <input
                    type="color"
                    value={surfaceColor}
                    onChange={(event) => setSurfaceColor(event.target.value)}
                    className="app-color-swatch rounded-xl"
                  />
                </label>
                <label className="app-chip rounded-2xl px-3 py-2 text-sm text-slate-600">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Sidebar</span>
                  <input
                    type="color"
                    value={sidebarColor}
                    onChange={(event) => setSidebarColor(event.target.value)}
                    className="app-color-swatch rounded-xl"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => void handleSaveBranding()}
                disabled={!brandName.trim() || brandingState === "saving"}
                className="app-primary-button rounded-2xl px-4 py-2.5 text-sm font-semibold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {brandingState === "saving" ? "Saving..." : "Save Branding"}
              </button>
            </div>

            <div
              className="overflow-hidden rounded-3xl border border-slate-200 p-4"
              style={{
                background: `radial-gradient(circle at 18% 0%, ${accentColor}44, transparent 26%), linear-gradient(180deg, ${backgroundColor} 0%, ${backgroundAccentColor} 100%)`
              }}
            >
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Shell preview</div>
              <div className="mt-3 overflow-hidden rounded-3xl border border-slate-200/70">
                <div className="flex items-center gap-3 border-b border-slate-200/70 px-4 py-3" style={{ backgroundColor: `${surfaceColor}CC` }}>
                  <div
                    className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-white/60 bg-white/90 text-sm font-semibold shadow-panel"
                    style={{ color: primaryColor }}
                  >
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoUrl} alt={`${brandName} logo`} className="h-full w-full object-cover" />
                    ) : (
                      brandName
                        .split(/\s+/)
                        .map((part) => part[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase() || "LU"
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: accentColor }}>
                      {brandName}
                    </div>
                    <div className="text-sm font-semibold text-ink">Field CRM</div>
                  </div>
                </div>
                <div className="space-y-3 p-4" style={{ backgroundColor: `${surfaceColor}B8` }}>
                  <div className="rounded-2xl px-3 py-2 text-sm font-medium text-white shadow-panel" style={{ background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)` }}>
                    Active navigation
                  </div>
                  <div className="rounded-2xl border border-slate-200/70 px-3 py-2 text-sm text-slate-600" style={{ backgroundColor: `${sidebarColor}DD` }}>
                    Sidebar / navigation tone
                  </div>
                  <div className="rounded-2xl border border-slate-200/70 px-3 py-2 text-sm text-slate-600" style={{ backgroundColor: `${surfaceColor}F2` }}>
                    Default card surface
                  </div>
                </div>
              </div>
            </div>
          </div>
          </section>

          <section className="app-panel rounded-[2rem] border p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Rep Roster</div>
              <p className="mt-2 text-sm text-slate-500">Who is active today and how their field output is trending.</p>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
              {dashboard?.repScorecards.length ?? 0}
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
            {(dashboard?.repScorecards ?? []).slice(0, 6).map((rep) => (
              <div key={rep.userId} className="grid gap-3 border-b border-slate-200 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,0.7fr))] md:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink">{rep.fullName ?? rep.email ?? "Unknown rep"}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-slate-500">{rep.role}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Knocks</div>
                  <div className="mt-1 text-sm text-slate-700">{rep.knocks}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Opps</div>
                  <div className="mt-1 text-sm text-slate-700">{rep.opportunities}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Appts</div>
                  <div className="mt-1 text-sm text-slate-700">{rep.appointments}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Overdue</div>
                  <div className="mt-1 text-sm text-slate-700">{rep.overdueFollowUps}</div>
                </div>
              </div>
            ))}
            {!dashboard?.repScorecards.length ? (
              <div className="p-4 text-sm text-slate-500">
                No rep activity yet for this organization.
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Coaching Snapshot</div>
              <p className="mt-2 text-sm text-slate-500">Flags worth discussing with the team before they become process leaks.</p>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
              {dashboard?.coachingFlags.length ?? 0}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {(dashboard?.coachingFlags ?? []).slice(0, 4).map((flag) => (
              <div key={flag.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-ink">{flag.repName ?? "Rep"}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">{flag.reason}</div>
                  </div>
                  <div className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                    {flag.severity}
                  </div>
                </div>
                <div className="mt-2 text-sm text-slate-600">{flag.detail}</div>
              </div>
            ))}
            {!dashboard?.coachingFlags.length ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No coaching flags right now.
              </div>
            ) : null}
          </div>
          </section>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Team Members</div>
              <p className="mt-2 text-sm text-slate-500">Manage roles and activation state for everyone in this organization.</p>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
              {members.length}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {members.length ? (
              members.map((member) => (
                <div key={member.memberId} className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3">
                  {(() => {
                    const isSelf = member.userId === currentAppUserId;
                    const isProtectedOwner = member.role === "owner";
                    const canMutateMember = !isSelf && !isProtectedOwner;
                    return (
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_auto] xl:items-center">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink">{member.fullName ?? member.email ?? "Team member"}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">{member.email ?? "No email"}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>Joined {member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : "unknown"}</span>
                        <span className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                          {member.onboardingStatus}
                        </span>
                        {member.onboardingStatus === "pending" ? (
                          <span>Invited {member.invitedAt ? new Date(member.invitedAt).toLocaleDateString() : "recently"}</span>
                        ) : null}
                        {member.onboardingStatus === "active" && member.lastSignInAt ? (
                          <span>Last signed in {new Date(member.lastSignInAt).toLocaleDateString()}</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-start gap-2">
                      <select
                        value={member.role}
                        disabled={!canMutateMember}
                        onChange={(event) =>
                          void handleUpdateMember(member.memberId, {
                            role: event.target.value as "owner" | "admin" | "manager" | "rep" | "setter"
                          })
                        }
                        className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {["owner", "admin", "manager", "rep", "setter"].map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!canMutateMember}
                        onClick={() => void handleUpdateMember(member.memberId, { isActive: !member.isActive })}
                        className={`rounded-2xl px-3 py-2 text-sm font-semibold transition ${
                          member.isActive
                            ? "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                            : "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        } disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400`}
                      >
                        {member.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                      {member.onboardingStatus !== "active" ? (
                        <button
                          type="button"
                          onClick={() => void handleMemberAction(member.memberId, "resend_invite")}
                          className="rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-100"
                        >
                          Resend Invite
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void handleMemberAction(member.memberId, "send_password_reset")}
                        className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300"
                      >
                        Send Reset
                      </button>
                      {canDeleteMembers && canMutateMember && ["rep", "setter"].includes(member.role) ? (
                        <details className="group relative">
                          <summary className="list-none rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 cursor-pointer">
                            More
                          </summary>
                          <div className="absolute right-0 z-10 mt-2 flex min-w-[13rem] flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                            <button
                              type="button"
                              onClick={() =>
                                void handleDeleteMember(
                                  member.memberId,
                                  member.fullName ?? member.email ?? "this team member",
                                  "remove"
                                )
                              }
                              className="rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              Remove From Team
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleDeleteMember(
                                  member.memberId,
                                  member.fullName ?? member.email ?? "this team member",
                                  "account"
                                )
                              }
                              className="rounded-xl px-3 py-2 text-left text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                            >
                              Delete Account
                            </button>
                          </div>
                        </details>
                      ) : null}
                    </div>
                  </div>
                    );
                  })()}
                </div>
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No members found yet.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Invite User</div>
            <p className="mt-2 text-sm text-slate-500">Create or reactivate a teammate record and attach it to this organization.</p>
          </div>

          <div className="mt-4 space-y-3">
            <input
              type="text"
              value={inviteName}
              onChange={(event) => setInviteName(event.target.value)}
              placeholder="Full name"
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            />
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="Email"
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            />
            <select
              value={inviteRole}
              onChange={(event) =>
                setInviteRole(event.target.value as "owner" | "admin" | "manager" | "rep" | "setter")
              }
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            >
              {["owner", "admin", "manager", "rep", "setter"].map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleInviteMember()}
              disabled={!inviteEmail.trim() || !inviteName.trim() || inviteState === "saving"}
              className="w-full rounded-2xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {inviteState === "saving" ? "Saving..." : "Invite User"}
            </button>
            <div className="text-sm text-slate-500">
              {inviteState === "saved"
                ? "Saved."
                : inviteState === "error"
                  ? "A team action failed. The exact error is shown in the alert dialog."
                  : "This creates or reactivates the user record, membership, and access email in one step."}
            </div>
          </div>
        </section>
      </div>

      {canDeleteMembers ? (
        <section className="mt-6 rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Team Cleanup</div>
              <p className="mt-2 text-sm text-slate-500">
                Find stale auth/app-user mismatches before they break reinvites or password resets.
              </p>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
              {issues.length}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {issues.length ? (
              issues.map((issue) => (
                <div key={issue.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink">{issue.title}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">
                        {issue.severity} {issue.email ? `• ${issue.email}` : ""}
                      </div>
                      <div className="mt-2 text-sm text-slate-600">{issue.detail}</div>
                    </div>
                    {issue.cleanupAction ? (
                      <button
                        type="button"
                        onClick={() => void handleCleanupIssue(issue)}
                        className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                      >
                        Clean Up
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No stale team records detected right now.
              </div>
            )}
          </div>
        </section>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[22rem_1fr]">
        <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Territory List</div>
          <div className="mt-4 space-y-3">
            {loadingList ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                Loading territories...
              </div>
            ) : territories.length ? (
              territories.map((territory) => (
                <button
                  key={territory.territoryId}
                  type="button"
                  onClick={() => setSelectedTerritoryId(territory.territoryId)}
                  className={`w-full rounded-3xl border p-4 text-left transition ${
                    territory.territoryId === selectedTerritoryId
                      ? "border-ink bg-slate-950 text-white"
                      : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{territory.name}</div>
                      <div
                        className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                          territory.territoryId === selectedTerritoryId
                            ? "border-white/20 bg-white/10 text-white"
                            : statusPill(territory.status)
                        }`}
                      >
                        {territory.status}
                      </div>
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-[0.12em]">
                      {territory.propertyCount} props
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No territories yet. Create the first one below.
              </div>
            )}
          </div>

          <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-ink">Create territory</div>
            <input
              type="text"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="North Grafton"
              className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            />
            <select
              value={createStatus}
              onChange={(event) => setCreateStatus(event.target.value as "active" | "archived")}
              className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
            <button
              type="button"
              onClick={() => void handleCreateTerritory()}
              disabled={!accessToken || territoryState === "saving" || !createName.trim()}
              className="mt-3 w-full rounded-2xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {territoryState === "saving" ? "Saving..." : "Create Territory"}
            </button>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-5 shadow-panel backdrop-blur">
          {!selectedTerritoryId ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
              Select a territory to edit assignments and property coverage.
            </div>
          ) : loadingDetail ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
              Loading territory details...
            </div>
          ) : selectedTerritory ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Territory Detail</div>
                  <h2 className="mt-2 text-2xl font-semibold text-ink">{selectedTerritory.name}</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    {selectedTerritory.propertyCount} assigned properties in this territory right now.
                  </p>
                </div>
                <div
                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${statusPill(selectedTerritory.status)}`}
                >
                  {selectedTerritory.status}
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-ink">Edit territory</div>
                  <input
                    type="text"
                    value={detailName}
                    onChange={(event) => setDetailName(event.target.value)}
                    className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
                  />
                  <select
                    value={detailStatus}
                    onChange={(event) => setDetailStatus(event.target.value as "active" | "archived")}
                    className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
                  >
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleUpdateTerritory()}
                    disabled={!accessToken || territoryState === "saving" || !detailName.trim()}
                    className="mt-3 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Save Territory
                  </button>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-ink">Assign properties</div>
                  <p className="mt-1 text-xs text-slate-500">
                    Search by address and attach properties to this territory.
                  </p>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search an address"
                    className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
                  />
                  <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                    {searching ? (
                      <div className="text-sm text-slate-500">Searching...</div>
                    ) : searchTerm.trim().length < 3 ? (
                      <div className="text-sm text-slate-500">Type at least 3 characters to search.</div>
                    ) : searchResults.length ? (
                      searchResults.map((property) => (
                        <div
                          key={property.propertyId}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-ink">{property.address}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {[property.city, property.state].filter(Boolean).join(", ") || "Unknown area"}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={assignedPropertyIds.has(property.propertyId) || territoryState === "saving"}
                            onClick={() => void handleAssignProperty(property.propertyId)}
                            className="rounded-2xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {assignedPropertyIds.has(property.propertyId) ? "Assigned" : "Add"}
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-slate-500">No matching properties found.</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-ink">Assigned properties</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Remove properties here if the territory needs to be cleaned up.
                    </div>
                  </div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    {selectedTerritory.properties.length} total
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {selectedTerritory.properties.length ? (
                    selectedTerritory.properties.map((property) => (
                      <div
                        key={property.propertyId}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-ink">{property.address}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {[property.city, property.state].filter(Boolean).join(", ") || "Unknown area"}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleRemoveProperty(property.propertyId)}
                          disabled={territoryState === "saving"}
                          className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                      No properties assigned yet.
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 text-sm text-slate-500">
                {territoryState === "saved"
                  ? "Saved."
                  : territoryState === "error"
                    ? "Could not save the territory update."
                    : "Territory changes here feed manager drill-downs and territory health reporting."}
              </div>
            </>
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
              This territory could not be loaded.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
