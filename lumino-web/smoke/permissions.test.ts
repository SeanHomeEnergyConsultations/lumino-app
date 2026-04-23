import assert from "node:assert/strict";
import test from "node:test";
import {
  hasAnyRole,
  hasFeatureAccess,
  hasPlatformAccess
} from "../lib/auth/permissions.ts";
import type { AuthSessionContext } from "../types/auth.ts";

function createContext(overrides: Partial<AuthSessionContext> = {}): AuthSessionContext {
  return {
    authUserId: "user-1",
    accessToken: "token",
    appUser: {
      id: "user-1",
      email: "user@example.com",
      fullName: "User Example",
      defaultOrganizationId: "org-1",
      role: "rep",
      platformRole: null,
      isActive: true
    },
    organizationId: "org-1",
    organizationStatus: "active",
    featureAccess: {
      mapEnabled: true,
      doorKnockingEnabled: true,
      visitLoggingEnabled: true,
      leadsEnabled: true,
      crmEnabled: true,
      appointmentsEnabled: true,
      selfImportsEnabled: false,
      advancedImportsEnabled: false,
      tasksEnabled: true,
      teamManagementEnabled: false,
      territoriesEnabled: false,
      solarCheckEnabled: false,
      importEnrichmentEnabled: false,
      bulkSolarEnrichmentEnabled: false,
      clusterAnalysisEnabled: false,
      premiumRoutingInsightsEnabled: false,
      datasetMarketplaceEnabled: false,
      enrichmentEnabled: false,
      priorityScoringEnabled: false,
      territoryPlanningEnabled: false,
      securityConsoleEnabled: false
    },
    memberships: [{ organizationId: "org-1", role: "rep" }],
    accessBlockedReason: null,
    hasActiveAccess: true,
    isPlatformOwner: false,
    isPlatformSupport: false,
    agreementRequiredVersion: "2026-01",
    agreementAcceptedVersion: "2026-01",
    agreementAcceptedAt: "2026-04-01T00:00:00.000Z",
    hasAcceptedRequiredAgreement: true,
    ...overrides
  };
}

test("hasAnyRole grants org members matching access", () => {
  assert.equal(hasAnyRole(createContext(), ["rep"]), true);
  assert.equal(hasAnyRole(createContext(), ["owner", "admin"]), false);
});

test("platform owners bypass role and feature checks", () => {
  const context = createContext({
    isPlatformOwner: true,
    memberships: []
  });

  assert.equal(hasAnyRole(context, ["owner"]), true);
  assert.equal(hasFeatureAccess(context, "securityConsoleEnabled"), true);
});

test("hasPlatformAccess only allows support or owners", () => {
  assert.equal(hasPlatformAccess(createContext()), false);
  assert.equal(hasPlatformAccess(createContext({ isPlatformSupport: true })), true);
  assert.equal(hasPlatformAccess(createContext({ isPlatformOwner: true })), true);
});
