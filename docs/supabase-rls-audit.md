# Supabase RLS Audit

Date: 2026-04-20

## Executive Summary

The app currently uses the Supabase service-role key for all server-side database access in [supabase-server.ts](/Users/Work/Library/CloudStorage/OneDrive-Personal/Lumino%20-%20App/lumino-web/lib/db/supabase-server.ts). That means:

- most app behavior is currently protected by API auth and server-side permission checks
- RLS still matters as a defense-in-depth boundary
- newer tables created after the initial auth/RLS foundation are not fully protected at the database layer yet

The original CRM/lead-routing tables have an RLS foundation in [schema.sql](/Users/Work/Library/CloudStorage/OneDrive-Personal/Lumino%20-%20App/supabase/schema.sql).

The main gaps are the newer tables introduced by later migrations:

- platform/shared-dataset tables
- security/audit tables
- property/territory/task/visit workflow tables
- feature/entitlement control-plane tables

## Current State By Table

### Has RLS and policies in schema

- `organizations`
- `app_users`
- `organization_members`
- `import_batches`
- `import_batch_items`
- `leads`
- `lead_analysis`
- `lead_neighbors`
- `lead_activities`
- `route_drafts`
- `route_draft_stops`
- `route_runs`
- `route_run_stops`
- `route_run_events`
- `saved_filters`
- `usage_events`

### Present, but no RLS/policies found in reviewed schema or migrations

Org-owned operational tables:
- `properties`
- `teams`
- `team_memberships`
- `territories`
- `property_territories`
- `visits`
- `tasks`
- `appointments`
- `activities`
- `property_source_records`
- `property_enrichments`

Platform/control-plane tables:
- `organization_features`
- `organization_dataset_entitlements`
- `platform_datasets`
- `platform_dataset_records`
- `organization_dataset_access`
- `organization_dataset_targets`

Security tables:
- `security_events`
- `security_rate_limits`

Other newer tables that also deserve review:
- `households`
- `people`
- `notifications`
- `kpi_fact_daily_rep`
- `kpi_fact_daily_territory`
- `lead_status_history`

## Risk Assessment

### 1. Org isolation risk

Risk:
- tables like `visits`, `tasks`, `appointments`, `activities`, `territories`, and `property_source_records` are org-scoped by schema
- but they do not appear to have RLS policies enforcing org membership at the database layer

Current mitigation:
- server APIs apply organization filters and permission checks
- service-role access bypasses RLS anyway

Residual risk:
- if a future client-side query or Supabase browser client access is added directly to one of these tables, cross-org exposure becomes much easier

### 2. Shared dataset platform risk

Risk:
- `platform_datasets`, `platform_dataset_records`, `organization_dataset_access`, and `organization_dataset_targets` appear to have no RLS
- these are among the highest-sensitivity tables because they determine who can see shared commercial data

Current mitigation:
- access is controlled in server mutations/queries

Residual risk:
- a direct client path or misconfigured future endpoint could expose the entire platform dataset layer

### 3. Security-event exposure risk

Risk:
- `security_events` and `security_rate_limits` appear to have no RLS
- `security_events` contains IP address, user agent, actor/target relationships, and sensitive metadata

Current mitigation:
- only platform APIs read them today

Residual risk:
- these should be locked down explicitly at the database layer, ideally to no direct client access at all

### 4. Canonical property model ambiguity

Risk:
- `properties` is increasingly acting like a canonical property store used by multiple org workflows
- it has no visible RLS policy in the reviewed schema/migrations

Design question:
- should properties be:
  - globally inaccessible except through server APIs, or
  - selectively visible through org-local leads, source records, dataset targets, and source-org dataset ownership

Recommendation:
- do not expose `properties` directly to browser clients
- keep `properties` behind server APIs until a careful RLS design exists

## Recommended Policy Model

### A. Org-owned operational tables

Enable RLS and restrict by `organization_id in current_org_ids()`.

Applies to:
- `teams`
- `team_memberships`
- `territories`
- `property_territories`
- `visits`
- `tasks`
- `appointments`
- `activities`
- `property_source_records`
- `property_enrichments`
- `households`
- `people`
- `notifications`
- `kpi_fact_daily_rep`
- `kpi_fact_daily_territory`
- `lead_status_history`

Recommended pattern:
- org members can `select`
- managers/admins/owners can mutate where appropriate
- reps can mutate only rows assigned to them where needed

### B. Platform-only control-plane tables

Enable RLS, but do not grant general org-member access.

Applies to:
- `platform_datasets`
- `platform_dataset_records`
- `organization_dataset_access`
- `organization_dataset_targets`
- `organization_features`
- `organization_dataset_entitlements`

Recommended pattern:
- no direct browser-client access by default
- if direct access is ever needed, use narrowly scoped policies:
  - source org can read its own `platform_datasets`
  - org members can read `organization_dataset_targets` only for their org
  - only platform-owner/service-role can mutate grants and canonical datasets

### C. Security tables

Enable RLS and default to no direct client access.

Applies to:
- `security_events`
- `security_rate_limits`

Recommended pattern:
- no public `select`, `insert`, `update`, or `delete`
- read/write only through service-role or carefully scoped security-definer RPCs/views

## Priority Order For RLS Hardening

### Priority 1

These give the biggest defense-in-depth improvement with the least product ambiguity:

- `visits`
- `tasks`
- `appointments`
- `activities`
- `territories`
- `property_territories`
- `teams`
- `team_memberships`
- `property_source_records`
- `property_enrichments`

### Priority 2

Shared dataset/control-plane protection:

- `organization_dataset_targets`
- `organization_dataset_access`
- `platform_datasets`
- `platform_dataset_records`
- `organization_features`
- `organization_dataset_entitlements`

### Priority 3

High-sensitivity, likely server-only:

- `security_events`
- `security_rate_limits`
- `properties`

## Recommended Migration Strategy

### Phase 1: Safe org-owned tables

Add RLS + policies for clearly org-owned workflow tables first:

- `teams`
- `team_memberships`
- `territories`
- `property_territories`
- `visits`
- `tasks`
- `appointments`
- `activities`
- `property_source_records`
- `property_enrichments`

This is the safest first migration because the policy model is straightforward.

### Phase 2: Shared dataset tables

Add RLS to:

- `organization_dataset_targets`
- `organization_dataset_access`
- `platform_datasets`
- `platform_dataset_records`
- `organization_features`
- `organization_dataset_entitlements`

This needs careful policy design because platform-owner, source-org, and target-org access differ.

### Phase 3: Security and canonical property tables

Add explicit deny-by-default RLS or server-only posture for:

- `security_events`
- `security_rate_limits`
- `properties`

## Testing Recommendations

Before turning on new RLS in production:

1. create policy tests for:
   - same-org reads succeed
   - cross-org reads fail
   - manager/admin writes succeed where intended
   - rep writes fail on forbidden records
   - platform-owner access to platform tables behaves as intended
2. verify all app flows still work through server APIs
3. explicitly test shared dataset visibility:
   - source org
   - target org with active grant
   - target org after revoked grant

## Practical Conclusion

Right now the app is relying primarily on:

- API auth
- server-side org filters
- service-role access

That is workable, but not sufficient as the final security posture.

The next best implementation step is:

1. add RLS to the clearly org-owned workflow tables
2. add tests
3. then move into shared dataset/control-plane RLS

That gives you the strongest protection improvement without introducing a lot of policy complexity all at once.
