import { randomUUID } from "node:crypto";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";

function buildTempExternalAuthId() {
  return randomUUID();
}

export async function inviteTeamMember(
  input: { email: string; fullName: string; role: "owner" | "admin" | "manager" | "rep" | "setter" },
  context: AuthSessionContext
) {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) throw new Error("No active organization found for this user.");

  const normalizedEmail = input.email.trim().toLowerCase();

  const { data: existingUser, error: existingUserError } = await supabase
    .from("app_users")
    .select("id,email")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (existingUserError) throw existingUserError;

  let userId = existingUser?.id as string | undefined;

  if (!userId) {
    const { data: insertedUser, error: insertUserError } = await supabase
      .from("app_users")
      .insert({
        email: normalizedEmail,
        full_name: input.fullName.trim(),
        role: input.role,
        is_active: true,
        external_auth_id: buildTempExternalAuthId(),
        default_organization_id: context.organizationId
      })
      .select("id")
      .single();

    if (insertUserError) throw insertUserError;
    userId = insertedUser.id as string;
  } else {
    const { error: updateUserError } = await supabase
      .from("app_users")
      .update({
        full_name: input.fullName.trim(),
        role: input.role,
        is_active: true,
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
