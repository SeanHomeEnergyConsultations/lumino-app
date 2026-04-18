# Lumino New App Build Plan

## Goal
Build a new premium field canvassing CRM app from the ground up while keeping the current Streamlit app alive as a temporary legacy/admin workspace.

The new app should be:
- property-first
- map-first
- visit-driven
- fast in the field
- manager-visible
- clean enough to become the long-term system of record

## Product Principle
The new app is not route-first.

Default workflow:
1. Open live field map
2. Load nearby homes around current location
3. Tap property
4. Log visit outcome
5. Add lead/contact info only when relevant
6. Set follow-up if needed
7. Move to next house

Routes remain optional as a planning overlay, not a prerequisite for logging field work.

## Tech Stack
- Next.js 15+ with App Router
- TypeScript
- Tailwind CSS
- shadcn/ui for primitives
- Mapbox GL JS or MapLibre GL JS
- TanStack Query
- Zustand for UI state
- Supabase Auth + Postgres
- Zod for request validation
- Vercel deployment target

## Repo Strategy
Create a new app in a sibling directory:

```txt
/lumino-web
```

Keep current root Python app intact during transition.

Why:
- avoids blocking on legacy refactors
- gives a clean frontend architecture
- reduces risk while schema evolves
- lets us migrate screen-by-screen

## Folder Structure

```txt
lumino-web/
  app/
    (auth)/
      login/page.tsx
    (app)/
      map/page.tsx
      properties/[propertyId]/page.tsx
      leads/page.tsx
      leads/[leadId]/page.tsx
      tasks/page.tsx
      appointments/page.tsx
      dashboard/page.tsx
      team/page.tsx
      settings/page.tsx
    api/
      map/properties/route.ts
      visits/route.ts
      leads/route.ts
      leads/[leadId]/route.ts
      tasks/route.ts
      tasks/[taskId]/route.ts
      appointments/route.ts
      dashboard/rep/route.ts
      dashboard/manager/route.ts
      search/route.ts
  components/
    app-shell/
      app-shell.tsx
      app-sidebar.tsx
      app-topbar.tsx
    map/
      live-field-map.tsx
      property-marker-layer.tsx
      map-toolbar.tsx
      map-filters-panel.tsx
      property-results-panel.tsx
      property-bottom-tray.tsx
      property-drawer.tsx
      quick-disposition-bar.tsx
    property/
      property-memory-card.tsx
      property-history-timeline.tsx
      property-summary-card.tsx
    lead/
      lead-snapshot-card.tsx
      lead-form.tsx
      lead-stage-badge.tsx
      follow-up-panel.tsx
    tasks/
      task-list.tsx
      task-composer.tsx
    dashboard/
      rep-dashboard.tsx
      manager-dashboard.tsx
      kpi-strip.tsx
      rep-scoreboard.tsx
      follow-up-risk-card.tsx
    shared/
      command-search.tsx
      entity-timeline.tsx
      empty-state.tsx
      loading-state.tsx
  lib/
    auth/
      server.ts
      client.ts
      guards.ts
    db/
      queries/
        map.ts
        properties.ts
        leads.ts
        tasks.ts
        dashboard.ts
      mutations/
        visits.ts
        leads.ts
        tasks.ts
        appointments.ts
      supabase-server.ts
      supabase-browser.ts
    domain/
      map-state.ts
      lead-stage.ts
      visit-outcome.ts
      follow-up-state.ts
      permissions.ts
    validation/
      visits.ts
      leads.ts
      tasks.ts
      appointments.ts
    utils/
      dates.ts
      format.ts
      geo.ts
  types/
    api.ts
    entities.ts
  styles/
    globals.css
```

## App Routes

### `/map`
Primary daily workspace for reps.

Purpose:
- show nearby targets
- show property memory
- log visits
- create/update lead context

Layout:
- top command bar
- left filters/results rail on desktop
- full-height map center
- property drawer on selection
- mobile bottom tray for selected property

### `/properties/[propertyId]`
Full property memory page.

Contains:
- address and current state
- visit history
- latest lead snapshot
- follow-up/task panel
- recent activities

### `/leads`
CRM list view for active pipeline.

Views:
- table
- stage filters
- owner filters
- follow-up filters

### `/leads/[leadId]`
Lead detail page.

Contains:
- lead summary
- property link
- contact details
- timeline
- tasks
- appointment state

### `/tasks`
Rep and manager task queue.

Views:
- mine
- overdue
- due today
- team

### `/appointments`
Appointment calendar/list hybrid.

### `/dashboard`
Role-aware landing page.

- reps land here only if we decide dashboard-first later
- managers land here by default
- reps should probably default to `/map`

### `/team`
Manager scorecards, rep activity, coaching visibility.

### `/settings`
Profile, org settings, team settings, integrations later.

## Component Architecture

### Core Page Composition

#### Map page
```txt
<MapPage>
  <AppShell>
    <TopCommandBar />
    <MapToolbar />
    <MapFiltersPanel />
    <LiveFieldMap />
    <PropertyResultsPanel />
    <PropertyBottomTray />
    <PropertyDrawer />
  </AppShell>
</MapPage>
```

#### Property drawer
```txt
<PropertyDrawer>
  <PropertySummaryCard />
  <PropertyMemoryCard />
  <QuickDispositionBar />
  <LeadSnapshotCard />
  <FollowUpPanel />
  <PropertyHistoryTimeline />
</PropertyDrawer>
```

### Interaction Rules
- selecting a marker opens the drawer
- first tap should not navigate away
- quick outcomes should save in 1-2 taps
- lead/contact form should expand inline only when relevant
- map should remain visible while the drawer is open

## Core UX Decisions

### Rep workflow
1. Open `/map`
2. Auto-center near current location
3. Load nearby target properties
4. Tap a property
5. Use quick disposition:
   - No Answer
   - Interested
   - Callback
   - Not Interested
   - Do Not Knock
6. If positive intent, expand inline lead form:
   - homeowner name
   - phone
   - email
   - follow-up time
   - note
7. Save and continue walking

### Manager workflow
1. Open `/dashboard`
2. See active reps, knocks, leads, follow-up leakage
3. Open map overlay by rep or territory
4. Inspect neighborhoods and recent canvassing density
5. Open team scorecards and coaching flags

### Routes
- routes remain optional
- use them for planning, not daily gating
- route assignments should eventually become a filter/layer within the map experience

## API Contracts

### `GET /api/map/properties`
Purpose: fetch map-ready properties for viewport and filters.

Query params:
- `minLat`
- `maxLat`
- `minLng`
- `maxLng`
- `repId`
- `territoryId`
- `mapState`
- `followUpState`
- `limit`

Response:
```json
{
  "items": [
    {
      "propertyId": "uuid",
      "address": "25 Adams Street, Westborough, MA, USA",
      "lat": 42.0,
      "lng": -71.0,
      "mapState": "imported_target",
      "followUpState": "none",
      "visitCount": 1,
      "lastVisitOutcome": "no_answer",
      "leadId": "uuid",
      "leadStatus": "New",
      "appointmentAt": null
    }
  ]
}
```

### `POST /api/visits`
Purpose: canonical field-visit write path.

Request:
```json
{
  "propertyId": "uuid",
  "outcome": "no_answer",
  "notes": "Dog barking, no answer",
  "interestLevel": null,
  "lat": 42.27,
  "lng": -71.61,
  "capturedAt": "2026-04-18T12:00:00Z"
}
```

Response:
```json
{
  "visitId": "uuid",
  "propertyId": "uuid",
  "mapState": "canvassed_with_lead",
  "followUpState": "none"
}
```

### `POST /api/leads`
Purpose: create or attach a real lead to a property after engagement.

Request:
```json
{
  "propertyId": "uuid",
  "firstName": "Jane",
  "lastName": "Doe",
  "phone": "555-111-2222",
  "email": "jane@example.com",
  "notes": "Asked for callback after 6pm",
  "interestLevel": "high",
  "nextFollowUpAt": "2026-04-18T22:00:00Z"
}
```

### `PATCH /api/leads/[leadId]`
Purpose: update lead stage, owner, notes, contact details.

### `POST /api/tasks`
Purpose: create follow-up tasks tied to a lead or property.

### `GET /api/dashboard/rep`
Purpose: rep KPIs for today and this week.

### `GET /api/dashboard/manager`
Purpose: team KPIs, follow-up risk, rep scoreboard, territory yield.

### `GET /api/search`
Purpose: unified search by address, phone, email, rep, note text.

## Data Access Layer
Use typed query functions, not direct component-level Supabase calls.

Examples:
- `getMapPropertiesForViewport(filters)`
- `getPropertyDetail(propertyId)`
- `getPropertyTimeline(propertyId)`
- `createVisit(input)`
- `createLeadFromProperty(input)`
- `getManagerDashboardSummary()`

This keeps the product logic centralized and testable.

## Permissions Model

### Roles
- owner
- admin
- manager
- rep
- setter
- viewer

### Access rules
- reps can read properties/leads relevant to their org scope and write visits they create
- managers can read team-wide dashboards and activity
- admins/owners can manage settings, territories, assignments

## Sprint Plan

### Sprint 1: App Foundation + Live Map Skeleton
Goal: get the new app running with auth and a real map shell.

Build:
- scaffold `lumino-web`
- auth/session integration with Supabase
- app shell and navigation
- `/map` page skeleton
- map component with current location
- `GET /api/map/properties`
- fetch and render markers from `map_properties_view`
- property selection state
- basic property bottom tray

Definition of done:
- sign in
- open map
- load nearby target properties
- tap a marker and see property summary

### Sprint 2: Property Drawer + Visit Logging
Goal: make the field workflow real.

Build:
- property drawer
- property memory card
- quick disposition bar
- `POST /api/visits`
- visit logging mutation with optimistic UI
- refresh selected property state after save
- property history timeline from `activities` and `visits`
- map marker state updates after visit save

Definition of done:
- rep can tap a property
- log `No Answer`, `Interested`, `Callback`, `Not Interested`, `Do Not Knock`
- see visit count/history update
- map state changes immediately

### Sprint 3: Lead Capture + Follow-Up
Goal: turn field interactions into accountable CRM work.

Build:
- inline lead creation form in property drawer
- `POST /api/leads`
- task creation flow
- follow-up state badges
- `/leads` list page
- `/leads/[leadId]` detail page
- rep mini dashboard widgets on map page

Definition of done:
- positive field interaction can become a real lead
- follow-up can be assigned immediately
- lead detail page exists
- reps can work map + CRM in one flow

## Implementation Order
Do this in order:
1. new app scaffold
2. map shell
3. property selection
4. visit logging
5. lead creation
6. follow-up/task flow
7. manager dashboard
8. route overlays later

## Strong Recommendations
- Do not port the Streamlit structure screen-for-screen.
- Do not make route draft loading the default rep entry.
- Do not expose every CRM field in the field UI.
- Do not let “lead” remain the only anchor object.
- Keep property memory visible above everything else.

## First Build Decision
The first production-quality flow should be:

`current location -> nearby homes -> property tap -> quick visit outcome -> optional lead info -> follow-up`

If that flow feels great, the rest of the product gets much easier.
