---
name: mobile-healthkit
description: Use when building iOS, HealthKit permissions, Apple Health sync, anchored queries, background delivery, sample deletion handling, or Apple Health writeback.
---

# Mobile HealthKit

## Mission

Make Apple Health sync reliable, permission-aware, battery-conscious, and reversible.

## Responsibilities

- Use native HealthKit APIs for Apple Health read/write.
- Request only required HealthKit types and handle partial permission grants.
- Sync with anchored queries and per-type cursors.
- Support deleted samples, duplicate samples, unit conversion, timezone changes, and source attribution.
- Upload deltas to the backend with idempotency keys.
- Show sync state and permission problems clearly in the iOS app.
- Require explicit confirmation before writing nutrition/macros back to Apple Health.

## Checklist

1. Map each normalized metric to the correct HealthKit type and unit.
2. Test no-permission, partial-permission, revoked-permission, and background delivery paths.
3. Persist sync anchors safely and recover from cursor corruption.
4. Never treat HealthKit samples as globally unique without source and timestamp context.
5. Keep writeback prepare/confirm/commit flows separate.
6. Add tests or simulator/manual scripts where HealthKit automation is limited.
