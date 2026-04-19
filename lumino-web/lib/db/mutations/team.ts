import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";

function mapMembershipRoleToAppUserRole(role: "owner" | "admin" | "manager" | "rep" | "setter") {
  if (role === "owner") return "admin";
  if (role === "setter") return "rep";
  return role;
}

function authUserIsActivated(user: { last_sign_in_at?: string | null; email_confirmed_at?: string | null }) {
  return Boolean(user.last_sign_in_at || user.email_confirmed_at);
}

export async function inviteTeamMember(
  input: { email: string; fullName: string; role: "owner" | "admin" | "manager" | "rep" | "setter" },
  context: AuthSessionContext,
  redirectTo?: string
) {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) throw new Error("No active organization found for this user.");

  const normalizedEmail = input.email.trim().toLowerCase();
  const appUserRole = mapMembershipRoleToAppUserRole(input.role);
  const [{ data: authUsersData, error: authUsersError }, { data: existingUsers, error: existingUsersError }] =
    await Promise.all([
      supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      supabase
        .from("app_users")
        .select("id,email,full_name,external_auth_id,default_organization_id,created_at")
        .eq("email", normalizedEmail)
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
        data: { full_name: input.fullName.trim() },
        redirectTo
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
    .select("id,email,full_name,external_auth_id,default_organization_id,created_at")
    .eq("external_auth_id", authUserId)
    .maybeSingle();

  if (appUserFromAuthError) throw appUserFromAuthError;

  let selectedUser = appUserFromAuth;
  const emailCandidates = (existingUsers ?? []).filter(Boolean);

  if (!selectedUser) {
    if (emailCandidates.length === 1) {
      selectedUser = emailCandidates[0];
    } else if (emailCandidates.length > 1) {
      const { data: orgMemberships, error: orgMembershipsError } = await supabase
        .from("organization_members")
        .select("id,user_id")
        .eq("organization_id", context.organizationId)
        .in("user_id", emailCandidates.map((item) => item.id as string));

      if (orgMembershipsError) throw orgMembershipsError;

      const currentOrgUserId = orgMemberships?.[0]?.user_id as string | undefined;
      if (currentOrgUserId) {
        selectedUser = emailCandidates.find((item) => item.id === currentOrgUserId) ?? null;
      } else {
        throw new Error("Multiple stale user records exist for this email. Use Team cleanup before reinviting.");
      }
    }
  }

  let userId: string;
  if (selectedUser?.id) {
    const { error: updateUserError } = await supabase
      .from("app_users")
      .update({
        email: normalizedEmail,
        full_name: input.fullName.trim(),
        role: appUserRole,
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

  const { data: existingMembership, error: membershipLookupError } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipLookupError) throw membershipLookupError;

  if (existingMembership?.id) {
    const { error: updateMembershipError } = await supabase
      .from("organization_members")
      .update({
        role: input.role,
        is_active: true,
        updated_at: new Date().toISOString()
      })
      .eq("id", existingMembership.id);

    if (updateMembershipError) throw updateMembershipError;

    if (!accessEmailType) {
      if (existingAuthUser && authUserIsActivated(existingAuthUser)) {
        const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: redirectTo?.replace("mode=invite", "mode=recovery")
        });
        if (error) throw error;
        accessEmailType = "reset";
      } else {
        const { error } = await supabase.auth.admin.inviteUserByEmail(normalizedEmail, {
          data: { full_name: input.fullName.trim() },
          redirectTo
        });
        if (error) throw error;
        accessEmailType = "invite";
      }
    }

    return {
      memberId: existingMembership.id as string,
      userId,
      invited: accessEmailType === "invite",
      accessEmailType
    };
  }

  const { data: insertedMembership, error: insertMembershipError } = await supabase
    .from("organization_members")
    .insert({
      organization_id: context.organizationId,
      user_id: userId,
      role: input.role,
      is_active: true,
      invited_by: context.appUser.id
    })
    .select("id")
    .single();

  if (insertMembershipError) throw insertMembershipError;

  if (!accessEmailType) {
    if (existingAuthUser && authUserIsActivated(existingAuthUser)) {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: redirectTo?.replace("mode=invite", "mode=recovery")
      });
      if (error) throw error;
      accessEmailType = "reset";
    } else {
      const { error } = await supabase.auth.admin.inviteUserByEmail(normalizedEmail, {
        data: { full_name: input.fullName.trim() },
        redirectTo
      });
      if (error) throw error;
      accessEmailType = "invite";
    }
  }

  return {
    memberId: insertedMembership.id as string,
    userId,
    invited: accessEmailType === "invite",
    accessEmailType
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

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("id,user_id,organization_id")
    .eq("organization_id", context.organizationId)
    .eq("id", memberId)
    .maybeSingle();

  if (membershipError) throw membershipError;
  if (!membership) throw new Error("Team member not found.");

  const { data: user, error: userError } = await supabase
    .from("app_users")
    .select("id,email,full_name")
    .eq("id", membership.user_id)
    .maybeSingle();

  if (userError) throw userError;
  if (!user?.email) throw new Error("Team member is missing an email address.");

  if (action === "resend_invite") {
    const { error } = await supabase.auth.admin.inviteUserByEmail(user.email, {
      data: { full_name: user.full_name ?? "" },
      redirectTo
    });
    if (error) throw error;
    return { ok: true as const };
  }

  const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
    redirectTo
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
