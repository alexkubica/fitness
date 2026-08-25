# Local Agent Briefs

Use these briefs when delegating to subagents. Keep each delegated task self-contained, scoped, and independent. Do not ask two agents to edit the same files at the same time.

## Available Briefs

- `architect.md`: system structure, boundaries, and sequencing.
- `manager.md`: task board, blockers, owner assignment, commit/push status, and handoffs.
- `product.md`: product scope, milestones, acceptance criteria, and user workflows.
- `dx.md`: developer workflow, package manager behavior, worktrees, ports, and local setup.
- `backend.md`: API, database, auth, audit logs, jobs, and service integration.
- `data-modeler.md`: metric schemas, units, provenance, sync cursors, and aggregation.
- `mobile-ios.md`: iOS and HealthKit sync/writeback.
- `mcp.md`: MCP server tools, scopes, and agent-safe actions.
- `telegram-bot.md`: Telegram account linking, bot flows, reminders, and meal logging.
- `frontend.md`: web dashboard and correction/review UI.
- `ux.md`: low-friction workflows, information architecture, states, and responsive behavior.
- `health-safety.md`: medical safety, eating-disorder risk, and escalation boundaries.
- `security-privacy.md`: sensitive health data, auth, tokens, privacy, and threat modeling.
- `devops.md`: hosting, CI/CD, secrets, backups, observability, and rollback.
- `qa.md`: acceptance criteria, regression checks, and release validation.

## Delegation Rules

- Fan out only independent work.
- Give each agent a clear file or responsibility ownership boundary.
- Tell workers they are not alone in the codebase and must preserve others' changes.
- Ask explorers for concise findings with file references.
- Reconcile subagent output before editing shared files or committing.
