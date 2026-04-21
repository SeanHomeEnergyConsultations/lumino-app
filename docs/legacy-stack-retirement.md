# Legacy Stack Retirement

## Scope

These legacy paths are not the primary supported Lumino production app:

- `app.py`
- `engine/*`
- `solar-route-optimizer/*`

## Current protection

- `app.py` now refuses production-style execution unless `ALLOW_LEGACY_STACK=1`
- `solar-route-optimizer/server.js` now refuses production-style execution unless `ALLOW_LEGACY_STACK=1`
- The legacy optimizer README is marked deprecated and points operators to `lumino-web`

## Why this matters

The legacy stack predates the newer hardening in `lumino-web`, including:

- stronger API-layer rate limiting and anomaly logging
- encrypted Google OAuth token storage
- newer browser security headers
- more consistent auth/session handling

## Remaining retirement work

- Confirm no production platform still runs `app.py`
- Confirm no production platform still runs `solar-route-optimizer`
- Review any automation, cron job, or worker entry point that imports `engine/*`
- Remove or archive legacy code once no production dependency remains

## Temporary override

If the legacy stack must be run briefly for migration or recovery work, set:

```bash
ALLOW_LEGACY_STACK=1
```

This should be treated as a short-lived operator override, not a normal deployment mode.
