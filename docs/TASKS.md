# Tasks

Last updated: 2026-08-24

## Next

- [ ] Verify hosted web Google sign-in end to end.
- [ ] Verify corrected daily HealthKit statistics sync on a physical device.
- [ ] Split the remaining large SwiftUI coach and nutrition views.
- [ ] Add retention, export, and deletion UX for health, meal, check-in, report,
      coach-memory, and audit data.
- [ ] Add writeback reconciliation/audit UX without allowing remote HealthKit
      commits.
- [ ] Complete current-tree and full-history privacy/secret scans.
- [ ] Choose a clean-history publication strategy and an optional license.

## Implemented

- [x] Native HealthKit daily aggregation, anchored/background sync, charts,
      watch, widgets, and privacy-light sync status.
- [x] Scoped signed-token API auth, Google account linking, OAuth/MCP metadata,
      and fake-token production guards.
- [x] Normalized database repositories and migrations for profiles, health
      metrics, meals, plans, targets, check-ins, reports, memory, and audit events.
- [x] Authenticated MCP read/write tools with confirmation boundaries.
- [x] Local-first nutrition and meal editing with server synchronization; raw
      meal photos stay on-device.
- [x] Reviewable AI meal estimation with server-only credentials and bounded
      payloads.
- [x] Explicit on-device Apple Health nutrition writeback confirmation.
- [x] Google-gated web dashboard and account-scoped data access.
- [x] Telegram linking, reminders, and optional coaching with medical and eating
      behavior safety boundaries.
- [x] Public npm registry pinning, verification scripts, and deployment checks.

Detailed private operational history remains in the original private Git
history and must not be copied into a clean public history.
