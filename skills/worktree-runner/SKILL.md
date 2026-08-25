---
name: worktree-runner
description: Use when starting parallel feature work, creating or using git worktrees, running local services from multiple worktrees, or assigning non-conflicting ports.
---

# Worktree Runner

## Mission

Keep parallel health-coach work isolated so branches, app servers, databases, webhooks, queues, browser automation, and iOS tooling do not collide.

## Workflow

1. Check `git status --short --branch` and preserve user changes before creating or switching worktrees.
2. Detect whether the current checkout is already a linked worktree.
3. For independent feature work, use a repo-local `.worktrees/<branch>` checkout after confirming `.worktrees/` is ignored.
4. Use a dedicated branch per worktree.
5. Before starting local services, assign a port set for that worktree.
6. Pass ports through env vars or CLI flags instead of editing shared committed config.
7. Record important path, branch, port, and running-service choices in the task board, session notes, or handoff.
8. Run setup and baseline verification in the worktree before editing when the repo has commands for it.

## Port Assignment

Prefer a documented project port map. If none exists, derive a stable offset from the branch or worktree name:

```bash
name="$(git branch --show-current 2>/dev/null || basename "$PWD")"
offset="$(printf '%s' "$name" | cksum | awk '{ print 10 + ($1 % 80) }')"
```

Apply that offset to the usual local ports:

- web/dashboard: `3000 + offset`;
- server/API/MCP/Telegram webhook: `4000 + offset`;
- Postgres: `5400 + offset`;
- queue/cache: `6300 + offset`;
- Storybook or component preview: `6000 + offset`;
- browser automation/debugging: `9300 + offset`.

Check availability before starting services:

```bash
lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
```

When a framework falls back to another port automatically, record the actual selected port before handing off.

## Guardrails

- Do not create nested worktrees.
- Do not commit `.worktrees/`.
- Do not run two active branches on the same port set.
- Do not edit committed config just to reserve personal local ports.
- Stop or identify stale local servers before treating app failures as code failures.
- Use fake or disposable data in every local worktree unless live personal health data has been explicitly documented and opted into.
- Preserve user changes in the main checkout and other worktrees.

## Handoff

Include:

- worktree path;
- branch name;
- assigned port set;
- setup and verification commands run;
- services left running.
