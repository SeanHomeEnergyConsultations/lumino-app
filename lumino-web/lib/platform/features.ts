export type OrganizationBillingPlan = "starter" | "pro" | "team" | "enterprise";

export interface OrganizationFeatureFlags {
  enrichmentEnabled: boolean;
  priorityScoringEnabled: boolean;
  advancedImportsEnabled: boolean;
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
}

export const ORGANIZATION_BILLING_PLANS = [
  "starter",
  "pro",
  "team",
  "enterprise"
] as const satisfies readonly OrganizationBillingPlan[];

export const DEFAULT_ORGANIZATION_FEATURES: OrganizationFeatureFlags = {
  enrichmentEnabled: false,
  priorityScoringEnabled: false,
  advancedImportsEnabled: false,
  securityConsoleEnabled: false
};

export const BILLING_PLAN_PRESETS: Record<OrganizationBillingPlan, OrganizationFeatureFlags> = {
  starter: {
    enrichmentEnabled: false,
    priorityScoringEnabled: false,
    advancedImportsEnabled: false,
    securityConsoleEnabled: false
  },
  pro: {
    enrichmentEnabled: true,
    priorityScoringEnabled: true,
    advancedImportsEnabled: false,
    securityConsoleEnabled: false
  },
  team: {
    enrichmentEnabled: true,
    priorityScoringEnabled: true,
    advancedImportsEnabled: true,
    securityConsoleEnabled: false
  },
  enterprise: {
    enrichmentEnabled: true,
    priorityScoringEnabled: true,
    advancedImportsEnabled: true,
    securityConsoleEnabled: true
  }
};

export function normalizeOrganizationBillingPlan(plan: string | null | undefined): OrganizationBillingPlan {
  if (plan && ORGANIZATION_BILLING_PLANS.includes(plan as OrganizationBillingPlan)) {
    return plan as OrganizationBillingPlan;
  }
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

  return {
    billingPlan,
    preset,
    overrides,
    effective: {
      enrichmentEnabled: overrides.enrichmentEnabled ?? preset.enrichmentEnabled,
      priorityScoringEnabled: overrides.priorityScoringEnabled ?? preset.priorityScoringEnabled,
      advancedImportsEnabled: overrides.advancedImportsEnabled ?? preset.advancedImportsEnabled,
      securityConsoleEnabled: overrides.securityConsoleEnabled ?? preset.securityConsoleEnabled
    }
  };
}
