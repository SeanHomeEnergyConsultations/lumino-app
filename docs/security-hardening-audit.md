# Security Hardening Audit

## Completed In This Pass

- Added write-path rate limits for:
  - team member invites
  - team access emails
  - platform organization creation
  - platform organization plan/status changes
  - platform dataset grant changes
  - lead upserts
  - task creation
  - appointment status updates
  - visit logging
- Added security-event audit logging for:
  - platform organization creation
  - lead upserts
  - task creation
  - appointment status updates
  - visit logging
- Tightened team-role permission boundaries:
  - non-admin managers can only invite `rep` and `setter`
  - non-admin managers can only update or send access emails for `rep` and `setter`
- Removed trust in request-origin headers for invite/reset redirects:
  - team invite and access-email flows now fall back to organization branding/app URL
- Tightened shared-dataset grant validation:
  - assigned teams must belong to the target organization
  - assigned users must be active members of the target organization
  - inactive target organizations cannot receive active dataset grants
  - source organizations no longer need or retain self-grants for their own datasets
- Prevented source-org datasets from appearing as duplicated shared grants in `/imports`

## Remaining High-Priority Work

### API Hardening

- Review remaining mutation routes for explicit rate limits and security-event coverage:
  - `organization/branding`
  - `territories`
  - `territories/[territoryId]`
  - `territories/[territoryId]/properties`
  - `team/cleanup`
  - `platform/organizations/[organizationId]/features`
  - `platform/organizations/[organizationId]/dataset-entitlements`
- Review read routes for sensitive overexposure:
  - `search`
  - `reporting/daily-summary`
  - `queue/rep`
  - `dashboard/manager`

### Destructive Audit Coverage

- Add explicit pre/post audit events for destructive mutations:
  - import batch deletion
  - territory deletion
  - team member account deletion
  - dataset grant revocation
  - dataset entitlement replacement
- Include before/after metadata for plan changes, feature changes, and entitlement changes.

### Anomaly Detection / Alerting

- Add elevated severity events for:
  - repeated forbidden access attempts
  - repeated invalid dataset-assignment attempts
  - repeated invite/reset attempts to the same email
  - frequent plan/grant churn on the same organization
- Add alert routing for high-severity `security_events`:
  - email
  - Slack/webhook
  - daily anomaly digest

### Secret / Config Audit

- Confirm production environment variables exist and are rotated where needed:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `RESEND_API_KEY`
  - `SEND_EMAIL_HOOK_SECRET`
  - `RESEND_FROM_EMAIL`
  - `APP_URL` / `NEXT_PUBLIC_APP_URL`
- Confirm Vercel production, preview, and local env scopes are correct.
- Confirm Supabase Edge Function secrets match production values.

### Abuse Prevention

- Add duplicate-email cooldown logic for team invites and password resets.
- Add repeated upload-failure anomaly tracking.
- Review search/property resolve endpoints for enumeration resistance.
- Review large import and analysis flows for background-job abuse ceilings.

### Database / RLS Audit

- Review every table currently accessed with the service-role server client.
- Confirm whether direct client access is possible anywhere outside intended APIs.
- Audit Supabase RLS policies for:
  - `organizations`
  - `organization_members`
  - `app_users`
  - `leads`
  - `visits`
  - `tasks`
  - `appointments`
  - `properties`
  - `property_source_records`
  - `platform_datasets`
  - `platform_dataset_records`
  - `organization_dataset_access`
  - `organization_dataset_targets`
  - `security_events`
- Add policy tests for cross-org isolation and platform-owner exceptions.

## Recommended Next Pass

1. Add before/after audit metadata to destructive platform and import actions.
2. Harden the remaining territory and branding mutation routes with rate limits and audit logs.
3. Audit Supabase RLS policies table-by-table and capture the results in migration-backed tests.
4. Add alert delivery for high-severity `security_events`.
