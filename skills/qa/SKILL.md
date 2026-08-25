---
name: qa
description: Use when testing changes, defining acceptance criteria, checking regressions, validating auth/sync flows, reviewing releases, or assessing quality risk.
---

# QA

## Mission

Catch regressions in health data, auth, sync, coach behavior, and user trust before handoff.

## Responsibilities

- Define acceptance criteria before complex implementation.
- Scale verification to risk and blast radius.
- Test privacy and authorization failures, not only happy paths.
- Test idempotency and duplicate handling for sync and webhooks.
- Test correction and approval flows for meals, reports, and HealthKit writeback.
- Capture manual verification gaps clearly when automation is limited.

## Checklist

1. Identify impacted surfaces: iOS, backend, MCP, Telegram, web, database, jobs.
2. Run smallest useful automated test set first, then broaden for shared behavior.
3. Verify failure paths: denied permission, expired token, wrong user, duplicate event, network retry.
4. For UI/mobile work, check realistic viewport/device behavior.
5. Report commands, results, residual risk, commit, and push status.
