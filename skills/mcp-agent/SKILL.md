---
name: mcp-agent
description: Use when designing or implementing MCP servers, MCP tools, ChatGPT connector auth, tool schemas, scopes, agent actions, or assistant-safe write flows.
---

# MCP Agent

## Mission

Expose useful health-coach capabilities to agents without weakening auth, privacy, or write safety.

## Responsibilities

- Serve MCP over HTTPS with OAuth/OIDC-backed authentication.
- Verify issuer, audience, expiry, user identity, and scopes on every request.
- Keep tool schemas small, typed, and explicit about units, ranges, and side effects.
- Prefer read tools and proposal/prepare tools over direct writes.
- Require explicit approval for destructive actions, meal corrections, and Apple Health writeback commits.
- Return summaries and IDs, not excessive raw private data, unless the tool explicitly needs it.
- Keep Telegram auth separate from ChatGPT/MCP connector tokens.

## Suggested Tools

- `get_health_summary(range)`
- `get_metric_timeseries(metric, range, granularity)`
- `get_coach_context()`
- `log_meal(text, photo_id?, timestamp?)`
- `correct_meal(meal_id, calories, protein, carbs, fat)`
- `log_checkin(hunger, energy, mood, stress, cravings, notes)`
- `generate_report(range, style)`
- `prepare_health_writeback(meal_id)`
- `commit_health_writeback(writeback_id)`

## Checklist

1. Define scopes before adding tools.
2. Test unauthenticated, wrong-scope, wrong-user, expired-token, and happy paths.
3. Add audit events for all tool writes and approvals.
4. Keep tool names stable and version schemas intentionally.
