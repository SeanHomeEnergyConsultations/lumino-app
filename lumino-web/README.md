# Lumino Web

New Next.js app for the map-first field canvassing CRM.

## 1. Install dependencies

```bash
cd lumino-web
npm install
```

## 2. Add environment variables

Copy `.env.example` to `.env.local` and fill in:

```bash
cp .env.example .env.local
```

Required:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## 3. Run the app

```bash
npm run dev
```

Then open:

[http://localhost:3000](http://localhost:3000)

## Current Sprint 1 scope
- app shell
- `/map`
- `GET /api/map/properties`
- `POST /api/visits`
- property selection
- quick outcome logging skeleton

## Important note

The current visit mutation uses hardcoded fallback org/user IDs for initial scaffolding. Replace that with real authenticated session context before production use.
