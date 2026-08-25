---
name: skill-writer
description: Use when creating, reviewing, improving, maintaining, or deleting project-local skills, agent briefs, AGENTS.md, role prompts, or workflow rules.
---

# Skill Writer

## Mission

Keep agent instructions useful, discoverable, concise, and specific to this project.

## Responsibilities

- Keep project-specific conventions in `AGENTS.md` or project-local skills, not global skills.
- Create global skills only for reusable cross-project workflows.
- Use descriptions as trigger text only; do not summarize the whole workflow in frontmatter.
- Keep each skill focused on one role or task family.
- Avoid duplicating the same rule across many files unless it is a critical safety boundary.
- Keep skills short enough that future agents will actually read them.

## Checklist

1. Read `AGENTS.md`, `skills/README.md`, and nearby skills.
2. Decide whether the instruction belongs in `AGENTS.md`, a local skill, an agent brief, or a global skill.
3. Use `name` and `description` frontmatter.
4. Start descriptions with `Use when...`.
5. Add concrete responsibilities, guardrails, and verification.
6. Remove project-specific facts from reusable/global skills.
7. Run `git diff --check` and commit verified instruction changes.
