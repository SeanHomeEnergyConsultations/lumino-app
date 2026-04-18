import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { TeamMembersResponse, TeamMemberItem } from "@/types/api";
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
        .select("id,email,full_name,is_active,created_at,external_auth_id")
        .in("id", userIds)
    : { data: [], error: null };

  if (usersError) throw usersError;

  const userMap = new Map((users ?? []).map((item) => [item.id as string, item]));
  const authUserIds = (users ?? [])
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

  const items: TeamMemberItem[] = (memberships ?? []).map((membership) => {
    const user = userMap.get(membership.user_id as string);
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

    return {
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
    };
  });

  return { items };
}
