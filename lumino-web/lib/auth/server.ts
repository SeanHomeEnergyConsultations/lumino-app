import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { CURRENT_AGREEMENT_VERSION } from "@/lib/legal/clickwrap";
import { getSupabasePublicEnv } from "@/lib/utils/env";
import type { AuthSessionContext } from "@/types/auth";

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export async function getRequestSessionContext(
  request: Request,
  options?: { allowBlocked?: boolean }
): Promise<AuthSessionContext | null> {
  const accessToken = getBearerToken(request);
  if (!accessToken) return null;

  const publicEnv = getSupabasePublicEnv();
  const authClient = createClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    auth: { persistSession: false }
  });
  const {
    data: { user },
    error: userError
  } = await authClient.auth.getUser(accessToken);

  if (userError || !user) return null;

  const serviceClient = createServerSupabaseClient();
  const { data: appUser, error: appUserError } = await serviceClient
    .from("app_users")
    .select("id,email,full_name,default_organization_id,role,platform_role,is_active")
    .eq("external_auth_id", user.id)
    .maybeSingle();

  if (appUserError || !appUser) return null;

  const { data: memberships, error: membershipError } = await serviceClient
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", appUser.id)
    .eq("is_active", true);

  if (membershipError) return null;

  const { data: agreement, error: agreementError } = await serviceClient
    .from("agreements")
    .select("version,accepted_at")
    .eq("user_id", appUser.id)
    .eq("version", CURRENT_AGREEMENT_VERSION)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (agreementError) return null;

  const normalizedMemberships =
    memberships?.map((item) => ({
      organizationId: item.organization_id,
      role: item.role
    })) ?? [];

  const platformRole = (appUser.platform_role as AuthSessionContext["appUser"]["platformRole"]) ?? null;
  const isPlatformOwner = platformRole === "platform_owner";
  const isPlatformSupport = platformRole === "platform_support";
  const organizationId = appUser.default_organization_id ?? normalizedMemberships[0]?.organizationId ?? null;
  const { data: organization, error: organizationError } = organizationId
    ? await serviceClient.from("organizations").select("status").eq("id", organizationId).maybeSingle()
    : { data: null, error: null };

  if (organizationError) return null;

  const organizationStatus = (organization?.status as string | null) ?? null;
  const hasActiveMembership = normalizedMemberships.length > 0 && Boolean(organizationId);
  const organizationDisabled = organizationStatus === "suspended" || organizationStatus === "cancelled";
  const hasActiveAccess = Boolean(appUser.is_active) && ((hasActiveMembership && !organizationDisabled) || isPlatformOwner || isPlatformSupport);
  const accessBlockedReason: AuthSessionContext["accessBlockedReason"] = !appUser.is_active
    ? "user_disabled"
    : !hasActiveMembership && !isPlatformOwner && !isPlatformSupport
      ? "no_active_membership"
      : organizationDisabled && !isPlatformOwner && !isPlatformSupport
        ? "organization_disabled"
        : null;

  const context = {
    authUserId: user.id,
    accessToken,
    appUser: {
      id: appUser.id,
      email: appUser.email,
      fullName: appUser.full_name,
      defaultOrganizationId: appUser.default_organization_id,
      role: appUser.role,
      platformRole,
      isActive: Boolean(appUser.is_active)
    },
    organizationId,
    organizationStatus,
    memberships: normalizedMemberships,
    accessBlockedReason,
    hasActiveAccess,
    isPlatformOwner,
    isPlatformSupport,
    agreementRequiredVersion: CURRENT_AGREEMENT_VERSION,
    agreementAcceptedVersion: (agreement?.version as string | null) ?? null,
    agreementAcceptedAt: (agreement?.accepted_at as string | null) ?? null,
    hasAcceptedRequiredAgreement: (agreement?.version as string | null) === CURRENT_AGREEMENT_VERSION
  };

  if (!options?.allowBlocked && !context.hasActiveAccess) {
    return null;
  }

  return context;
}
