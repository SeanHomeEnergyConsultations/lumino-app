import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { TeamCleanupIssue, TeamListItem, TeamListResponse, TeamMembersResponse, TeamMemberItem } from "@/types/api";
import type { AuthSessionContext } from "@/types/auth";

export async function getTeams(context: AuthSessionContext): Promise<TeamListResponse> {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) throw new Error("No active organization found for this user.");

  const [{ data: teams, error: teamsError }, { data: memberships, error: membershipsError }] = await Promise.all([
    supabase
      .from("teams")
      .select("id,name,manager_id,created_at")
      .eq("organization_id", context.organizationId)
      .order("created_at", { ascending: true }),
    supabase
      .from("team_memberships")
      .select("team_id,user_id")
      .eq("organization_id", context.organizationId)
  ]);

  if (teamsError) throw teamsError;
  if (membershipsError) throw membershipsError;

  const managerIds = [...new Set((teams ?? []).map((item) => item.manager_id as string | null).filter(Boolean))] as string[];
  const { data: managers, error: managersError } = managerIds.length
    ? await supabase.from("app_users").select("id,full_name").in("id", managerIds)
    : { data: [], error: null };

  if (managersError) throw managersError;

  const managerMap = new Map((managers ?? []).map((item) => [item.id as string, item.full_name as string | null]));
  const memberCounts = new Map<string, number>();
  for (const membership of memberships ?? []) {
    const teamId = membership.team_id as string | null;
    if (!teamId) continue;
    memberCounts.set(teamId, (memberCounts.get(teamId) ?? 0) + 1);
  }

  const items: TeamListItem[] = (teams ?? []).map((team) => ({
    teamId: team.id as string,
    name: team.name as string,
    managerUserId: (team.manager_id as string | null | undefined) ?? null,
    managerName: team.manager_id ? managerMap.get(team.manager_id as string) ?? null : null,
    memberCount: memberCounts.get(team.id as string) ?? 0,
    createdAt: team.created_at as string
  }));

  return { items };
}

export async function getTeamMembers(context: AuthSessionContext): Promise<TeamMembersResponse> {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) throw new Error("No active organization found for this user.");

  const { data: memberships, error } = await supabase
    .from("organization_members")
    .select("id,user_id,role,is_active,created_at")
    .eq("organization_id", context.organizationId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const userIds = [...new Set((memberships ?? []).map((item) => item.user_id as string | null).filter(Boolean))] as string[];
  const { data: users, error: usersError } = userIds.length
    ? await supabase
        .from("app_users")
        .select("id,email,full_name,is_active,created_at,external_auth_id,platform_role")
        .in("id", userIds)
    : { data: [], error: null };

  if (usersError) throw usersError;

  const { data: teamMemberships, error: teamMembershipsError } = await supabase
    .from("team_memberships")
    .select("user_id,team_id")
    .eq("organization_id", context.organizationId);

  if (teamMembershipsError) throw teamMembershipsError;

  const teamIds = [...new Set((teamMemberships ?? []).map((item) => item.team_id as string | null).filter(Boolean))] as string[];
  const { data: teams, error: teamsError } = teamIds.length
    ? await supabase
        .from("teams")
        .select("id,name,manager_id")
        .in("id", teamIds)
    : { data: [], error: null };

  if (teamsError) throw teamsError;

  const { data: defaultOrgUsers, error: defaultOrgUsersError } = await supabase
    .from("app_users")
    .select("id,email,full_name,is_active,created_at,external_auth_id,default_organization_id,platform_role")
    .eq("default_organization_id", context.organizationId);

  if (defaultOrgUsersError) throw defaultOrgUsersError;

  const teamManagerIds = [...new Set((teams ?? []).map((team) => team.manager_id as string | null).filter(Boolean))] as string[];
  const allManagerIds = [...new Set(teamManagerIds)];
  const { data: teamManagers, error: teamManagersError } = allManagerIds.length
    ? await supabase
        .from("app_users")
        .select("id,full_name")
        .in("id", allManagerIds)
    : { data: [], error: null };

  if (teamManagersError) throw teamManagersError;

  const visibleUsers = (users ?? []).filter((item) => !item.platform_role);
  const visibleDefaultOrgUsers = (defaultOrgUsers ?? []).filter((item) => !item.platform_role);
  const userMap = new Map(visibleUsers.map((item) => [item.id as string, item]));
  const scopedUsers = new Map<string, (typeof users)[number]>(
    [...visibleUsers, ...visibleDefaultOrgUsers].map((item) => [item.id as string, item])
  );
  const authUserIds = [...scopedUsers.values()]
    .map((item) => item.external_auth_id as string | null)
    .filter(Boolean) as string[];
  const { data: authUsersData, error: authUsersError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000
  });

  if (authUsersError) throw authUsersError;

  const authUsersById = new Map(
    authUsersData.users
      .filter((user) => authUserIds.includes(user.id))
      .map((user) => [user.id, user])
  );

  const teamById = new Map(
    (teams ?? []).map((team) => [
      team.id as string,
      {
        name: team.name as string,
        managerId: (team.manager_id as string | null | undefined) ?? null
      }
    ])
  );
  const teamManagerMap = new Map((teamManagers ?? []).map((item) => [item.id as string, item.full_name as string | null]));
  const teamMembershipByUser = new Map<string, { teamId: string | null; teamName: string | null; teamManagerId: string | null; teamManagerName: string | null }>();
  for (const membership of teamMemberships ?? []) {
    const userId = membership.user_id as string | null;
    if (!userId || teamMembershipByUser.has(userId)) continue;
    const teamId = (membership.team_id as string | null | undefined) ?? null;
    const team = teamId ? teamById.get(teamId) : null;
    teamMembershipByUser.set(userId, {
      teamId,
      teamName: team?.name ?? null,
      teamManagerId: team?.managerId ?? null,
      teamManagerName: team?.managerId ? teamManagerMap.get(team.managerId) ?? null : null
    });
  }

  const items: TeamMemberItem[] = (memberships ?? []).flatMap((membership) => {
    const user = userMap.get(membership.user_id as string);
    if (!user) return [];
    const authUser = user?.external_auth_id
      ? authUsersById.get(user.external_auth_id as string)
      : undefined;
    const onboardingStatus = !membership.is_active
      ? "inactive"
      : authUser?.last_sign_in_at || authUser?.email_confirmed_at
        ? "active"
        : authUser?.invited_at || user?.external_auth_id
          ? "pending"
          : "inactive";

    return [{
      memberId: membership.id as string,
      userId: membership.user_id as string,
      fullName: (user?.full_name as string | null | undefined) ?? null,
      email: (user?.email as string | null | undefined) ?? null,
      role: membership.role as string,
      teamId: teamMembershipByUser.get(membership.user_id as string)?.teamId ?? null,
      teamName: teamMembershipByUser.get(membership.user_id as string)?.teamName ?? null,
      teamManagerId: teamMembershipByUser.get(membership.user_id as string)?.teamManagerId ?? null,
      teamManagerName: teamMembershipByUser.get(membership.user_id as string)?.teamManagerName ?? null,
      isActive: Boolean(membership.is_active),
      onboardingStatus,
      invitedAt: (authUser?.invited_at as string | undefined) ?? null,
      lastSignInAt: (authUser?.last_sign_in_at as string | undefined) ?? null,
      joinedAt: (membership.created_at as string | null) ?? (user?.created_at as string | null | undefined) ?? null
    }];
  });

  const issues: TeamCleanupIssue[] = [];

  (memberships ?? []).forEach((membership) => {
    const user = userMap.get(membership.user_id as string);
    if (!user) {
      return;
    }

    if (!user.external_auth_id) {
      issues.push({
        id: `member-missing-auth-${membership.id as string}`,
        type: "member_missing_auth",
        severity: "medium",
        title: "Member has no linked auth account",
        detail: "This user exists in app_users but is missing external_auth_id, so invite and login flows may break until the record is repaired.",
        email: (user.email as string | null | undefined) ?? null,
        userId: user.id as string,
        memberId: membership.id as string,
        cleanupAction: null
      });
      return;
    }

    if (!authUsersById.get(user.external_auth_id as string)) {
      issues.push({
        id: `member-auth-missing-${membership.id as string}`,
        type: "member_auth_missing",
        severity: "high",
        title: "Member is linked to a deleted auth account",
        detail: "The app user still exists, but the Supabase auth user is gone. Reinvites may fail until the stale record is cleaned up or reconciled.",
        email: (user.email as string | null | undefined) ?? null,
        userId: user.id as string,
        memberId: membership.id as string,
        cleanupAction: null
      });
    }
  });

  [...scopedUsers.values()]
    .filter((user) => !userIds.includes(user.id as string))
    .forEach((user) => {
      const authExists = user.external_auth_id ? authUsersById.has(user.external_auth_id as string) : false;
      issues.push({
        id: `orphan-app-user-${user.id as string}`,
        type: "orphan_app_user",
        severity: authExists ? "medium" : "high",
        title: authExists ? "App user has no team membership" : "Stale app user has no auth account",
        detail: authExists
          ? "This user still exists in auth and app_users, but is not attached to this organization anymore."
          : "This user exists only in app_users with no active membership and no matching auth account.",
        email: (user.email as string | null | undefined) ?? null,
        userId: user.id as string,
        memberId: null,
        cleanupAction: "delete_orphan_app_user"
      });
    });

  const emailBuckets = new Map<string, string[]>();
  [...scopedUsers.values()].forEach((user) => {
    const email = ((user.email as string | null | undefined) ?? "").trim().toLowerCase();
    if (!email) return;
    emailBuckets.set(email, [...(emailBuckets.get(email) ?? []), user.id as string]);
  });

  emailBuckets.forEach((ids, email) => {
    if (ids.length < 2) return;
    issues.push({
      id: `duplicate-email-${email}`,
      type: "duplicate_email",
      severity: "medium",
      title: "Duplicate app user records share the same email",
      detail: "This can cause reinvites to attach to the wrong row. Clean up the stale duplicate before onboarding this person again.",
      email,
      userId: ids[0] ?? null,
      memberId: null,
      cleanupAction: null
    });
  });

  return { items, issues };
}
