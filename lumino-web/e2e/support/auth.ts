import type { Page } from "@playwright/test";
import { CURRENT_AGREEMENT_COOKIE, CURRENT_AGREEMENT_VERSION } from "../../lib/legal/clickwrap";

const E2E_AUTH_STORAGE_KEY = "__lumino_e2e_auth";

const defaultFeatureAccess = {
  mapEnabled: true,
  doorKnockingEnabled: true,
  visitLoggingEnabled: true,
  leadsEnabled: true,
  crmEnabled: true,
  appointmentsEnabled: true,
  selfImportsEnabled: true,
  advancedImportsEnabled: true,
  tasksEnabled: true,
  teamManagementEnabled: true,
  territoriesEnabled: true,
  solarCheckEnabled: true,
  importEnrichmentEnabled: true,
  bulkSolarEnrichmentEnabled: true,
  clusterAnalysisEnabled: true,
  premiumRoutingInsightsEnabled: true,
  datasetMarketplaceEnabled: true,
  enrichmentEnabled: true,
  priorityScoringEnabled: true,
  territoryPlanningEnabled: true,
  securityConsoleEnabled: true
};

export function buildAuthState(overrides?: {
  organizationId?: string | null;
  role?: string;
  platformRole?: "platform_owner" | "platform_support" | null;
  isPlatformOwner?: boolean;
  featureAccess?: Partial<typeof defaultFeatureAccess>;
  hasAcceptedRequiredAgreement?: boolean;
}) {
  const organizationId = overrides?.organizationId ?? "org_1";
  const role = overrides?.role ?? "owner";
  const platformRole = overrides?.platformRole ?? "platform_owner";
  const isPlatformOwner = overrides?.isPlatformOwner ?? platformRole === "platform_owner";
  const featureAccess = {
    ...defaultFeatureAccess,
    ...(overrides?.featureAccess ?? {})
  };

  return {
    session: {
      access_token: "e2e-access-token",
      refresh_token: "e2e-refresh-token",
      user: {
        id: "user_1",
        email: "owner@lumino.test"
      }
    },
    appContext: {
      authUserId: "user_1",
      accessToken: "e2e-access-token",
      appUser: {
        id: "user_1",
        email: "owner@lumino.test",
        fullName: "E2E Owner",
        defaultOrganizationId: organizationId,
        role,
        platformRole,
        isActive: true
      },
      organizationId,
      organizationStatus: "active",
      featureAccess,
      memberships: organizationId ? [{ organizationId, role }] : [],
      accessBlockedReason: null,
      hasActiveAccess: true,
      isPlatformOwner,
      isPlatformSupport: platformRole === "platform_support",
      agreementRequiredVersion: CURRENT_AGREEMENT_VERSION,
      agreementAcceptedVersion:
        overrides?.hasAcceptedRequiredAgreement === false ? null : CURRENT_AGREEMENT_VERSION,
      agreementAcceptedAt:
        overrides?.hasAcceptedRequiredAgreement === false ? null : "2026-04-23T12:00:00.000Z",
      hasAcceptedRequiredAgreement: overrides?.hasAcceptedRequiredAgreement ?? true
    }
  };
}

export async function seedAuth(page: Page, state = buildAuthState()) {
  await page.goto("/login");
  await page.evaluate(([storageKey, payload, agreementCookie]) => {
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
    document.cookie = `${agreementCookie}=accepted; path=/`;
    window.dispatchEvent(new Event("lumino:e2e-auth-changed"));
  }, [E2E_AUTH_STORAGE_KEY, state, CURRENT_AGREEMENT_COOKIE] as const);
}

export async function clearAuth(page: Page) {
  await page.goto("/login");
  await page.evaluate(([storageKey, agreementCookie]) => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        session: null,
        appContext: null
      })
    );
    document.cookie = `${agreementCookie}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    window.dispatchEvent(new Event("lumino:e2e-auth-changed"));
  }, [E2E_AUTH_STORAGE_KEY, CURRENT_AGREEMENT_COOKIE] as const);
}

export async function stubTelemetry(page: Page) {
  await page.route("**/api/app-events", async (route) => {
    await route.fulfill({
      status: 204,
      body: ""
    });
  });
}
