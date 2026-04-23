"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authFetch, useAuth } from "@/lib/auth/client";
import { hasAdminAccess } from "@/lib/auth/permissions";
import { useAppFeedback } from "@/components/shared/app-feedback";
import type {
  ManagerDashboardResponse,
  OrganizationBrandLogoUploadTargetResponse,
  OrganizationBrandingResponse,
  TeamCleanupIssue,
  TeamListItem,
  TeamListResponse,
  TeamMemberItem,
  TeamMembersResponse,
  TeamMutationResponse,
  TerritoriesResponse,
  TerritoryDetailResponse,
  TerritoryListItem,
  TerritoryPropertyItem,
  TerritoryPropertySearchResponse
} from "@/types/api";
import { DEFAULT_ORGANIZATION_THEME, ORGANIZATION_THEME_PRESETS } from "@/lib/branding/theme";

export type TeamWorkspaceSurface = "operations" | "territories" | "branding";

function expandHexColor(value: string) {
  const normalized = value.replace("#", "").trim();
  if (normalized.length === 3) {
    return normalized
      .split("")
      .map((char) => `${char}${char}`)
      .join("");
  }
  return normalized.slice(0, 6);
}

function hexToRgb(value: string) {
  const expanded = expandHexColor(value);
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16)
  };
}

function getRelativeLuminance(value: string) {
  const { r, g, b } = hexToRgb(value);
  const channels = [r, g, b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function getReadableTextColor(background: string, dark = "#0b1220", light = "#f8fafc") {
  return getRelativeLuminance(background) > 0.45 ? dark : light;
}

function useTeamWorkspaceController() {
  const { session, appContext, organizationBranding, refreshOrganizationBranding, supabase } = useAuth();
  const { notify, confirm } = useAppFeedback();
  const accessToken = session?.access_token ?? null;

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
  const [memberState, setMemberState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [cleanupState, setCleanupState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [detailName, setDetailName] = useState("");
  const [detailStatus, setDetailStatus] = useState<"active" | "archived">("active");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<TerritoryPropertyItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [dashboard, setDashboard] = useState<ManagerDashboardResponse | null>(null);
  const [teams, setTeams] = useState<TeamListItem[]>([]);
  const [members, setMembers] = useState<TeamMemberItem[]>([]);
  const [issues, setIssues] = useState<TeamCleanupIssue[]>([]);
  const [teamState, setTeamState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [createTeamName, setCreateTeamName] = useState("");
  const [createTeamManagerId, setCreateTeamManagerId] = useState("");
  const [teamDrafts, setTeamDrafts] = useState<Record<string, { name: string; managerUserId: string }>>({});
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"owner" | "admin" | "manager" | "rep" | "setter">("rep");
  const [brandName, setBrandName] = useState("Lumino");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoScale, setLogoScale] = useState(1);
  const [logoUploadState, setLogoUploadState] = useState<"idle" | "uploading" | "uploaded" | "error">("idle");
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [logoFileName, setLogoFileName] = useState<string | null>(null);
  const [logoInputKey, setLogoInputKey] = useState(0);
  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null);
  const [primaryColor, setPrimaryColor] = useState<string>(DEFAULT_ORGANIZATION_THEME.primaryColor);
  const [accentColor, setAccentColor] = useState<string>(DEFAULT_ORGANIZATION_THEME.accentColor);
  const [backgroundColor, setBackgroundColor] = useState<string>(DEFAULT_ORGANIZATION_THEME.backgroundColor);
  const [backgroundAccentColor, setBackgroundAccentColor] = useState<string>(
    DEFAULT_ORGANIZATION_THEME.backgroundAccentColor
  );
  const [surfaceColor, setSurfaceColor] = useState<string>(DEFAULT_ORGANIZATION_THEME.surfaceColor);
  const [sidebarColor, setSidebarColor] = useState<string>(DEFAULT_ORGANIZATION_THEME.sidebarColor);
  const [selectedThemePresetId, setSelectedThemePresetId] = useState<
    "" | (typeof ORGANIZATION_THEME_PRESETS)[number]["id"]
  >("");

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
  const backgroundTextColor = useMemo(() => getReadableTextColor(backgroundColor), [backgroundColor]);
  const surfaceTextColor = useMemo(() => getReadableTextColor(surfaceColor), [surfaceColor]);
  const sidebarTextColor = useMemo(() => getReadableTextColor(sidebarColor), [sidebarColor]);
  const accentTextColor = useMemo(() => getReadableTextColor(accentColor), [accentColor]);
  const teamManagerOptions = useMemo(
    () =>
      members.filter((member) => member.isActive && ["owner", "admin", "manager"].includes(member.role)),
    [members]
  );

  async function readErrorMessage(response: Response, fallback: string) {
    try {
      const json = (await response.json()) as { error?: string };
      return json.error || fallback;
    } catch {
      return fallback;
    }
  }

  function notifyError(title: string, error: unknown, fallback: string) {
    notify({
      tone: "error",
      title,
      message: error instanceof Error ? error.message : fallback
    });
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

  const loadTeams = useCallback(async () => {
    if (!accessToken) return;

    const response = await authFetch(accessToken, "/api/team/teams");
    if (!response.ok) throw new Error("Failed to load teams");
    const json = (await response.json()) as TeamListResponse;
    setTeams(json.items);
    setTeamDrafts(
      Object.fromEntries(
        json.items.map((team) => [
          team.teamId,
          {
            name: team.name,
            managerUserId: team.managerUserId ?? ""
          }
        ])
      )
    );
  }, [accessToken]);

  useEffect(() => {
    void loadMembers().catch(() => {
      setMembers([]);
    });
  }, [loadMembers]);

  useEffect(() => {
    void loadTeams().catch(() => {
      setTeams([]);
    });
  }, [loadTeams]);

  useEffect(() => {
    if (!organizationBranding) return;
    setBrandName(organizationBranding.appName || "Lumino");
    setLogoUrl(organizationBranding.logoUrl || "");
    setLogoScale(organizationBranding.logoScale ?? 1);
    setLogoFileName(organizationBranding.logoUrl ? "Current logo" : null);
    setLogoUploadState("idle");
    setLogoUploadError(null);
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
      const response = await authFetch(accessToken, `/api/territories/${selectedTerritoryId}/properties`, {
        method: "POST",
        body: JSON.stringify({ propertyId })
      });

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
      const response = await authFetch(accessToken, `/api/territories/${selectedTerritoryId}/properties`, {
        method: "DELETE",
        body: JSON.stringify({ propertyId })
      });

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
      await Promise.all([loadMembers(), loadTeams()]);
      setInviteState("saved");
    } catch (error) {
      notifyError("Could not invite user", error, "Failed to invite member.");
      setInviteState("error");
    }
  }

  async function handleUpdateMember(
    memberId: string,
    payload: { role?: "owner" | "admin" | "manager" | "rep" | "setter"; isActive?: boolean; teamId?: string | null }
  ) {
    if (!accessToken) return;

    setMemberState("saving");
    try {
      const response = await authFetch(accessToken, `/api/team/members/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update member"));
      await Promise.all([loadMembers(), loadTeams()]);
      setMemberState("saved");
    } catch (error) {
      notifyError("Could not update member", error, "Failed to update member.");
      setMemberState("error");
    }
  }

  async function handleCreateTeam() {
    if (!accessToken || !createTeamName.trim()) return;

    setTeamState("saving");
    try {
      const response = await authFetch(accessToken, "/api/team/teams", {
        method: "POST",
        body: JSON.stringify({
          name: createTeamName.trim(),
          managerUserId: createTeamManagerId || null
        })
      });

      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to create team"));
      const json = (await response.json()) as TeamMutationResponse;
      setCreateTeamName("");
      setCreateTeamManagerId("");
      await loadTeams();
      setTeamState("saved");
      setTeamDrafts((current) => ({
        ...current,
        [json.teamId]: current[json.teamId] ?? { name: createTeamName.trim(), managerUserId: createTeamManagerId }
      }));
    } catch (error) {
      notifyError("Could not create team", error, "Failed to create team.");
      setTeamState("error");
    }
  }

  async function handleUpdateTeam(teamId: string) {
    if (!accessToken) return;
    const draft = teamDrafts[teamId];
    if (!draft?.name.trim()) return;

    setTeamState("saving");
    try {
      const response = await authFetch(accessToken, `/api/team/teams/${teamId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: draft.name.trim(),
          managerUserId: draft.managerUserId || null
        })
      });

      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update team"));
      await Promise.all([loadTeams(), loadMembers()]);
      setTeamState("saved");
    } catch (error) {
      notifyError("Could not update team", error, "Failed to update team.");
      setTeamState("error");
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
      notify({
        tone: "success",
        title: action === "resend_invite" ? "Invite email sent" : "Password reset sent",
        message:
          action === "resend_invite"
            ? "The teammate will get a fresh invite to join Lumino."
            : "The teammate will get a password reset email."
      });
    } catch (error) {
      notifyError("Could not send access email", error, "Failed to send access email.");
      setMemberState("error");
    }
  }

  async function handleDeleteMember(memberId: string, memberName: string, mode: "remove" | "account") {
    if (!accessToken || !canDeleteMembers) return;
    const message =
      mode === "account"
        ? `Delete ${memberName} from Lumino entirely? This removes their org membership, deletes their login, and should only be used if they are truly done using Lumino anywhere.`
        : `Remove ${memberName} from this org? They will lose access to this org, but their underlying Lumino account can still be reused later.`;
    const confirmed = await confirm({
      title: mode === "account" ? "Delete Lumino account?" : "Remove from organization?",
      message,
      confirmLabel: mode === "account" ? "Delete account" : "Remove member",
      tone: "danger"
    });
    if (!confirmed) return;

    setMemberState("saving");
    try {
      const response = await authFetch(accessToken, `/api/team/members/${memberId}?mode=${mode}`, {
        method: "DELETE"
      });

      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to delete member"));
      await Promise.all([loadMembers(), loadTeams()]);
      setMemberState("saved");
      notify({
        tone: "success",
        title: mode === "account" ? "Account deleted" : "Member removed",
        message:
          mode === "account"
            ? `${memberName} no longer has a Lumino account.`
            : `${memberName} has been removed from this organization.`
      });
    } catch (error) {
      notifyError("Could not delete member", error, "Failed to delete member.");
      setMemberState("error");
    }
  }

  async function handleCleanupIssue(issue: TeamCleanupIssue) {
    if (!accessToken || !issue.cleanupAction || !issue.userId) return;
    const confirmed = await confirm({
      title: "Delete orphaned user record?",
      message: `Clean up ${issue.email ?? "this stale user record"}? This permanently deletes the orphaned app user.`,
      confirmLabel: "Delete record",
      tone: "danger"
    });
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
      await Promise.all([loadMembers(), loadTeams()]);
      setCleanupState("saved");
      notify({
        tone: "success",
        title: "Cleanup completed",
        message: "The stale team record has been removed."
      });
    } catch (error) {
      notifyError("Could not clean up record", error, "Failed to clean up team issue.");
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
          logoScale,
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

  async function handleUploadLogo(file: File) {
    if (!accessToken || !supabase) return;

    setLogoUploadState("uploading");
    setLogoUploadError(null);
    setLogoFileName(file.name);
    try {
      const uploadTargetResponse = await authFetch(accessToken, "/api/organization/branding/logo-upload-url", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          fileSizeBytes: file.size
        })
      });

      const uploadTargetJson = (await uploadTargetResponse.json()) as Partial<OrganizationBrandLogoUploadTargetResponse> & {
        error?: string;
      };
      if (
        !uploadTargetResponse.ok ||
        !uploadTargetJson.bucket ||
        !uploadTargetJson.path ||
        !uploadTargetJson.token ||
        !uploadTargetJson.publicUrl
      ) {
        throw new Error(uploadTargetJson.error || "Could not prepare logo upload.");
      }

      const storageUpload = await supabase.storage
        .from(uploadTargetJson.bucket)
        .uploadToSignedUrl(uploadTargetJson.path, uploadTargetJson.token, file);
      if (storageUpload.error) {
        throw storageUpload.error;
      }

      setLogoUrl(uploadTargetJson.publicUrl);
      setLogoUploadState("uploaded");
    } catch (error) {
      setLogoUploadState("error");
      setLogoUploadError(error instanceof Error ? error.message : "Could not upload logo.");
    }
  }

  function clearLogo() {
    setLogoUrl("");
    setLogoFileName(null);
    setLogoUploadState("idle");
    setLogoUploadError(null);
    setLogoInputKey((current) => current + 1);
  }

  async function handleCroppedLogo(file: File) {
    setPendingLogoFile(null);
    await handleUploadLogo(file);
  }

  function applyThemePreset(presetId: (typeof ORGANIZATION_THEME_PRESETS)[number]["id"]) {
    const preset = ORGANIZATION_THEME_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;

    setSelectedThemePresetId(preset.id);
    setPrimaryColor(preset.theme.primaryColor);
    setAccentColor(preset.theme.accentColor);
    setBackgroundColor(preset.theme.backgroundColor);
    setBackgroundAccentColor(preset.theme.backgroundAccentColor);
    setSurfaceColor(preset.theme.surfaceColor);
    setSidebarColor(preset.theme.sidebarColor);
    setBrandingState("idle");
  }

  return {
    hasAccessToken: Boolean(accessToken),
    territories,
    selectedTerritoryId,
    setSelectedTerritoryId,
    selectedTerritory,
    loadingList,
    loadingDetail,
    createName,
    setCreateName,
    createStatus,
    setCreateStatus,
    territoryState,
    inviteState,
    brandingState,
    memberState,
    cleanupState,
    detailName,
    setDetailName,
    detailStatus,
    setDetailStatus,
    searchTerm,
    setSearchTerm,
    searchResults,
    searching,
    dashboard,
    teams,
    members,
    issues,
    teamState,
    createTeamName,
    setCreateTeamName,
    createTeamManagerId,
    setCreateTeamManagerId,
    teamDrafts,
    setTeamDrafts,
    inviteEmail,
    setInviteEmail,
    inviteName,
    setInviteName,
    inviteRole,
    setInviteRole,
    brandName,
    setBrandName,
    logoUrl,
    setLogoUrl,
    logoScale,
    setLogoScale,
    logoUploadState,
    logoUploadError,
    logoFileName,
    logoInputKey,
    setLogoInputKey,
    pendingLogoFile,
    setPendingLogoFile,
    primaryColor,
    setPrimaryColor,
    accentColor,
    setAccentColor,
    backgroundColor,
    setBackgroundColor,
    backgroundAccentColor,
    setBackgroundAccentColor,
    surfaceColor,
    setSurfaceColor,
    sidebarColor,
    setSidebarColor,
    selectedThemePresetId,
    setSelectedThemePresetId,
    assignedPropertyIds,
    canEditBranding,
    canDeleteMembers,
    currentAppUserId,
    backgroundTextColor,
    surfaceTextColor,
    sidebarTextColor,
    accentTextColor,
    teamManagerOptions,
    handleCreateTerritory,
    handleUpdateTerritory,
    handleAssignProperty,
    handleRemoveProperty,
    handleInviteMember,
    handleUpdateMember,
    handleCreateTeam,
    handleUpdateTeam,
    handleMemberAction,
    handleDeleteMember,
    handleCleanupIssue,
    handleSaveBranding,
    clearLogo,
    handleCroppedLogo,
    applyThemePreset
  };
}

type TeamWorkspaceContextValue = ReturnType<typeof useTeamWorkspaceController>;

const TeamWorkspaceContext = createContext<TeamWorkspaceContextValue | null>(null);

export function TeamWorkspaceProvider({ children }: { children: ReactNode }) {
  const value = useTeamWorkspaceController();

  return <TeamWorkspaceContext.Provider value={value}>{children}</TeamWorkspaceContext.Provider>;
}

export function useTeamWorkspace() {
  const context = useContext(TeamWorkspaceContext);

  if (!context) {
    throw new Error("useTeamWorkspace must be used within TeamWorkspaceProvider");
  }

  return context;
}
