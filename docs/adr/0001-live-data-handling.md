# ADR 0001: Live Health Data Handling

Date: 2026-06-11

## Status

Accepted for the private alpha.

## Context

This project will handle highly sensitive personal health, weight, sleep, heart-rate, meal, and behavioral check-in data. The user explicitly rejected manual Apple Health export as the core workflow and requested SDK/API sync, MCP from the start, Telegram bot access, authentication, and secure authorization.

The codebase currently supports fake/disposable local flows, explicit Neon persistence, a read-only HealthKit proof of life, authenticated MCP reads, and Telegram linking/logging foundations.

## Decision

Real personal health data is opt-in only. It must not be collected, synced, persisted, pasted into logs, or committed by default.

Live data requires all of the following:

- A deliberate note in `docs/CURRENT_PROGRESS.md` or a task handoff naming the live-data target and reason.
- `FITNESS_PERSISTENCE=neon` only with a known intended database target.
- `DATABASE_URL` supplied by environment, never committed.
- `ALLOW_FAKE_AUTH_TOKENS` disabled for any non-local database.
- `DATABASE_URL=... npm run verify:database -w @fitness/db` run successfully against the target or a documented disposable predecessor.
- Apple Health sync tested on a signed real device before relying on HealthKit background behavior.
- Telegram bot token and webhook secret supplied by environment.
- Optional third-party model calls explicitly enabled by a named provider flag
  and server-side provider API key; prompts must be minimized and audited by
  metadata only.
- No Apple Health writeback unless an explicit prepare/confirm/commit flow exists.

## Consequences

- Development and CI remain fake/disposable by default.
- Agents may build schema, repositories, tests, docs, and local simulations without live personal data.
- Any step that would expose real health data to a model, log, issue, screenshot, test fixture, or repository requires explicit opt-in.
- Production deployment remains blocked until auth, secret storage, backups, deletion/export, and observability are ready.

## Non-Decisions

- This ADR does not choose a hosting provider.
- This ADR does not approve medical diagnosis, medication advice, or clinical treatment guidance.
- This ADR does not approve analytics, crash reporting, or telemetry.
- This ADR approves optional user-driven Telegram smart coach calls only when
  disabled by default, linked-account-only, provider-key-backed, minimized to
  current message plus compact report context, and free of raw HealthKit rows or
  secrets.
