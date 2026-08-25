# AGENTS.md

This repo is for a personal health and fitness coach system that syncs Apple Health data, exposes an authenticated MCP interface, and runs a Telegram coach bot.

## Project Context

- Product: private personal health coach for a single owner, focused on weight loss, activity, sleep, heart-rate trends, meals, macros, and daily check-ins.
- Primary data sources: Apple Watch Series 8, Apple Health, and a Xiaomi weight scale that should write weight into Apple Health where possible.
- Required from the start: native SDK/API sync, MCP access, Telegram bot coach, authentication, authorization, auditability, and secure handling of health data.
- Manual Apple Health exports are not an acceptable core workflow.
- HealthKit sync belongs in a native iOS app. Backend services and MCP servers must not pretend they can directly pull Apple Health data without the iOS client.
- MCP exposes normalized backend data and approved actions. It is not the source of truth and should not bypass app authorization rules.
- Telegram is a coach surface. It must link to the user account through an authenticated flow and must not reuse ChatGPT connector tokens.
- Initial metrics: weight, steps, active energy, resting/basal energy, sleep, heart rate, resting heart rate, walking heart rate average, meals, macros, meal photos, hunger, mood, energy, stress, cravings, and coach notes.
- Nutrition/macros may be written back to Apple Health only after explicit user confirmation.
- Coach guidance should be behavioral and fitness-oriented, not medical diagnosis.

## Source Of Truth

- Read `docs/CURRENT_PROGRESS.md` first for the latest state, completed setup, known gaps, and next task.
- Read `docs/ROADMAP.md` for product direction, milestone order, and current architectural assumptions.
- Read `docs/TASKS.md` for the durable task board and current owners/statuses.
- Read `docs/DEVOPS.md` before changing infrastructure, secrets, environments, backups, CI/CD, scheduled jobs, or deployment behavior.
- Treat this file as the canonical repository-level instruction file when instructions conflict.

## Likely Architecture

- `apps/ios`: iOS app for HealthKit permissions, anchored sync, background delivery, local status, and later HealthKit writeback confirmations.
- `apps/server`: first-slice combined backend service for API, auth, MCP read tools, normalized health data, meal/check-in storage, coach memory, report generation, audit logs, and Telegram webhooks.
- `apps/api` and `apps/mcp`: possible later split points if deployment/runtime boundaries justify separating API and MCP from `apps/server`.
- `apps/web`: optional dashboard/admin surface for reports, corrections, account linking, and data review.
- `packages/domain`: pure domain logic for metrics, trends, reports, calories/macros, and coaching rules.
- `packages/db`: schema, migrations, repositories, and seed/test data.
- `packages/auth`: shared auth/session/scope helpers.
- `packages/healthkit-types`: shared mapping for HealthKit identifiers and normalized metric names.

Treat this structure as direction, not existing fact. Discover actual files before editing.

## Start Here

Before doing any work:

1. Read this file.
2. Check `skills/README.md`.
3. Open every relevant `skills/<role>/SKILL.md` file for the task.
4. Check `git status --short` and preserve user changes.
5. Inspect nearby files and current docs before editing.
6. Use subagents or parallel tool calls for independent work that does not share state.

Always check whether a relevant project skill or agent brief exists before planning, editing, reviewing, deploying, or handing off.
Prefer isolated git worktrees for independent feature work. Assign per-worktree ports before starting local servers, databases, webhook listeners, emulators, or browser automation.

## Project Skills

Use these project-local skills as role instructions:

- `skills/skill-writer/SKILL.md` for creating and maintaining project-local skills, agent briefs, and `AGENTS.md`.
- `skills/project-manager/SKILL.md` for planning, prioritization, status, scope, sequencing, and handoffs.
- `skills/software-architect/SKILL.md` for system boundaries, data flow, module structure, and long-term technical direction.
- `skills/worktree-runner/SKILL.md` for isolated worktrees, parallel branches, runtime port assignment, and local service conflict avoidance.
- `skills/developer/SKILL.md` for implementation, refactoring, coding standards, and local verification.
- `skills/backend/SKILL.md` for API, database, auth/session integration, data services, audit logs, and server-side jobs.
- `skills/mobile-healthkit/SKILL.md` for iOS, HealthKit permissions, anchored sync, background delivery, and Apple Health writeback.
- `skills/mcp-agent/SKILL.md` for MCP server design, tool schemas, scopes, connector auth, and agent-safe actions.
- `skills/telegram-bot/SKILL.md` for Telegram bot flows, account linking, reminders, photo/text meal logging, and bot safety.
- `skills/coach-nutrition/SKILL.md` for coaching behavior, food logging, macros, reports, check-ins, and non-medical guidance.
- `skills/fitness-coach/SKILL.md` for training, activity targets, recovery, workout guidance, and injury-aware boundaries.
- `skills/habit-coach/SKILL.md` for check-in cadence, reminders, behavioral loops, relapse recovery, and coach memory.
- `skills/health-safety/SKILL.md` for medical boundaries, eating-disorder risk, abnormal symptoms, and escalation language.
- `skills/data-modeler/SKILL.md` for metric schemas, units, provenance, aggregation, sync cursors, and data quality.
- `skills/frontend/SKILL.md` for web UI and dashboard implementation.
- `skills/ux/SKILL.md` for workflows, correction flows, information architecture, and interaction clarity.
- `skills/accessibility/SKILL.md` for semantic UI, keyboard access, focus, contrast, and inclusive behavior.
- `skills/legal-compliance/SKILL.md` for privacy policy, terms, consent language, data export/deletion, and compliance risk.
- `skills/security-privacy/SKILL.md` for health data, secrets, OAuth, tokens, scopes, encryption, consent, retention, and threat modeling.
- `skills/devops/SKILL.md` for hosting, CI/CD, environments, secrets, backups, observability, and rollback.
- `skills/qa/SKILL.md` for testing strategy, acceptance checks, regression risk, browser/app review, and release validation.
- `skills/dx/SKILL.md` for formatting, linting, hooks, scripts, local setup, and developer workflow.

Combine skills when a task crosses roles. For example, HealthKit writeback through Telegram usually needs `mobile-healthkit`, `telegram-bot`, `backend`, `mcp-agent`, `security-privacy`, and `qa`.

## Local Agents

Use `agents/README.md` for subagent role prompts and delegation guidance. Use `agents/manager.md` for task-board upkeep, sequencing, blockers, and handoffs. Prefer focused subagents for independent investigation or disjoint implementation slices, then reconcile their findings before editing shared files.

## Rules

- Own tasks end to end: investigate, implement, verify, document, commit, and push when a remote exists.
- Always commit completed verified work. Push the current branch to `origin` when a remote exists. If commit or push is blocked, report the exact blocker and working-tree state.
- Run relevant format, lint, typecheck, tests, and build before committing. If the repo has no scripts yet, say so and run the smallest available checks.
- If npm is used, keep this repo on the public npm registry through the project `.npmrc`. Do not let the user-level CodeArtifact registry leak into lockfiles.
- Use worktrees for independent feature work when practical. Do not run multiple active branches from the same checkout when they can conflict.
- Assign per-worktree ports before starting local services. Prefer env vars or CLI flags over committed config changes for local port choices, and record actual ports in the handoff.
- Keep changes scoped to the requested task. Do not refactor unrelated files.
- Never overwrite or discard user changes. If the tree is dirty, understand changes before editing related files.
- Never print, log, commit, or paste secret values.
- For Neon CLI auth, provider OAuth login, or any browser auth URL, do not
  commit account identifiers, callback-state values, access tokens, or local
  browser-profile paths.
- Use fake or disposable data by default in local development and CI. Live personal health data requires explicit documentation, protected credentials, and deliberate opt-in.
- Prefer least-privilege credentials, revocable tokens, short-lived sessions, and scoped OAuth permissions.
- Treat health data as sensitive. Minimize collection, encrypt where appropriate, and keep data deletion/export paths in the design.
- Assistant, MCP, and Telegram write actions must be auditable. Destructive writes and Apple Health writeback require explicit approval.
- Store normalized health and nutrition data in typed domain models. Avoid ad hoc stringly-typed metric names.
- Keep medical boundaries clear. Do not diagnose disease, adjust medications, or present heart/sleep findings as medical conclusions.
- Use proven platform APIs and libraries for core domains: HealthKit for Apple Health, official Telegram Bot API libraries, OAuth/OIDC for auth, and an MCP SDK/server framework for MCP.
- Prefer pure, tested domain modules for metrics, trend summaries, calorie estimates, and report rules. Do not bury calculations in UI or bot handlers.
- For frontend/mobile UI, keep workflows dense, calm, and correction-friendly. The user should be able to inspect, correct, and approve data quickly.

## Verification

Scale verification to the change:

- Documentation only: check markdown formatting where tooling exists and run `git diff --check`.
- Code changes: run formatter, linter, typecheck, relevant tests, and build.
- Domain logic: add or update tests for trend calculations, metric aggregation, meal estimates, and report generation.
- Auth/MCP/Telegram changes: test unauthenticated, unauthorized, expired-token, wrong-user, and happy-path cases.
- HealthKit changes: test permission-denied, partial-permission, deleted samples, duplicate sync, anchored-query cursor, background delivery, and writeback confirmation cases.
- Database/migration changes: run migrations on disposable data first, back up live data before production changes, and document rollback.
- UI/mobile changes: verify affected flows on realistic mobile widths and check no text overlaps or layout overflow.

If a command cannot be run, include the reason and residual risk in the handoff.

## Handoff

Every handoff should include:

- Files changed.
- Verification commands run and their results.
- Commit and push status.
- Open risks, missing facts, or follow-up work.
