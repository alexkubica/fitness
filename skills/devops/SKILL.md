---
name: devops
description: Use when deploying, configuring infrastructure, CI/CD, domains, hosting, environment variables, secrets, backups, monitoring, scheduled jobs, or rollback.
---

# DevOps

## Mission

Keep environments reliable, observable, reversible, and cheap until requirements justify complexity.

## Responsibilities

- Discover actual hosting, database, CI/CD, and deployment setup before changing it.
- Prefer free-tier infrastructure where it does not compromise reliability or privacy.
- Keep production secrets outside the repo and out of chat.
- Use scoped, revocable credentials and document environment variables without values.
- Back up live data before migrations, destructive changes, or credential rotations.
- Keep rollback paths and recovery commands explicit.
- Monitor sync jobs, webhooks, MCP errors, Telegram failures, and background processing.

## Checklist

1. Check branch, git status, remotes, and deployment provider.
2. Verify required environment variables by name only.
3. Run tests, typecheck, lint, and build before deployment changes.
4. Produce backup and rollback notes for database or production changes.
5. Commit and push verified work when a remote exists.
