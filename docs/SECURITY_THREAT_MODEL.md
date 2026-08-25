# Security And Privacy Threat Model

Last updated: 2026-06-21

## Scope

This document covers the private health coach first slice:

- iOS HealthKit client for Apple Health reads.
- Hono server for health ingestion, MCP, Telegram webhooks, audit logs, and persistence.
- Neon/Postgres database.
- Telegram bot coach surface.
- MCP read tools for ChatGPT/agents.

Medical diagnosis, public SaaS use, multi-user administration, analytics, crash reporting, and Apple Health writeback are out of scope for the current implementation.

## Data Classes

| Class                | Examples                                                          | Sensitivity | Current handling                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health metrics       | weight, steps, active/resting energy, sleep, heart-rate metrics   | High        | Validated at API boundary; stored only when persistence is explicitly set to Neon.                                                                             |
| Telegram identity    | Telegram user ID, chat ID, link status                            | High        | Stored only after authenticated link flow; link tokens are hashed in Neon.                                                                                     |
| Check-ins            | hunger, mood, energy, stress, cravings, notes                     | High        | Stored in memory by default; stored in Neon only with `FITNESS_PERSISTENCE=neon`.                                                                              |
| Meal logs            | text meal descriptions, local photos, macro estimates             | High        | Native app stores local meal entries/photos; server-side estimation validates bounded text/photos and avoids raw meal content in audit metadata.               |
| Auth/session claims  | OAuth/JWT claims, scopes, token IDs                               | High        | Validated in middleware; fake tokens are test/dev-only and refused with non-local Neon persistence; signed JWT verification is available through trusted JWKS. |
| Audit events         | actor, action, target, metadata                                   | Medium/High | In-memory first slice; write actions are audited; secrets and raw meal text are avoided in audit metadata.                                                     |
| Coach memory/reports | preferences, patterns, goals, summaries                           | High        | Deterministic reports are available; optional Telegram LLM replies may send minimized prompt context to OpenRouter only when explicitly enabled.               |
| Secrets              | Telegram bot token, webhook secret, database URL, signing secrets | Critical    | Environment-only; must not be printed, logged, pasted, or committed.                                                                                           |

## Actors

- Owner: the only intended user.
- iOS app: requests HealthKit read permission and uploads normalized samples.
- Server: validates auth, writes/reads normalized data, and handles Telegram/MCP routes.
- Telegram: delivers bot updates and receives bot replies.
- ChatGPT/MCP client: reads approved backend data through scoped MCP tools.
- Neon/Postgres: stores normalized data when explicitly enabled.
- Coding agents: can edit code/docs and run local checks, but must not handle live personal data without explicit opt-in.

## Trust Boundaries

| Boundary                   | Risk                                                                 | Required controls                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| HealthKit to iOS app       | Overbroad permissions or unintended writeback                        | Read-only first slice; no `NSHealthUpdateUsageDescription`; writeback requires explicit future flow.                                             |
| iOS app to API             | Wrong user, replayed batches, malformed samples                      | Scoped auth, user ID match, strict metric/unit/timestamp validation, idempotency keys.                                                           |
| API to Neon                | Live data written with fake auth or wrong database                   | `FITNESS_PERSISTENCE=neon` explicit; fake auth refused for non-local `DATABASE_URL`; no committed DB URLs.                                       |
| Telegram to webhook        | Spoofed webhook, duplicate updates, account takeover                 | Webhook secret, durable update idempotency, hashed short-lived link tokens, account mismatch checks.                                             |
| MCP client to server       | Unauthorized health reads or confused deputy access                  | OAuth protected-resource metadata, read scopes, issuer/audience/resource validation, read-only tools.                                            |
| Server to OpenRouter       | Sensitive check-in, meal text, or meal photo context sent to a model | Telegram LLM disabled by default; meal estimation is explicit user action; server-side API key; minimized prompt context; no raw HealthKit rows. |
| Server to logs/audit       | Sensitive data leakage                                               | Do not log tokens/secrets; audit metadata avoids raw token and raw meal text.                                                                    |
| Agents/development to data | Accidental live-data exposure                                        | Fake/disposable data by default; live data requires documented opt-in and protected credentials.                                                 |

## Key Threats And Controls

### Unauthorized Reads

- MCP requires `health:read` scope and validates issuer, audience, resource, expiration, revocation, and subject.
- MCP tools derive `userId` from authenticated context, not tool arguments.
- Telegram commands requiring account context reject unlinked users.

### Unauthorized Writes

- Health sample ingestion requires `health:write` or `health:sync`.
- The request body `userId` must match the authenticated subject.
- Telegram account linking requires possession of token, state, and nonce.
- Apple Health nutrition/macros writeback is not implemented and remains approval-gated.

### Replay And Duplicate Processing

- Health sync batches are persisted in `health_sync_batches` by `(user_id, idempotency_key)`.
- Health samples dedupe on `(user_id, source, source_sample_id, metric_name)`.
- Telegram updates are claimed in `telegram_processed_updates` before command processing.
- Meal and check-in writes use idempotency keys derived from Telegram update IDs.

### Token And Secret Exposure

- Telegram link tokens are stored as hashes in Neon.
- Bot link responses avoid echoing secrets beyond required command input behavior.
- Audit metadata must not include raw tokens, database URLs, bot tokens, or meal text.
- `.npmrc` pins public npm registry to avoid private CodeArtifact leakage.

### Third-Party Model Calls

- Telegram smart coach is disabled unless `TELEGRAM_COACH_LLM_ENABLED=1`.
- Native meal estimation is an explicit user action from the iOS app and requires a scoped `meal:write` backend token.
- OpenRouter calls require a server-side `OPENROUTER_API_KEY`; Telegram, Google, MCP, and ChatGPT connector tokens are never reused for model access.
- Model calls happen only after Telegram webhook validation, private-chat enforcement, and linked-account lookup.
- Telegram prompt context is limited to the current Telegram message and compact deterministic report text. Meal-estimation prompt context is limited to bounded meal description, optional meal note, meal type, and at most six validated image payloads.
- Raw HealthKit rows, OAuth tokens, link tokens, database URLs, and secrets must not be sent.
- Audit events record provider/model and estimate metadata only, not prompts, meal text, photos, or model replies.

### Live Data Accidents

- Default server persistence is in-memory.
- Neon persistence requires `FITNESS_PERSISTENCE=neon`.
- iOS live upload requires `ALLOW_LIVE_HEALTH_DATA=1`; hosted backend uploads additionally require `ALLOW_HOSTED_HEALTH_BACKEND=1` and a bearer token.
- Fake auth tokens are refused when Neon persistence points at a non-local database.

## Third-Party Processors

| Processor              | Current use                                              | Notes                                                                                                                                   |
| ---------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Apple Health/HealthKit | Local iOS health data source                             | HealthKit permission copy must remain clear and read-only for now.                                                                      |
| Telegram               | Bot updates and replies                                  | Bot token and webhook secret must stay environment-only.                                                                                |
| Neon                   | Postgres persistence when explicitly enabled             | Use scoped credentials and backups before live data.                                                                                    |
| OpenRouter             | Optional Telegram smart coach and native meal estimation | Use server-side key, separate Telegram and meal model settings, explicit meal-estimate action, bounded payloads, and minimized prompts. |
| OpenAI/ChatGPT         | MCP client/user reports when invoked                     | MCP is read-only first slice; do not send data to models silently.                                                                      |
| GitHub                 | Private source repository                                | No secrets or live health data in code, tests, issues, logs, or docs.                                                                   |

No analytics, crash reporting, ad pixels, or product telemetry are approved.

## Retention, Export, And Deletion

Current status:

- Schema includes `deleted_at` on users and health samples where needed, but deletion/export endpoints are not implemented.
- No retention policy is automated yet.
- Live data must not be used beyond deliberate private alpha testing until deletion/export paths exist.

Required before live production use:

- Data export for health samples, meals, check-ins, reports, and coach memory.
- Account deletion or purge workflow with audit trail.
- Backup and restore procedure for Neon.
- Retention rules for Telegram updates, link tokens, audit events, and future meal photos.

## Pre-Live Checklist

- Run `DATABASE_URL=... npm run verify:database -w @fitness/db` against a disposable database.
- Confirm `FITNESS_PERSISTENCE=neon` only after database target is known and disposable/live intent is documented.
- Confirm fake auth is disabled for any non-local database.
- Configure real OAuth/OIDC provider for long-term login. For private alpha HealthKit sync, use short-lived signed JWTs; do not use fake tokens for live personal data.
- Keep real Telegram bot token and webhook secret in environment variables only.
- Complete Apple Developer signing and real-device HealthKit permission testing.
- Add backup/restore notes before live migrations.
- Add deletion/export workflow before long-term storage.

## Open Risks

- Full production OAuth/OIDC authorization-code provider is not wired yet.
- Data export/deletion workflows are not implemented yet.
- Real-device HealthKit sync is not verified yet with Apple Developer signing and a short-lived private-alpha API token.
- No legal/privacy policy text exists for a deployed app.
- Meal photo ingestion and model-based macro estimates need separate privacy review before implementation.
