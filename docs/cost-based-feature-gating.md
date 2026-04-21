# Cost-Based Feature Gating

## Goal

Keep core canvassing and CRM workflows cheap by default, and make Google-costly enrichment features pay for themselves through higher tiers.

## Core principle

- Uploading a list should never require premium analysis.
- Current Lumino route building should stay broadly available because it uses local distance math.
- Google-costly enrichment should be explicit and tier-gated.

## Tier model

### Free / Starter

- Map
- Queue
- Leads
- Appointments
- Visit logging
- Current route builder
- CSV upload / import
- No premium import enrichment
- No bulk solar enrichment
- No cluster analysis
- No premium routing insights

### Pro

- Everything in Starter
- Tasks
- Team
- Territories
- Solar-related access already represented by `solarCheckEnabled`
- Still no premium import enrichment by default
- Still no bulk solar enrichment
- Still no cluster analysis

### Intelligence

- Everything in Pro
- Premium import enrichment
- Bulk solar enrichment
- Cluster analysis
- Premium routing insights
- Priority scoring
- Territory planning
- Marketplace / dataset intelligence

## Expensive API call sites

### Low-risk / keep broadly available

- `lumino-web/lib/db/mutations/routes.ts`
  - Uses local haversine ordering, not Google Routes API

### Premium-cost / gated

- `lumino-web/lib/imports/analysis.ts`
  - Geocoding + Google Solar `buildingInsights:findClosest`
- `lumino-web/lib/db/mutations/imports.ts`
  - Batch enrichment entry point through `runImportBatchAnalysis`
- `lumino-web/app/api/imports/[batchId]/analysis/route.ts`
  - API entry point for premium enrichment

### Legacy cost centers to review separately

- `engine/processing.py`
  - Main property solar + neighbor/walkability analysis
- `engine/clustering.py`
  - Places Nearby + multiple Routes API walking checks + neighbor solar calls
- `solar-route-optimizer/public/index.html`
  - Google Solar calls and traffic-aware Routes summary

## Current enforcement

- Feature flags are defined in `lumino-web/lib/platform/features.ts`
- Auth/app context carries effective features through `featureAccess`
- Premium import enrichment is blocked server-side in:
  - `lumino-web/app/api/imports/[batchId]/analysis/route.ts`
  - `lumino-web/lib/db/mutations/imports.ts`
- Upload-first UX is implemented in:
  - `lumino-web/components/imports/imports-page.tsx`
  - `lumino-web/components/imports/import-batch-detail-page.tsx`

## Follow-up work

- Review whether legacy `engine/*` and `solar-route-optimizer` are still live anywhere
- If they are live, either:
  - retire them
  - feature-gate them
  - or replace their Google-costly calls with cheaper local approximations
