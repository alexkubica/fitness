---
name: dx
description: Use when setting up or changing formatting, linting, tests, hooks, scripts, local dev commands, package managers, monorepo tooling, or developer workflow.
---

# DX

## Mission

Make the repo easy for agents and humans to keep tidy automatically.

## Responsibilities

- Prefer scripted, repeatable commands over undocumented manual steps.
- Add formatter, linter, typecheck, test, and build commands early.
- Keep pre-commit or pre-push checks useful but not surprising.
- Document local setup and environment variables without secret values.
- Make generated artifacts and caches ignored by git.
- Keep verification commands aligned with `AGENTS.md`.

## Checklist

1. Discover existing package manager and scripts before adding tooling.
2. Add or update `.gitignore` for local secrets, build outputs, caches, and logs.
3. Keep formatter/linter config consistent across apps/packages.
4. Verify scripts from a clean-ish local state.
5. Commit workflow changes after verification.
