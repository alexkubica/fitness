# BioSync Health Coach Stitch Reference

Project: `8164792401873827605`

Downloaded with Stitch MCP and `curl -L` on 2026-06-13.

## Screens

| Screen               | ID                                 | Screenshot                        | Code                            |
| -------------------- | ---------------------------------- | --------------------------------- | ------------------------------- |
| Sync Center          | `74c02d544d1748cc9ecd98025095ff3f` | `screens/sync-center.png`         | `code/sync-center.html`         |
| Coach Feed           | `9dbbd328ce644c8baa28a10d4727e70e` | `screens/coach-feed.png`          | `code/coach-feed.html`          |
| Metric Detail: Steps | `c36fed41e9434ec7bac5b8259008fb8c` | `screens/metric-detail-steps.png` | `code/metric-detail-steps.html` |
| Dashboard            | `7b5cf832a0494a1284897189575709d1` | `screens/dashboard.png`           | `code/dashboard.html`           |

The provided Design System ID `asset-stub-assets_e6b979cb1b8e4d8aab0aac36bc9ec252`
is not exposed by Stitch as a `screens/{id}` resource. The design system was
retrieved through the project metadata instead.

## Native iOS Translation

- Background: deep onyx `#131313`.
- Primary action/accent: electric lime `#C3F400`.
- Secondary alert/intensity accent: orange `#FF5E07`.
- Supporting accent: cyan `#7DF4FF`.
- Surface treatment: dark glass-like cards with subtle white stroke.
- Sync UX: user-facing progress should show total samples read/uploaded, not
  HealthKit page or HTTP chunk internals.
