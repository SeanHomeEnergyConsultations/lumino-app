"use client";

import { Building2, CheckCircle2, ChevronDown, ExternalLink, ShieldAlert, Sparkles } from "lucide-react";
import { AppBrandingEditor } from "@/components/platform/app-branding-editor";
import {
  ORGANIZATION_BILLING_PLANS,
  effectivePresetBadges,
  formatBillingPlan,
  formatDateTime,
  getOrganizationSaveLabel,
  summarizeEffectivePreset,
  usePlatformWorkspace,
  type DatasetEntitlementDraftKey,
  type FeatureDraft
} from "@/components/platform/platform-workspace-context";
import type { PlatformOrganizationOverviewItem } from "@/types/api";

const FEATURE_OVERRIDE_FIELDS: ReadonlyArray<{
  key: keyof Pick<
    FeatureDraft,
    "enrichmentEnabled" | "priorityScoringEnabled" | "advancedImportsEnabled" | "securityConsoleEnabled"
  >;
  label: string;
}> = [
  { key: "enrichmentEnabled", label: "Enrichment" },
  { key: "priorityScoringEnabled", label: "Priority Scoring" },
  { key: "advancedImportsEnabled", label: "Advanced Imports" },
  { key: "securityConsoleEnabled", label: "Security Console" }
];

const DATASET_ENTITLEMENT_FIELDS: ReadonlyArray<{ key: DatasetEntitlementDraftKey; label: string }> = [
  { key: "sold_properties", label: "Sold Homes" },
  { key: "solar_permits", label: "Solar Permits" },
  { key: "roofing_permits", label: "Roofing Permits" }
];

function OrganizationAccessCard({ item }: { item: PlatformOrganizationOverviewItem }) {
  const {
    canMutate,
    drafts,
    expandedOrganizations,
    navigatingOrgId,
    savingOrgId,
    toggleOrganization,
    updateDraft,
    switchAndGo,
    saveOrganization
  } = usePlatformWorkspace();

  const draft = drafts[item.organizationId];
  const isExpanded = expandedOrganizations[item.organizationId] ?? false;
  const platformLocked = item.isPlatformSource;

  return (
    <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50/90 p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <button
          type="button"
          onClick={() => toggleOrganization(item.organizationId)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-lg font-semibold text-ink">{item.name}</div>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                item.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
              }`}
            >
              {item.status}
            </span>
            <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
              {formatBillingPlan(item.billingPlan)}
            </span>
            {item.isPlatformSource ? (
              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
                Platform Source
              </span>
            ) : null}
            <ChevronDown className={`ml-auto h-5 w-5 text-slate-400 transition ${isExpanded ? "rotate-180" : ""}`} />
          </div>
          <div className="mt-2 text-sm text-slate-500">
            {item.appName}
            {item.slug ? ` · ${item.slug}` : ""}
          </div>
          <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Team</div>
              <div className="mt-1">
                {item.activeTeamMemberCount} active / {item.teamMemberCount} total
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Imports</div>
              <div className="mt-1">
                {item.completedImportCount} completed / {item.importBatchCount} total
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Territories</div>
              <div className="mt-1">{item.territoryCount}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Last Activity</div>
              <div className="mt-1">{formatDateTime(item.lastActivityAt, "Not yet")}</div>
            </div>
          </div>
        </button>

        <div className="flex flex-wrap gap-2 xl:pl-4">
          <button
            type="button"
            onClick={() => void switchAndGo(item.organizationId, "/dashboard")}
            disabled={navigatingOrgId !== null}
            className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            {navigatingOrgId === item.organizationId ? "Switching…" : "Enter Org"}
          </button>
          <button
            type="button"
            onClick={() => void switchAndGo(item.organizationId, "/team")}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Open Team
          </button>
          <button
            type="button"
            onClick={() => void switchAndGo(item.organizationId, "/imports")}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Open Imports
          </button>
          <button
            type="button"
            onClick={() => void switchAndGo(item.organizationId, "/dashboard")}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Open Dashboard
          </button>
        </div>
      </div>

      {isExpanded ? (
        <>
          {item.isPlatformSource ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600">
              This organization is locked as the platform source org. Shared datasets are published from here, and customer
              plan controls do not apply.
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 xl:grid-cols-[1fr,1fr,1fr,1fr,1.1fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Setup Checklist</div>
              <div className="mt-3 space-y-3">
                {[
                  {
                    label: "First admin invited",
                    done: item.checklist.firstAdminInvited,
                    href: "/team"
                  },
                  {
                    label: "Branding configured",
                    done: item.checklist.brandingConfigured,
                    href: "/team/branding"
                  },
                  {
                    label: "First import completed",
                    done: item.checklist.firstImportCompleted,
                    href: "/imports"
                  },
                  {
                    label: "First territory created",
                    done: item.checklist.firstTerritoryCreated,
                    href: "/team/territories"
                  }
                ].map((check) => (
                  <div key={check.label} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2">
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      {check.done ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <ShieldAlert className="h-4 w-4 text-amber-600" />
                      )}
                      {check.label}
                    </div>
                    {!check.done ? (
                      <button
                        type="button"
                        onClick={() => void switchAndGo(item.organizationId, check.href)}
                        className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 transition hover:text-ink"
                      >
                        Fix
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Organization</div>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Name</label>
                  <input
                    type="text"
                    value={draft?.name ?? item.name}
                    disabled={!canMutate}
                    onChange={(event) =>
                      updateDraft(item.organizationId, (current) => ({
                        ...current,
                        name: event.target.value
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Slug</label>
                  <input
                    type="text"
                    value={draft?.slug ?? item.slug ?? ""}
                    disabled={!canMutate}
                    onChange={(event) =>
                      updateDraft(item.organizationId, (current) => ({
                        ...current,
                        slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-")
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Plan & Packaging</div>
              <div className="mt-3">
                <label className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">Billing Plan</label>
                <select
                  value={draft?.billingPlan ?? item.billingPlan}
                  disabled={!canMutate || platformLocked}
                  onChange={(event) =>
                    updateDraft(item.organizationId, (current) => ({
                      ...current,
                      billingPlan: event.target.value as PlatformOrganizationOverviewItem["billingPlan"]
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                >
                  {ORGANIZATION_BILLING_PLANS.map((plan) => (
                    <option key={plan} value={plan}>
                      {formatBillingPlan(plan)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-3 text-sm text-slate-500">
                Effective preset:
                <span className="ml-2 font-medium text-slate-700">
                  {item.effectiveFeatures.importEnrichmentEnabled ? "Premium enrichment" : "Upload-first only"},{" "}
                  {item.effectiveFeatures.bulkSolarEnrichmentEnabled ? "Bulk solar" : "No bulk solar"},{" "}
                  {item.effectiveFeatures.datasetMarketplaceEnabled ? "Marketplace" : "No marketplace"}
                </span>
              </div>
              <div className="mt-2 text-xs text-slate-500">{summarizeEffectivePreset(item)}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {effectivePresetBadges(item).map((badge) => (
                  <div
                    key={badge}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600"
                  >
                    {badge}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-mist">
                <Sparkles className="h-4 w-4" />
                Feature Overrides
              </div>
              <div className="mt-3 space-y-3">
                {FEATURE_OVERRIDE_FIELDS.map((field) => (
                  <div key={field.key} className="rounded-2xl bg-slate-50 px-3 py-2">
                    <div className="text-sm font-medium text-slate-700">{field.label}</div>
                    <div className="mt-2 flex gap-2">
                      {[
                        { value: "inherit", label: "Inherit" },
                        { value: "true", label: "On" },
                        { value: "false", label: "Off" }
                      ].map((option) => {
                        const currentValue = draft?.[field.key];
                        const normalized =
                          currentValue === null || currentValue === undefined ? "inherit" : String(currentValue);
                        const active = normalized === option.value;

                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() =>
                              canMutate &&
                              !platformLocked &&
                              updateDraft(item.organizationId, (current) => ({
                                ...current,
                                [field.key]:
                                  option.value === "inherit" ? null : option.value === "true"
                                    ? true
                                    : false
                              }))
                            }
                            disabled={!canMutate || platformLocked}
                            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] transition ${
                              active
                                ? "bg-ink text-white"
                                : "border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Marketplace Access</div>
              <div className="mt-2 text-xs text-slate-500">
                Owner-managed city and zip entitlements for sold homes and permit datasets.
              </div>
              <div className="mt-3 space-y-3">
                {DATASET_ENTITLEMENT_FIELDS.map((datasetField) => (
                  <div key={datasetField.key} className="rounded-2xl bg-slate-50 px-3 py-3">
                    <div className="text-sm font-medium text-slate-700">{datasetField.label}</div>
                    <div className="mt-3 space-y-2">
                      <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-mist">
                        Cities
                        <textarea
                          disabled={!canMutate || platformLocked}
                          value={draft?.datasetEntitlements[datasetField.key].cities ?? ""}
                          onChange={(event) =>
                            updateDraft(item.organizationId, (current) => ({
                              ...current,
                              datasetEntitlements: {
                                ...current.datasetEntitlements,
                                [datasetField.key]: {
                                  ...current.datasetEntitlements[datasetField.key],
                                  cities: event.target.value
                                }
                              }
                            }))
                          }
                          placeholder="Framingham, Worcester"
                          rows={3}
                          className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-700"
                        />
                      </label>
                      <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-mist">
                        Zip Codes
                        <textarea
                          disabled={!canMutate || platformLocked}
                          value={draft?.datasetEntitlements[datasetField.key].zips ?? ""}
                          onChange={(event) =>
                            updateDraft(item.organizationId, (current) => ({
                              ...current,
                              datasetEntitlements: {
                                ...current.datasetEntitlements,
                                [datasetField.key]: {
                                  ...current.datasetEntitlements[datasetField.key],
                                  zips: event.target.value
                                }
                              }
                            }))
                          }
                          placeholder="01701, 01826"
                          rows={3}
                          className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-700"
                        />
                      </label>
                      <div className="text-[11px] normal-case tracking-normal text-slate-500">
                        Enter multiple values separated by commas or new lines.
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void saveOrganization(item)}
              disabled={savingOrgId === item.organizationId || !canMutate || platformLocked}
              className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:cursor-wait disabled:opacity-70"
            >
              {getOrganizationSaveLabel(item, canMutate, savingOrgId === item.organizationId)}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function PlatformOrganizationsSurface() {
  const {
    canMutate,
    creatingOrganization,
    items,
    loading,
    newOrganizationAppName,
    newOrganizationName,
    newOrganizationSlug,
    setNewOrganizationAppName,
    setNewOrganizationName,
    setNewOrganizationSlug,
    createOrganization
  } = usePlatformWorkspace();

  return (
    <div className="space-y-6">
      {canMutate ? <AppBrandingEditor /> : null}

      {canMutate ? (
        <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-panel backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Create Organization</div>
              <div className="mt-1 text-sm text-slate-500">
                Add a new customer org here, then manage its plan, packaging, and launch readiness below.
              </div>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
              Owner-only workspace
            </div>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[1.1fr_0.8fr_0.8fr_auto]">
            <input
              type="text"
              value={newOrganizationName}
              onChange={(event) => setNewOrganizationName(event.target.value)}
              placeholder="Organization name"
              className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            />
            <input
              type="text"
              value={newOrganizationSlug}
              onChange={(event) => setNewOrganizationSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              placeholder="slug"
              className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            />
            <input
              type="text"
              value={newOrganizationAppName}
              onChange={(event) => setNewOrganizationAppName(event.target.value)}
              placeholder="App name (optional)"
              className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            />
            <button
              type="button"
              onClick={() => void createOrganization()}
              disabled={creatingOrganization || !newOrganizationName.trim()}
              className="rounded-2xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creatingOrganization ? "Creating..." : "Create"}
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-panel backdrop-blur">
        <div className="flex items-center gap-3">
          <Building2 className="h-5 w-5 text-slate-500" />
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Organizations</div>
            <p className="mt-1 text-sm text-slate-500">
              Billing plans, feature flags, setup progress, and one-click entry into each org.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {loading ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
              Loading organizations…
            </div>
          ) : items.length ? (
            items.map((item) => <OrganizationAccessCard key={item.organizationId} item={item} />)
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
              No organizations found yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
