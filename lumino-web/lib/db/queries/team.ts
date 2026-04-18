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
        .select("id,email,full_name,is_active,created_at")
        .in("id", userIds)
    : { data: [], error: null };

  if (usersError) throw usersError;

  const userMap = new Map((users ?? []).map((item) => [item.id as string, item]));

  const items: TeamMemberItem[] = (memberships ?? []).map((membership) => {
    const user = userMap.get(membership.user_id as string);
    return {
      memberId: membership.id as string,
      userId: membership.user_id as string,
      fullName: (user?.full_name as string | null | undefined) ?? null,
      email: (user?.email as string | null | undefined) ?? null,
      role: membership.role as string,
      isActive: Boolean(membership.is_active),
      joinedAt: (membership.created_at as string | null) ?? (user?.created_at as string | null | undefined) ?? null
    };
  });

  return { items };
}
