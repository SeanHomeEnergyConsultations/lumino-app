export interface AuthAppUser {
  id: string;
  email: string | null;
  fullName: string | null;
  defaultOrganizationId: string | null;
  role: string | null;
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
  memberships: AuthMembership[];
  agreementRequiredVersion: string;
  agreementAcceptedVersion: string | null;
  agreementAcceptedAt: string | null;
  hasAcceptedRequiredAgreement: boolean;
}
