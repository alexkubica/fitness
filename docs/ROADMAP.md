# Roadmap

## Product Goal

Build a private health coach that combines passive Apple Health sync with active Telegram check-ins and MCP-powered reports inside ChatGPT.

## Milestones

### M0: Foundation

- Decide stack and repo structure.
- Add formatting, linting, typecheck, tests, and build scripts.
- Add auth architecture and threat model.
- Define normalized data model and audit model.
- Separate authentication users from health profiles, including managed profiles and access relationships.

### M1: Health Sync Slice

- iOS app requests HealthKit permissions.
- Sync weight, steps, active energy, resting/basal energy, sleep, heart rate, resting heart rate, and walking heart rate average.
- Backend stores idempotent metric samples/aggregates with provenance and sync cursors.
- Basic report endpoint verifies the data path.

### M2: MCP From Day One

- Authenticated MCP server exposes read-only summary/timeseries/report tools and scoped, auditable meal-log write tools.
- OAuth/OIDC scopes protect tool access.
- Tests cover unauthenticated, expired-token, wrong-user, wrong-scope, and happy paths.

### M3: Telegram Coach

- Telegram `/link` flow connects a Telegram user to the authenticated account.
- Bot logs meals by text/photo and check-ins for hunger, mood, energy, stress, and cravings.
- Bot sends configurable reminders and daily summaries.
- Optional smart chat replies run only after linked-account auth, with minimized model context and deterministic fallback commands.

### M4: Coach Memory And Reports

- Generate daily/weekly trend reports.
- Track durable coach memory for patterns, goals, and user preferences.
- Persist coach profile, nutrition targets, meal slots, direct meal logs, and rollback snapshots so iOS, web, and MCP clients share the same coaching context.
- Keep measured values, estimates, and recommendations separate.

### M5: Approval-Gated Writeback

- Create prepare/confirm/commit flow for writing nutrition/macros back to Apple Health.
- Add audit logs, rollback/reconciliation notes, and explicit user confirmation UX.

## Non-Goals For The First Slice

- Manual Apple Health XML export as a primary workflow.
- Direct Xiaomi API integration unless Apple Health ingestion cannot capture scale data.
- Medical diagnosis, medication advice, or clinical treatment planning.
- Multi-user coaching marketplace or public SaaS features.
