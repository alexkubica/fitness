# Private Health Coach First Slice Design

Date: 2026-06-11

## Summary

Build the first private alpha slice of a personal health coach: native iOS HealthKit sync, backend storage, authenticated MCP access, and Telegram logging. The goal is a real data loop from Apple Health and Telegram into a trusted backend, with ChatGPT able to query the data through MCP from the start.

This is not a public SaaS product. It is a private single-owner system optimized for reliable sync, secure auth, auditability, and useful coaching reports.

## Goals

- Sync Apple Health data through a native iOS app, not manual exports.
- Ingest and normalize weight, steps, active energy, resting/basal energy, sleep, heart rate, resting heart rate, and walking heart rate average.
- Store meals, meal estimates, meal photos, macros, hunger, mood, energy, stress, cravings, coach notes, and audit events.
- Expose an authenticated MCP server over HTTPS-compatible architecture from the first implementation.
- Run a Telegram bot that links to the authenticated account and logs check-ins and meals.
- Keep assistant/MCP/Telegram writes auditable and approval-gated for destructive or Apple Health writeback actions.
- Keep local development and CI on fake or disposable data by default.
- Ensure npm uses the public registry through project `.npmrc`.

## Non-Goals

- Manual Apple Health XML export as the main path.
- Direct Xiaomi API integration in the first slice. Weight should flow through Apple Health if the Xiaomi app writes it there.
- Medical diagnosis, medication advice, eating-disorder treatment, or injury treatment.
- Multi-user public SaaS behavior.
- Production deployment before the auth, backup, and privacy model is reviewed.

## Platform Decisions

### Repository And Tooling

- Use a monorepo with npm workspaces.
- Keep project `.npmrc` pinned to `https://registry.npmjs.org/` because the user-level npm registry points at private CodeArtifact.
- Use TypeScript for backend, MCP, Telegram, domain, and database packages.
- Use SwiftUI and HealthKit for the iOS app.
- Use fake/disposable data in local and CI by default.

### Backend Stack

- `apps/server`: Node 22 TypeScript service.
- First slice keeps API, MCP, auth, and Telegram webhook handling in `apps/server`. Split into `apps/api` and `apps/mcp` only when deployment/runtime constraints justify it.
- HTTP framework: Hono, unless implementation discovers a blocker.
- Auth: Better Auth with OAuth Provider plugin, because its docs describe OAuth 2.1, OIDC compatibility, MCP support, dynamic client registration, JWT/JWKS-verifiable tokens, scopes, and PKCE defaults.
- Database: Neon/Postgres with explicit SQL migrations and `@neondatabase/serverless`.
- Bot library: grammY for Telegram webhook handling.
- MCP: TypeScript MCP SDK/server transport exposed by `apps/server` or a sibling `apps/mcp` process if runtime constraints require separation.

### iOS Stack

- `apps/ios`: SwiftUI app with HealthKit capability.
- First slice requests read-only HealthKit authorization.
- Use anchored queries and observer/background delivery where supported.
- Persist one sync anchor per HealthKit type.
- Upload deltas to backend with idempotency keys.
- Defer HealthKit write/share permissions until nutrition writeback has prepare/confirm/commit UX, audit tests, and explicit user approval.

## Architecture

```text
Apple Watch / Xiaomi scale
        |
        v
Apple Health <-- explicit writeback confirmations
        |
        v
iOS HealthKit app
        |
        v
Backend API + Auth + DB + Audit Log
    |             |              |
    v             v              v
MCP server    Telegram bot    Future web dashboard
    |
    v
ChatGPT / agent clients
```

## Boundaries

- iOS app owns HealthKit permission prompts, HealthKit reads, local sync anchors, and later HealthKit writeback.
- Backend owns normalized data, auth, scopes, audit logs, dedupe, summaries, reports, and write proposals.
- MCP owns agent-facing tools and OAuth resource-server behavior.
- Telegram owns reminders, account-linking UX, text/photo meal logging, and check-ins.
- Domain packages own metric definitions, units, aggregation, trends, and report inputs.

## Data Model

Core entities:

- `User`: private account owner.
- `HealthMetricSample`: sample-level metric data with metric name, value, unit, start/end time, source, source sample ID, timezone, ingestion time, and deletion state.
- `DailyHealthAggregate`: daily rollup for fast reports.
- `HealthSyncCursor`: per-user, per-HealthKit-type cursor/anchor metadata.
- `TelegramAccount`: linked Telegram user ID, username metadata, link status, and revocation timestamp.
- `TelegramLinkToken`: short-lived, single-use link token with nonce/state, expiry, consumed time, and Telegram user ID.
- `Meal`: text/photo meal record with timestamp and origin.
- `MealEstimate`: calories/protein/carbs/fat estimate with confidence and model provenance.
- `MealCorrection`: user-confirmed nutrition correction.
- `CheckIn`: hunger, energy, mood, stress, cravings, notes.
- `CoachMemory`: durable user-specific facts and patterns.
- `Report`: generated daily/weekly report snapshot.
- `WriteProposal`: proposed action requiring approval.
- `AuditEvent`: append-only record for auth-sensitive, assistant, MCP, Telegram, sync, correction, and writeback actions.

## MCP Tools

First slice MCP is read-only:

- `get_health_summary(range)`
- `get_metric_timeseries(metric, range, granularity)`
- `get_coach_context()`
- `generate_report(range, style)`

Deferred until MCP write safety is implemented:

- `log_checkin(hunger, energy, mood, stress, cravings, notes)`
- `log_meal(text, photo_id?, timestamp?)`

Deferred until writeback UX exists:

- `prepare_health_writeback(meal_id)`
- `commit_health_writeback(writeback_id)`

First-slice scopes:

- `health:read`
- `coach:read`
- `report:read`

Deferred scopes:

- `meal:write`
- `checkin:write`
- `writeback:prepare`
- `writeback:commit`

Every MCP request verifies issuer, audience/resource, expiry, user ID, and scopes. First-slice MCP tools must not advertise or request deferred write scopes.

## Telegram Flows

- `/start`: explains private coach commands and account-link requirement.
- `/link`: creates a short-lived signed link to the web/auth flow.
- `/checkin`: records hunger, mood, energy, stress, cravings, and optional notes.
- `/log`: records meal text and optional photo.
- `/report`: returns a short latest summary.
- `/settings`: reminder and privacy controls.
- `/unlink`: removes Telegram account association after confirmation.

Telegram tokens are separate from MCP/ChatGPT connector tokens. Telegram messages are processed server-side under the linked user account and scoped bot identity.

Telegram linking requirements:

- `/link` creates a short-lived single-use token with server-side state and nonce.
- Link completion verifies state, nonce, expiry, single-use status, account ownership, and Telegram user ID.
- Relinking and unlinking revoke prior Telegram bindings.
- Telegram webhooks require `X-Telegram-Bot-Api-Secret-Token` validation.
- Duplicate Telegram updates use idempotency keys.

## HealthKit Mapping

Initial read types:

- Body mass.
- Step count.
- Active energy burned.
- Basal/resting energy burned.
- Sleep analysis.
- Heart rate.
- Resting heart rate.
- Walking heart rate average.

Deferred write types:

- Dietary energy consumed.
- Dietary protein.
- Dietary carbohydrates.
- Dietary fat total.

Writeback is deferred behind `WriteProposal` until explicit confirmation UX and audit trails exist.

## Error Handling

- HealthKit permission denied: sync status shows missing permissions; backend accepts partial data.
- Partial HealthKit permissions: sync available metrics only and records permission state.
- Duplicate sample upload: backend idempotency prevents duplicate stored samples.
- Deleted HealthKit samples: backend marks matching source samples deleted and recomputes aggregates.
- Expired/invalid MCP token: return `401` with OAuth protected resource metadata challenge.
- Wrong scope: return `403` and do not execute tool.
- Unlinked Telegram user: bot replies with `/link`.
- Duplicate Telegram update: idempotency key prevents repeated writes.
- Meal photo processing failure: store meal text and mark photo estimate failed without losing the log.

## Security And Privacy

- No secrets in git, chat, logs, or screenshots.
- Local/CI use fake data by default.
- Real device HealthKit uploads require explicit opt-in with `ALLOW_LIVE_HEALTH_DATA=1`, a disposable/local database target, redacted logs, and documented retention/deletion behavior.
- CI and preview environments must never use live personal health data.
- Production real health data requires encrypted secrets, backups, deletion/export paths, and reviewed privacy copy.
- Logs redact tokens, photos, free-text health notes, and detailed health samples.
- Agent-originated writes, Telegram writes, corrections, and writeback proposals are audited.
- Medical boundary: coach reports can flag trends and suggest conservative wellness actions but must not diagnose disease or prescribe treatment.

## Acceptance Criteria

- Repo has durable task tracking in `docs/TASKS.md`.
- Repo has project `.npmrc` forcing the public npm registry.
- Private GitHub repo exists under `alexkubica/fitness` and local `origin` points to it.
- Spec and plan are committed and pushed.
- Future implementation can start from a clear first-slice plan without re-deciding architecture.
- First implementation slice will be considered complete only when:
  - A fake-data local backend can ingest metric samples.
  - MCP read tools require auth and return fake-data summaries without requesting write scopes.
  - Telegram can link a fake/local user and log a check-in.
  - iOS app can request read-only HealthKit permissions and upload at least one metric type in a dev build only when live-data opt-in is enabled.

## Source Notes

- Apple HealthKit supports app permission requests, HealthKit queries, anchored queries, observer/background delivery, and saving HealthKit samples through native APIs.
- OpenAI Apps SDK auth docs require authenticated MCP servers to implement OAuth 2.1-compatible authorization behavior and verify tokens on each request.
- Better Auth OAuth Provider docs state support for OAuth 2.1, OIDC compatibility, MCP authentication, dynamic client registration, JWT/JWKS tokens, scopes, and PKCE defaults.
- Telegram Bot API is HTTP-based and Telegram Login supports OIDC authorization-code flow with PKCE and server-side ID token validation.
- npm docs state the public registry is `https://registry.npmjs.org/` and registry behavior is controlled by npm config.
