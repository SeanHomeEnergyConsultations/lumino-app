# Production Secret / Config Audit

## Goal

This checklist is the source of truth for the minimum production configuration needed to run Lumino safely across:
- Vercel application runtime
- Supabase project runtime
- Supabase Edge Functions
- Resend email delivery

It is intentionally operational, not theoretical. The goal is to make it easy to verify what must exist, where it should live, and what should be rotated.

## Required Production Secrets

### Vercel application runtime

These should exist in the Vercel project for the production environment:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_MAPS_API_KEY` if map tiles or geocoding rely on it
- `NEXT_PUBLIC_APP_URL`
- `APP_URL` if server-only helpers use a canonical app URL
- `SECURITY_ALERT_WEBHOOK_URL` for high-severity security alert delivery

### Supabase Edge Functions

These should exist in Supabase secrets for deployed functions that need them:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `SEND_EMAIL_HOOK_SECRET`
- `APP_NAME`
- `APP_URL`
- `SUPPORT_EMAIL`

Supabase-managed runtime values such as project URL or reserved internal values should not be duplicated under forbidden names unless the function explicitly requires a custom alias.

## Scope Expectations

### Vercel

- Production secrets should exist in the production scope
- Preview secrets should be reviewed separately so preview builds do not accidentally inherit production-only integrations
- Local `.env` usage should not be treated as proof that production is configured correctly

### Supabase

- Edge Function secrets must match the active production environment
- Hook secrets such as `SEND_EMAIL_HOOK_SECRET` must match the value configured in the Supabase Auth hook UI
- Service-role credentials should never be exposed via `NEXT_PUBLIC_*`

## Rotation Expectations

- `SUPABASE_SERVICE_ROLE_KEY`
  - rotate after suspected exposure, contractor offboarding, or major auth changes
- `RESEND_API_KEY`
  - rotate after suspected exposure or mailbox/domain configuration changes
- `SEND_EMAIL_HOOK_SECRET`
  - rotate if hook requests fail signature validation unexpectedly or after admin-access churn
- `SECURITY_ALERT_WEBHOOK_URL`
  - revalidate whenever the receiving alert destination changes

## Verification Checklist

### App runtime

- Confirm Vercel production has all required env vars populated
- Confirm `NEXT_PUBLIC_APP_URL` or `APP_URL` points to the production app origin
- Confirm preview deployments do not point at production-only alerting or send-email integrations unless intended

### Auth email runtime

- Confirm Supabase Send Email Hook is either:
  - intentionally enabled and using the correct function URL and hook secret
  - or intentionally disabled while falling back to default Supabase mail behavior
- Confirm Resend sender identity is appropriate for the current environment

### Alerting runtime

- Confirm `SECURITY_ALERT_WEBHOOK_URL` is set in production
- Confirm the destination accepts JSON `POST` requests
- Confirm at least one high-severity event reaches the destination during a controlled test

## Current Code Expectations

The application currently has code-level references for:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_MAPS_API_KEY`
- `SECURITY_ALERT_WEBHOOK_URL`

The auth email function currently expects:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `SEND_EMAIL_HOOK_SECRET`
- `APP_NAME`
- `APP_URL`
- `SUPPORT_EMAIL`

## Open Operational Follow-Ups

- Verify the final production sender domain for branded auth emails once a real domain is chosen
- Verify Vercel preview env scoping so temporary preview deployments do not send production security alerts unless intended
- Add a recurring quarterly secret review once operational processes settle
