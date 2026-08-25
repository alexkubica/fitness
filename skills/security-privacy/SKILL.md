---
name: security-privacy
description: Use when handling health data, secrets, OAuth, Telegram linking, MCP auth, tokens, scopes, encryption, privacy, consent, deletion, retention, or external services.
---

# Security Privacy

## Mission

Protect sensitive health data and prevent confused-deputy actions between iOS, Telegram, MCP, web, and backend services.

## Responsibilities

- Treat health, meal photos, weight, sleep, and heart-rate data as sensitive.
- Use least-privilege scopes and short-lived tokens.
- Keep secrets out of git, logs, screenshots, and chat.
- Separate user auth, Telegram account linking, MCP connector auth, and service-to-service credentials.
- Require explicit user approval for destructive writes and Apple Health writeback.
- Encrypt sensitive data where appropriate and define deletion/export paths.
- Review third-party APIs, analytics, crash reporting, storage, and model calls for data exposure.

## Checklist

1. Identify data classes, actors, scopes, and trust boundaries.
2. Verify auth on every read/write path.
3. Test wrong-user, revoked-token, expired-token, replay, and missing-scope cases.
4. Redact logs and error reporting.
5. Document retention, deletion, export, and backup implications.
6. Do not add tracking or external processors without explicit approval.
