# Fitness Coach

A private-by-design personal fitness system with a native iOS and watch app,
Apple Health ingestion, a Node API, an authenticated MCP connector, a web
dashboard, and optional Telegram and AI coaching surfaces.

## Repository layout

- `apps/ios`: SwiftUI, HealthKit, watch, widget, and Live Activity clients
- `apps/server`: API, OAuth, MCP, Telegram, and service orchestration
- `apps/web`: authenticated Next.js dashboard
- `packages/auth`, `packages/db`, `packages/domain`: shared core packages

## Local setup

1. Install Node.js 22 and run `npm ci`.
2. Copy `.env.example` to `.env.local` and replace only the values needed for
   the surface you are running.
3. Use fake or disposable data unless live health-data access is explicitly
   enabled and protected.
4. Run `npm run verify` before publishing changes.

The repository contains application code and synthetic tests, not exported
Apple Health data or production database contents. See `docs/PUBLICATION.md`
and `docs/SECURITY_THREAT_MODEL.md` before making a copy public.

No open-source license has been selected; normal copyright restrictions apply.
