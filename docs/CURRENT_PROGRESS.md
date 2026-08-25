# Current Progress

Last updated: 2026-08-24

## Current state

- The repository is an npm workspace with shared auth, database, and domain
  packages; a Hono server; a Next.js web dashboard; and native iOS, watchOS,
  widget, and Live Activity targets.
- HealthKit ingestion stores normalized daily aggregates rather than retaining
  unlimited raw high-frequency samples.
- Production API, MCP, web, and native sessions use scoped signed tokens and
  Google-gated account linking. Fake tokens are restricted to test/development
  modes and are rejected for hosted database configurations.
- Meal logging, planned-versus-actual nutrition, targets, check-ins, reports,
  profiles, and audit events persist through the shared service boundaries.
- Raw meal photos remain on-device. AI estimation sends bounded, explicit
  requests to a server-side provider and does not expose the provider key.
- Apple Health writeback remains an explicit, confirmed, on-device action;
  web, MCP, and Telegram cannot directly commit to HealthKit.

## Public-release hardening

- The committed environment example now uses generic identities and URLs.
- Personal workstation paths and exact allowlisted emails were removed from the
  current tree.
- Real health data, database contents, provider credentials, local Vercel state,
  and Apple Health exports remain ignored and untracked.
- `README.md`, `SECURITY.md`, and `docs/PUBLICATION.md` describe the public/private
  boundary and release checks.

The existing Git history predates this cleanup and may retain private operational
notes. Do not change visibility until the history strategy in
`docs/PUBLICATION.md` is complete.

## Next engineering work

1. Complete a fresh end-to-end hosted web Google sign-in check.
2. Verify corrected HealthKit daily-statistics sync on a physical device using
   private data outside Git.
3. Continue splitting large native UI modules to keep builds and reviews fast.
4. Add explicit retention, export, and deletion UX for every persisted health
   and coaching record type.
5. Finish publication scans and select a license if reuse should be allowed.
