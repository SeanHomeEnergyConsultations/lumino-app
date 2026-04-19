export interface AuthAppUser {
  id: string;
  email: string | null;
  fullName: string | null;
  defaultOrganizationId: string | null;
  role: string | null;
  platformRole: "platform_owner" | "platform_support" | null;
  isActive: boolean;
}

export interface AuthMembership {
  organizationId: string;
  role: string;
}

export interface AuthSessionContext {
  authUserId: string;
  accessToken: string;
  appUser: AuthAppUser;
  organizationId: string | null;
  organizationStatus: string | null;
  memberships: AuthMembership[];
  accessBlockedReason: "user_disabled" | "organization_disabled" | "no_active_membership" | null;
  hasActiveAccess: boolean;
  isPlatformOwner: boolean;
  isPlatformSupport: boolean;
  agreementRequiredVersion: string;
  agreementAcceptedVersion: string | null;
  agreementAcceptedAt: string | null;
  hasAcceptedRequiredAgreement: boolean;
}
