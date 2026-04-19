import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { TeamCleanupIssue, TeamMembersResponse, TeamMemberItem } from "@/types/api";
import type { AuthSessionContext } from "@/types/auth";

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

  const { data: defaultOrgUsers, error: defaultOrgUsersError } = await supabase
    .from("app_users")
    .select("id,email,full_name,is_active,created_at,external_auth_id,default_organization_id,platform_role")
    .eq("default_organization_id", context.organizationId);

  if (defaultOrgUsersError) throw defaultOrgUsersError;

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
