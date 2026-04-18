import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";

function mapMembershipRoleToAppUserRole(role: "owner" | "admin" | "manager" | "rep" | "setter") {
  if (role === "owner") return "admin";
  if (role === "setter") return "rep";
  return role;
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
  const [{ data: authUsersData, error: authUsersError }, { data: existingUser, error: existingUserError }] =
    await Promise.all([
      supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      supabase
        .from("app_users")
        .select("id,email,external_auth_id,default_organization_id")
        .eq("email", normalizedEmail)
        .maybeSingle()
    ]);

  if (authUsersError) throw authUsersError;
  if (existingUserError) throw existingUserError;

  const existingAuthUser = authUsersData.users.find(
    (user) => user.email?.toLowerCase() === normalizedEmail
  );

  let authUserId = existingAuthUser?.id as string | undefined;

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
  }

  if (!authUserId) {
    throw new Error("Could not create or resolve auth user for invite.");
  }

  let userId = existingUser?.id as string | undefined;

  if (!userId) {
    const { data: appUserFromTrigger, error: appUserLookupError } = await supabase
      .from("app_users")
      .select("id")
      .eq("external_auth_id", authUserId)
      .maybeSingle();

    if (appUserLookupError) throw appUserLookupError;

    if (appUserFromTrigger?.id) {
      userId = appUserFromTrigger.id as string;
      const { error: updateUserError } = await supabase
        .from("app_users")
        .update({
          email: normalizedEmail,
          full_name: input.fullName.trim(),
          role: appUserRole,
          is_active: true,
          default_organization_id: context.organizationId,
          updated_at: new Date().toISOString()
        })
        .eq("id", userId);

      if (updateUserError) throw updateUserError;
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
  } else {
    const { error: updateUserError } = await supabase
      .from("app_users")
      .update({
        email: normalizedEmail,
        full_name: input.fullName.trim(),
        role: appUserRole,
        is_active: true,
        external_auth_id: authUserId,
        default_organization_id: existingUser?.default_organization_id ?? context.organizationId,
        updated_at: new Date().toISOString()
      })
      .eq("id", userId);

    if (updateUserError) throw updateUserError;
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

    return {
      memberId: existingMembership.id as string,
      userId,
      invited: false
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

  return {
    memberId: insertedMembership.id as string,
    userId,
    invited: true
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
