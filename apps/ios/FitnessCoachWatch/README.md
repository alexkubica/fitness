# Fitness Coach Watch Dashboard

The Watch app reads current-day steps directly from HealthKit. It does not use the backend,
backend tokens, or the iPhone step snapshot as the authoritative live value. The existing
WatchConnectivity bridge remains a separate control/status channel for requesting an iPhone sync.

## Data providers

- `WatchStepHealthProviding` isolates HealthKit and supports mocks.
- `WatchDashboardCardProviding` is the integration point for future metric providers.
- `WatchDashboardCaching` stores the latest successfully displayed dashboard snapshot locally.
- `WatchComplicationDataProviding` exposes cached steps without coupling a future extension to the
  dashboard UI.

Active calories, exercise minutes, calories remaining, protein remaining, and the next planned meal
intentionally return unavailable/not-connected cards until their providers exist. Profile-aware
server APIs must remain behind provider implementations and must not be added to the Watch shell.

## Complication/widget setup still required

The Xcode project has an iPhone Home Screen widget, but no watchOS WidgetKit extension, accessory
families, or Watch extension signing setup. A future complication requires:

1. Adding a watchOS WidgetKit extension with an explicit bundle ID and provisioning profile.
2. Choosing accessory families and a privacy policy for showing steps on the watch face.
3. Sharing a small snapshot container or transferring entries into the extension.
4. Adapting `WatchComplicationDataProviding` into a WidgetKit timeline provider.
5. Testing stale timelines, local-day rollover, locked-device behavior, and real-device refresh.

No complication target or signing configuration is changed by the dashboard feature.
