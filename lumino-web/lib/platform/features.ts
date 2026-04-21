export type OrganizationBillingPlan = "free" | "starter" | "pro" | "intelligence";

export interface OrganizationFeatureFlags {
  mapEnabled: boolean;
  doorKnockingEnabled: boolean;
  visitLoggingEnabled: boolean;
  leadsEnabled: boolean;
  crmEnabled: boolean;
  appointmentsEnabled: boolean;
  selfImportsEnabled: boolean;
  advancedImportsEnabled: boolean;
  tasksEnabled: boolean;
  teamManagementEnabled: boolean;
  territoriesEnabled: boolean;
  solarCheckEnabled: boolean;
  importEnrichmentEnabled: boolean;
  bulkSolarEnrichmentEnabled: boolean;
  clusterAnalysisEnabled: boolean;
  premiumRoutingInsightsEnabled: boolean;
  datasetMarketplaceEnabled: boolean;
  enrichmentEnabled: boolean;
  priorityScoringEnabled: boolean;
  territoryPlanningEnabled: boolean;
  securityConsoleEnabled: boolean;
}

export interface OrganizationFeatureOverrides {
  enrichmentEnabled: boolean | null;
  priorityScoringEnabled: boolean | null;
  advancedImportsEnabled: boolean | null;
  securityConsoleEnabled: boolean | null;
}

export interface ResolvedOrganizationFeatures {
  billingPlan: OrganizationBillingPlan;
  preset: OrganizationFeatureFlags;
  overrides: OrganizationFeatureOverrides;
  effective: OrganizationFeatureFlags;
  uploadPolicy: {
    bulkUploadAllowed: boolean;
    contributionConsentRequired: boolean;
    contributedUploadsOnly: boolean;
  };
  datasetPolicy: {
    manualReleaseAllowed: boolean;
    autoReleaseAllPublishedDatasets: boolean;
  };
}

export const ORGANIZATION_BILLING_PLANS = [
  "free",
  "starter",
  "pro",
  "intelligence"
] as const satisfies readonly OrganizationBillingPlan[];

export const DEFAULT_ORGANIZATION_FEATURES: OrganizationFeatureFlags = {
  mapEnabled: true,
  doorKnockingEnabled: true,
  visitLoggingEnabled: true,
  leadsEnabled: false,
  crmEnabled: false,
  appointmentsEnabled: false,
  selfImportsEnabled: false,
  advancedImportsEnabled: false,
  tasksEnabled: false,
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
};

export const BILLING_PLAN_PRESETS: Record<OrganizationBillingPlan, OrganizationFeatureFlags> = {
  free: {
    mapEnabled: true,
    doorKnockingEnabled: true,
    visitLoggingEnabled: true,
    leadsEnabled: false,
    crmEnabled: false,
    appointmentsEnabled: false,
    selfImportsEnabled: true,
    advancedImportsEnabled: true,
    tasksEnabled: false,
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
  starter: {
    mapEnabled: true,
    doorKnockingEnabled: true,
    visitLoggingEnabled: true,
    leadsEnabled: true,
    crmEnabled: true,
    appointmentsEnabled: true,
    selfImportsEnabled: true,
    advancedImportsEnabled: true,
    tasksEnabled: false,
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
  pro: {
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
    importEnrichmentEnabled: false,
    bulkSolarEnrichmentEnabled: false,
    clusterAnalysisEnabled: false,
    premiumRoutingInsightsEnabled: false,
    datasetMarketplaceEnabled: true,
    enrichmentEnabled: false,
    priorityScoringEnabled: false,
    territoryPlanningEnabled: false,
    securityConsoleEnabled: false
  },
  intelligence: {
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
  }
};

export function normalizeOrganizationBillingPlan(plan: string | null | undefined): OrganizationBillingPlan {
  if (!plan) return "starter";
  if (ORGANIZATION_BILLING_PLANS.includes(plan as OrganizationBillingPlan)) {
    return plan as OrganizationBillingPlan;
  }

  // Backward compatibility for older seeded plans.
  if (plan === "team") return "pro";
  if (plan === "enterprise") return "intelligence";
  return "starter";
}

export function resolveOrganizationFeatures(input: {
  billingPlan: string | null | undefined;
  overrides?: Partial<OrganizationFeatureOverrides> | null;
}): ResolvedOrganizationFeatures {
  const billingPlan = normalizeOrganizationBillingPlan(input.billingPlan);
  const preset = BILLING_PLAN_PRESETS[billingPlan];
  const overrides: OrganizationFeatureOverrides = {
    enrichmentEnabled: input.overrides?.enrichmentEnabled ?? null,
    priorityScoringEnabled: input.overrides?.priorityScoringEnabled ?? null,
    advancedImportsEnabled: input.overrides?.advancedImportsEnabled ?? null,
    securityConsoleEnabled: input.overrides?.securityConsoleEnabled ?? null
  };

  const effective: OrganizationFeatureFlags = {
    ...preset,
    enrichmentEnabled: overrides.enrichmentEnabled ?? preset.enrichmentEnabled,
    priorityScoringEnabled: overrides.priorityScoringEnabled ?? preset.priorityScoringEnabled,
    selfImportsEnabled: overrides.advancedImportsEnabled ?? preset.selfImportsEnabled,
    advancedImportsEnabled: overrides.advancedImportsEnabled ?? preset.advancedImportsEnabled,
    securityConsoleEnabled: overrides.securityConsoleEnabled ?? preset.securityConsoleEnabled
  };

  return {
    billingPlan,
    preset,
    overrides,
    effective,
    uploadPolicy: {
      bulkUploadAllowed: effective.selfImportsEnabled,
      contributionConsentRequired: billingPlan === "free",
      contributedUploadsOnly: billingPlan === "free"
    },
    datasetPolicy: {
      manualReleaseAllowed: effective.datasetMarketplaceEnabled,
      autoReleaseAllPublishedDatasets: billingPlan === "intelligence"
    }
  };
}
