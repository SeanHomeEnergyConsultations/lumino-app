# Phase 2 Security Audit

## Completed in live app

- Encrypted Google Calendar OAuth tokens at rest with `APP_ENCRYPTION_KEY`
- Added baseline browser hardening headers in `lumino-web/middleware.ts`
- Added security events and rate-limit storage tables
- Added rate limiting and anomaly escalation on:
  - team invites / access emails
  - search
  - property resolve
  - imports
  - login
  - password reset
- Added stricter abuse control for committed property creation from the map

## Highest-priority follow-ups

- Audit every sensitive API route for:
  - auth requirement
  - role checks
  - organization scoping
  - abuse limits
  - security event logging
- Review remaining shared-data tables for Phase 2 RLS hardening
- Audit or retire legacy `engine/*` paths so they cannot bypass newer live-app protections
- Rotate any secrets that were ever pasted into chat or exposed outside secret managers
- Validate production operations:
  - `APP_ENCRYPTION_KEY` present
  - alert webhook working
  - backup / restore plan confirmed
  - periodic secret review in place

## Known strategic risk

The current `lumino-web` app is substantially more hardened than older scripts and legacy ingestion or analysis paths. If any `engine/*` workflow is still active in production, it should be treated as a separate security review scope.
