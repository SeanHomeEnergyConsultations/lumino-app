import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { hasAdminAccess } from "@/lib/auth/permissions";
import {
  buildInviteRedirectUrl,
  buildInviteUserMetadata,
  buildPasswordResetRedirectUrl,
  getOrganizationAuthEmailBranding
} from "@/lib/auth/email-branding";
import type { AuthSessionContext } from "@/types/auth";

const MANAGER_MUTABLE_ROLES = new Set(["rep", "setter"]);

function mapMembershipRoleToAppUserRole(role: "owner" | "admin" | "manager" | "rep" | "setter") {
  if (role === "owner") return "admin";
  if (role === "setter") return "rep";
  return role;
}

function authUserIsActivated(user: { last_sign_in_at?: string | null; email_confirmed_at?: string | null }) {
  return Boolean(user.last_sign_in_at || user.email_confirmed_at);
}

type InviteCandidateUserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  external_auth_id: string | null;
  default_organization_id: string | null;
  created_at: string | null;
  is_active?: boolean | null;
};

async function ensureOrganizationMembershipRole(input: {
  supabase: ReturnType<typeof createServerSupabaseClient>;
  organizationId: string;
  userId: string;
  role: "owner" | "admin" | "manager" | "rep" | "setter";
  invitedBy: string;
}) {
  const { supabase, organizationId, userId, role, invitedBy } = input;

  const { data, error } = await supabase
    .from("organization_members")
    .upsert(
      {
        organization_id: organizationId,
        user_id: userId,
        role,
        is_active: true,
        invited_by: invitedBy,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "organization_id,user_id"
      }
    )
    .select("id,role")
    .single();

  if (error) throw error;
  const savedRole = (data.role as string | null | undefined) ?? null;
  if (savedRole !== role) {
    throw new Error(`Team membership role mismatch after save. Expected ${role}, received ${savedRole ?? "unknown"}.`);
  }

  return {
    memberId: data.id as string,
    role: savedRole
  };
}

async function resolveInviteCandidateUser(input: {
  supabase: ReturnType<typeof createServerSupabaseClient>;
  organizationId: string;
  authUserId: string;
  emailCandidates: InviteCandidateUserRow[];
}) {
  const { supabase, organizationId, authUserId, emailCandidates } = input;

  if (!emailCandidates.length) return null;
  if (emailCandidates.length === 1) return emailCandidates[0];

  const candidateIds = emailCandidates.map((item) => item.id);
  const { data: memberships, error: membershipsError } = await supabase
    .from("organization_members")
    .select("organization_id,user_id,is_active")
    .in("user_id", candidateIds);

  if (membershipsError) throw membershipsError;

  const membershipCountByUser = new Map<string, number>();
  const activeMembershipCountByUser = new Map<string, number>();
  let currentOrgUserId: string | null = null;

  for (const membership of memberships ?? []) {
    const userId = membership.user_id as string | null;
    if (!userId) continue;
    membershipCountByUser.set(userId, (membershipCountByUser.get(userId) ?? 0) + 1);
    if (membership.is_active) {
      activeMembershipCountByUser.set(userId, (activeMembershipCountByUser.get(userId) ?? 0) + 1);
    }
    if ((membership.organization_id as string | null) === organizationId) {
      currentOrgUserId = userId;
    }
  }

  if (currentOrgUserId) {
    return emailCandidates.find((item) => item.id === currentOrgUserId) ?? null;
  }

  const authLinkedCandidate = emailCandidates.find((item) => item.external_auth_id === authUserId);
  if (authLinkedCandidate) return authLinkedCandidate;

  const orphanCandidates = emailCandidates
    .filter((item) => (membershipCountByUser.get(item.id) ?? 0) === 0)
    .sort((left, right) => {
      const leftDate = left.created_at ?? "";
      const rightDate = right.created_at ?? "";
      return leftDate.localeCompare(rightDate);
    });
  if (orphanCandidates.length) {
    return orphanCandidates[0] ?? null;
  }

  const inactiveOnlyCandidates = emailCandidates
    .filter((item) => (activeMembershipCountByUser.get(item.id) ?? 0) === 0)
    .sort((left, right) => {
      const leftDate = left.created_at ?? "";
      const rightDate = right.created_at ?? "";
      return leftDate.localeCompare(rightDate);
    });
  if (inactiveOnlyCandidates.length === 1) {
    return inactiveOnlyCandidates[0];
  }

  throw new Error("Multiple stale user records exist for this email. Use Team cleanup before reinviting.");
}

export async function inviteTeamMember(
  input: { email: string; fullName: string; role: "owner" | "admin" | "manager" | "rep" | "setter" },
  context: AuthSessionContext,
  redirectTo?: string
) {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) throw new Error("No active organization found for this user.");
  const branding = await getOrganizationAuthEmailBranding(context.organizationId);
  const inviteRedirectTo = redirectTo ?? buildInviteRedirectUrl(branding.appUrl);
  const recoveryRedirectTo = buildPasswordResetRedirectUrl(branding.appUrl);
  const inviteMetadata = buildInviteUserMetadata(branding, input.fullName);

  const normalizedEmail = input.email.trim().toLowerCase();
  const appUserRole = mapMembershipRoleToAppUserRole(input.role);
  const [{ data: authUsersData, error: authUsersError }, { data: existingUsers, error: existingUsersError }] =
    await Promise.all([
      supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      supabase
        .from("app_users")
        .select("id,email,full_name,external_auth_id,default_organization_id,created_at,is_active")
        .ilike("email", normalizedEmail)
        .order("created_at", { ascending: true })
    ]);

  if (authUsersError) throw authUsersError;
  if (existingUsersError) throw existingUsersError;

  const existingAuthUser = authUsersData.users.find(
    (user) => user.email?.toLowerCase() === normalizedEmail
  );

  let authUserId = existingAuthUser?.id as string | undefined;
  let accessEmailType: "invite" | "reset" | null = null;

  if (!authUserId) {
    const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
      normalizedEmail,
      {
        data: inviteMetadata,
        redirectTo: inviteRedirectTo
      }
    );

    if (inviteError) throw inviteError;
    authUserId = inviteData.user?.id;
    accessEmailType = "invite";
  }

  if (!authUserId) {
    throw new Error("Could not create or resolve auth user for invite.");
  }

  const { data: appUserFromAuth, error: appUserFromAuthError } = await supabase
    .from("app_users")
    .select("id,email,full_name,external_auth_id,default_organization_id,created_at,is_active")
    .eq("external_auth_id", authUserId)
    .maybeSingle();

  if (appUserFromAuthError) throw appUserFromAuthError;

  let selectedUser: InviteCandidateUserRow | null = (appUserFromAuth as InviteCandidateUserRow | null) ?? null;
  const emailCandidates = ((existingUsers ?? []).filter(Boolean) as InviteCandidateUserRow[]).filter(
    (item) => item.email?.trim().toLowerCase() === normalizedEmail
  );

  if (!selectedUser) {
    selectedUser = await resolveInviteCandidateUser({
      supabase,
      organizationId: context.organizationId,
      authUserId,
      emailCandidates
    });
  }

  let userId: string;
  if (selectedUser?.id) {
    const { error: updateUserError } = await supabase
      .from("app_users")
      .update({
        email: normalizedEmail,
        full_name: input.fullName.trim(),
        is_active: true,
        external_auth_id: authUserId,
        default_organization_id: selectedUser.default_organization_id ?? context.organizationId,
        updated_at: new Date().toISOString()
      })
      .eq("id", selectedUser.id);

    if (updateUserError) throw updateUserError;
    userId = selectedUser.id as string;
  } else {
    const { data: insertedUser, error: insertUserError } = await supabase
      .from("app_users")
      .insert({
        email: normalizedEmail,
        full_name: input.fullName.trim(),
        role: appUserRole,
        is_active: true,
        external_auth_id: authUserId,
        default_organization_id: context.organizationId
      })
      .select("id")
      .single();

    if (insertUserError) throw insertUserError;
    userId = insertedUser.id as string;
  }

  const membership = await ensureOrganizationMembershipRole({
    supabase,
    organizationId: context.organizationId,
    userId,
    role: input.role,
    invitedBy: context.appUser.id
  });

  if (!accessEmailType) {
    if (existingAuthUser && authUserIsActivated(existingAuthUser)) {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: recoveryRedirectTo
      });
      if (error) throw error;
      accessEmailType = "reset";
    } else {
      const { error } = await supabase.auth.admin.inviteUserByEmail(normalizedEmail, {
        data: inviteMetadata,
        redirectTo: inviteRedirectTo
      });
      if (error) throw error;
      accessEmailType = "invite";
    }
  }

  return {
    memberId: membership.memberId,
    userId,
    invited: accessEmailType === "invite",
    accessEmailType,
    membershipRole: membership.role
  };
}

export async function triggerTeamMemberAccessEmail(
  memberId: string,
  action: "resend_invite" | "send_password_reset",
  context: AuthSessionContext,
  redirectTo: string
) {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) {
    throw new Error("No active organization found for this user.");
  }
  const branding = await getOrganizationAuthEmailBranding(context.organizationId);
  const inviteRedirectTo = redirectTo || buildInviteRedirectUrl(branding.appUrl);
  const recoveryRedirectTo = buildPasswordResetRedirectUrl(branding.appUrl);

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("id,user_id,organization_id,role")
    .eq("organization_id", context.organizationId)
    .eq("id", memberId)
    .maybeSingle();

  if (membershipError) throw membershipError;
  if (!membership) throw new Error("Team member not found.");
  const membershipRole = membership.role as string | null | undefined;
  if (!hasAdminAccess(context) && !MANAGER_MUTABLE_ROLES.has(membershipRole ?? "")) {
    throw new Error("Only admins can manage access emails for managers, admins, or owners.");
  }

  const { data: user, error: userError } = await supabase
    .from("app_users")
    .select("id,email,full_name")
    .eq("id", membership.user_id)
    .maybeSingle();

  if (userError) throw userError;
  if (!user?.email) throw new Error("Team member is missing an email address.");

  if (action === "resend_invite") {
    const { error } = await supabase.auth.admin.inviteUserByEmail(user.email, {
      data: buildInviteUserMetadata(branding, user.full_name ?? ""),
      redirectTo: inviteRedirectTo
    });
    if (error) throw error;
    return { ok: true as const };
  }

  const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
    redirectTo: recoveryRedirectTo
  });
  if (error) throw error;
  return { ok: true as const };
}

export async function updateTeamMember(
  memberId: string,
  input: { role?: "owner" | "admin" | "manager" | "rep" | "setter"; isActive?: boolean },
  context: AuthSessionContext
) {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) throw new Error("No active organization found for this user.");

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("id,role")
    .eq("organization_id", context.organizationId)
    .eq("id", memberId)
    .maybeSingle();

  if (membershipError) throw membershipError;
  if (!membership) throw new Error("Team member not found.");
  if (!hasAdminAccess(context) && !MANAGER_MUTABLE_ROLES.has((membership.role as string | null | undefined) ?? "")) {
    throw new Error("Only admins can manage managers, admins, or owners.");
  }
  if (!hasAdminAccess(context) && input.role && !MANAGER_MUTABLE_ROLES.has(input.role)) {
    throw new Error("Only admins can assign manager, admin, or owner roles.");
  }

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };

  if (input.role !== undefined) payload.role = input.role;
  if (input.isActive !== undefined) payload.is_active = input.isActive;

  const { error } = await supabase
    .from("organization_members")
    .update(payload)
    .eq("organization_id", context.organizationId)
    .eq("id", memberId);

  if (error) throw error;
  return { memberId };
}

export async function removeTeamMember(memberId: string, context: AuthSessionContext) {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) throw new Error("No active organization found for this user.");

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("id,user_id,role")
    .eq("organization_id", context.organizationId)
    .eq("id", memberId)
    .maybeSingle();

  if (membershipError) throw membershipError;
  if (!membership) throw new Error("Team member not found.");
  if (!["rep", "setter"].includes(membership.role as string)) {
    throw new Error("Only reps and setters can be deleted.");
  }

  const { error } = await supabase
    .from("organization_members")
    .delete()
    .eq("organization_id", context.organizationId)
    .eq("id", memberId);

  if (error) throw error;
  return { memberId };
}

export async function deleteTeamMemberAccount(memberId: string, context: AuthSessionContext) {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) throw new Error("No active organization found for this user.");

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("id,user_id,role")
    .eq("organization_id", context.organizationId)
    .eq("id", memberId)
    .maybeSingle();

  if (membershipError) throw membershipError;
  if (!membership) throw new Error("Team member not found.");
  if (!["rep", "setter"].includes(membership.role as string)) {
    throw new Error("Only reps and setters can be deleted.");
  }

  const { count: membershipCount, error: membershipCountError } = await supabase
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("user_id", membership.user_id);

  if (membershipCountError) throw membershipCountError;
  if ((membershipCount ?? 0) > 1) {
    throw new Error("This user belongs to another organization too, so only removal from this organization is safe.");
  }

  const { data: user, error: userError } = await supabase
    .from("app_users")
    .select("id,external_auth_id")
    .eq("id", membership.user_id)
    .maybeSingle();

  if (userError) throw userError;

  const { error: deleteMembershipError } = await supabase
    .from("organization_members")
    .delete()
    .eq("id", memberId)
    .eq("organization_id", context.organizationId);

  if (deleteMembershipError) throw deleteMembershipError;

  if (user?.external_auth_id) {
    const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(user.external_auth_id as string);
    if (deleteAuthError) throw deleteAuthError;
  }

  if (user?.id) {
    const { error: deleteAppUserError } = await supabase
      .from("app_users")
      .delete()
      .eq("id", user.id);

    if (deleteAppUserError) throw deleteAppUserError;
  }

  return { memberId, deletedAccount: true as const };
}

export async function deleteOrphanAppUser(userId: string, context: AuthSessionContext) {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) throw new Error("No active organization found for this user.");

  const { count: membershipCount, error: membershipCountError } = await supabase
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (membershipCountError) throw membershipCountError;
  if ((membershipCount ?? 0) > 0) {
    throw new Error("This user still has organization memberships and is not safe to clean up as an orphan.");
  }

  const { data: user, error: userError } = await supabase
    .from("app_users")
    .select("id,external_auth_id,default_organization_id")
    .eq("id", userId)
    .maybeSingle();

  if (userError) throw userError;
  if (!user) throw new Error("App user not found.");
  if (user.default_organization_id !== context.organizationId) {
    throw new Error("This orphaned user does not belong to the active organization.");
  }

  if (user.external_auth_id) {
    await supabase.auth.admin.deleteUser(user.external_auth_id as string).catch(() => null);
  }

  const { error: deleteAppUserError } = await supabase
    .from("app_users")
    .delete()
    .eq("id", userId);

  if (!deleteAppUserError) {
    return { userId, archived: false as const };
  }

  const archivedEmail = `deleted+${userId}@lumino.invalid`;
  const { error: archiveUserError } = await supabase
    .from("app_users")
    .update({
      email: archivedEmail,
      full_name: "Deleted User",
      external_auth_id: null,
      default_organization_id: null,
      is_active: false,
      updated_at: new Date().toISOString()
    })
    .eq("id", userId);

  if (archiveUserError) throw archiveUserError;
  return { userId, archived: true as const };
}
