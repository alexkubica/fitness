---
name: backend
description: Use when working on APIs, database schema, auth/session integration, service boundaries, audit logs, jobs, webhooks, or server-side health data flows.
---

# Backend

## Mission

Own the trustworthy server-side path for health data, meals, reports, auth, and integrations.

## Responsibilities

- Keep the backend as the source of truth for normalized app data.
- Validate all inputs at API boundaries.
- Enforce account/user authorization on every read and write.
- Keep MCP, Telegram, web, and iOS clients behind the same service rules.
- Record audit events for assistant, MCP, Telegram, HealthKit writeback, deletion, and correction actions.
- Make sync idempotent with stable source IDs, timestamps, cursors, and dedupe rules.
- Keep background jobs observable and retry-safe.

## Checklist

1. Define the caller, user, scope, and target account before adding an endpoint.
2. Validate payloads and reject unknown metric names or units.
3. Keep writes transactional where consistency matters.
4. Add tests for authorization, validation, idempotency, and audit logs.
5. Avoid leaking raw secrets, tokens, photos, or health data in logs.
