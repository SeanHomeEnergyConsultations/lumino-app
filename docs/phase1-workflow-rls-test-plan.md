# Phase 1 Workflow RLS Test Plan

Use this after running [20260420_phase1_workflow_rls.sql](/Users/Work/Library/CloudStorage/OneDrive-Personal/Lumino%20-%20App/supabase/migrations/20260420_phase1_workflow_rls.sql).

## Goal

Validate that the first RLS hardening pass enforces:

- same-org access works
- cross-org access fails
- manager/admin writes still work where intended
- rep-scoped task and visit behavior still works

## Test Setup

Create two organizations:

- Org A
- Org B

Create at least these users:

- Org A owner/admin
- Org A manager
- Org A rep
- Org B manager

Seed at least one row in each table for Org A and Org B:

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

## Manual Verification Cases

### 1. Same-org reads succeed

For an Org A authenticated user, confirm read access to Org A rows succeeds for:

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

### 2. Cross-org reads fail

For the same Org A authenticated user, confirm reading Org B rows returns no rows for:

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

### 3. Manager/admin writes succeed

As Org A manager or admin, verify create/update/delete behavior works for:

- `teams`
- `team_memberships`
- `territories`
- `property_territories`
- `property_source_records`
- `property_enrichments`

Also verify:

- updating `visits` works for manager/admin
- deleting `activities` works for manager/admin

### 4. Rep writes are constrained

As Org A rep:

- creating a `visit` with:
  - `organization_id = Org A`
  - `user_id = current_app_user_id()`
  should succeed
- creating a `visit` for Org B should fail
- creating a `task` assigned to self should succeed
- creating a `task` assigned to another user should fail unless elevated role is used
- updating a task assigned to self should succeed
- updating a task in another org should fail

### 5. Appointment behavior

As an Org A authenticated member:

- read Org A appointments should succeed
- read Org B appointments should fail
- create/update Org A appointments should succeed
- create/update Org B appointments should fail

## Application Smoke Tests

After the migration, verify in the app:

1. `/team` still loads
2. `/territories` list, create, edit, and property assignment still work
3. `/map` visit logging still works
4. `/tasks` still loads and task creation still works
5. `/appointments` still loads and status updates still work
6. property detail still shows source records and enrichments

## Known Follow-Up Areas

This phase does **not** yet cover:

- `platform_datasets`
- `platform_dataset_records`
- `organization_dataset_access`
- `organization_dataset_targets`
- `organization_features`
- `organization_dataset_entitlements`
- `security_events`
- `security_rate_limits`
- `properties`

Those need a separate follow-up migration because their access model is more complex or intentionally server-only.
