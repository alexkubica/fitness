import SwiftUI

@main
struct FitnessCoachWatchApp: App {
  @Environment(\.scenePhase) private var scenePhase
  @StateObject private var syncBridge = WatchSyncBridge()
  @StateObject private var dashboard = WatchDashboardViewModel(
    stepProvider: WatchStepsHealthStore()
  )

  var body: some Scene {
    WindowGroup {
      WatchContentView(syncBridge: syncBridge, dashboard: dashboard)
        .task {
          syncBridge.activate()
          await dashboard.prepare()
        }
        .onChange(of: scenePhase) { _, phase in
          guard phase == .active else {
            return
          }
          Task {
            await dashboard.refreshSteps()
          }
        }
    }
  }
}
