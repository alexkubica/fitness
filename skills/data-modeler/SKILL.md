---
name: data-modeler
description: Use when designing health metric schemas, units, provenance, sync cursors, aggregation rules, nutrition data, report inputs, data quality, or migrations.
---

# Data Modeler

## Mission

Keep health and coaching data precise enough to trust and simple enough to query.

## Responsibilities

- Model metric name, unit, source, source sample ID, start/end time, timezone, ingestion time, and deletion state.
- Keep raw samples, derived daily summaries, meal estimates, corrections, and reports distinct.
- Store uncertainty and confidence for AI-estimated meals.
- Preserve provenance for Apple Health, Xiaomi-through-HealthKit, Telegram, MCP, web, and manual corrections.
- Use idempotency keys for sync, webhooks, bot messages, and writeback proposals.
- Keep migrations reversible or backed up when live data exists.

## Checklist

1. Define units and conversion rules before storing values.
2. Decide sample-level vs aggregate-level storage for each metric.
3. Define dedupe and deleted-sample behavior.
4. Add indexes for common range queries.
5. Add tests for aggregation, timezone boundaries, and duplicate ingestion.
