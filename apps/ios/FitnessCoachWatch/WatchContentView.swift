import Combine
import SwiftUI

enum WatchDashboardTab: Hashable {
  case today
  case quickActions
  case dataStatus
}

struct WatchContentView: View {
  @ObservedObject var syncBridge: WatchSyncBridge
  @ObservedObject var dashboard: WatchDashboardViewModel
  @State private var selectedTab: WatchDashboardTab = .today

  var body: some View {
    TabView(selection: $selectedTab) {
      WatchTodayDashboard(
        dashboard: dashboard,
        onAction: handleDashboardAction
      )
      .tag(WatchDashboardTab.today)
      .tabItem {
        Label("Today", systemImage: "gauge.with.dots.needle.50percent")
      }

      WatchQuickActionsView(nutritionSnapshot: syncBridge.nutritionSnapshot)
        .tag(WatchDashboardTab.quickActions)
        .tabItem {
          Label("Quick actions", systemImage: "bolt.fill")
        }

      WatchDataStatusView(syncBridge: syncBridge, dashboard: dashboard)
        .tag(WatchDashboardTab.dataStatus)
        .tabItem {
          Label("Data status", systemImage: "gearshape.fill")
        }
    }
    .tint(WatchTheme.lime)
    .preferredColorScheme(.dark)
    .onAppear {
      if let snapshot = syncBridge.dashboardSnapshot {
        dashboard.applyDashboardSnapshot(snapshot)
      }
    }
    .onReceive(syncBridge.$dashboardSnapshot.compactMap { $0 }) { snapshot in
      dashboard.applyDashboardSnapshot(snapshot)
    }
  }

  private func handleDashboardAction(_ action: WatchDashboardAction) {
    switch action {
    case .requestHealthPermission:
      Task {
        await dashboard.requestStepPermission()
      }
    case .openStepGoalSettings:
      selectedTab = .dataStatus
    case .retry:
      Task {
        await dashboard.refreshSteps()
      }
    }
  }
}

private struct WatchTodayDashboard: View {
  @ObservedObject var dashboard: WatchDashboardViewModel
  let onAction: (WatchDashboardAction) -> Void

  var body: some View {
    NavigationStack {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 10) {
          HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 1) {
              Text("TODAY")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(WatchTheme.lime)
              Text("Dashboard")
                .font(.title2.bold())
                .foregroundStyle(.white)
            }

            Spacer(minLength: 4)

            Button {
              Task {
                await dashboard.refreshSteps()
              }
            } label: {
              Image(systemName: "arrow.clockwise")
                .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .foregroundStyle(WatchTheme.lime)
            .disabled(dashboard.isRefreshing)
            .accessibilityLabel(dashboard.isRefreshing ? "Refreshing dashboard" : "Refresh dashboard")
          }

          ForEach(dashboard.cards) { card in
            WatchDashboardCardView(card: card, onAction: onAction)
          }
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 8)
      }
      .background(WatchTheme.background)
      .navigationTitle("Fitness")
    }
  }
}

private struct WatchQuickActionsView: View {
  let nutritionSnapshot: NutritionCoachSnapshot?
  @State private var hunger = 5
  @State private var urge = 0
  @State private var isTimerRunning = false
  @State private var remainingSeconds = 10 * 60
  @State private var timerTask: Task<Void, Never>?

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 10) {
          Text("Quick actions")
            .font(.title3.bold())

          Text("Actions sync through the iPhone app.")
            .font(.caption)
            .foregroundStyle(WatchTheme.secondaryText)

          if let nutritionSnapshot {
            VStack(alignment: .leading, spacing: 4) {
              Label(nutritionSnapshot.nextMealText, systemImage: "calendar")
                .font(.caption.bold())
              Text("\(nutritionSnapshot.calorieText) · \(nutritionSnapshot.proteinText)")
                .font(.caption2)
                .foregroundStyle(WatchTheme.secondaryText)
                .lineLimit(2)
              Text(nutritionSnapshot.hungerText)
                .font(.caption2)
                .foregroundStyle(WatchTheme.secondaryText)
            }
            .padding(10)
            .background(WatchTheme.cardFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
          }

          WatchValueStepper(title: "Hunger", value: $hunger, icon: "dial.low")
          WatchValueStepper(title: "Urge", value: $urge, icon: "pause.circle")

          Button {
            startTimer()
          } label: {
            Label(timerText, systemImage: "timer")
              .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
          }
          .buttonStyle(.borderedProminent)
          .tint(WatchTheme.lime)
          .foregroundStyle(WatchTheme.actionText)

          Button(action: {}) {
            Label("Confirm planned meal", systemImage: "checkmark.circle")
              .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
          }
          .buttonStyle(.bordered)
          .accessibilityHint("Open the iPhone app from the widget or notification to complete sync")

          Button(action: {}) {
            Label("Log quick snack", systemImage: "fork.knife")
              .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
          }
          .buttonStyle(.bordered)

          Button {
            urge = 0
          } label: {
            Label("Mark urge passed", systemImage: "checkmark.seal")
              .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
          }
          .buttonStyle(.bordered)
        }
        .padding(.horizontal, 4)
      }
      .background(WatchTheme.background)
      .navigationTitle("Actions")
      .onDisappear {
        timerTask?.cancel()
      }
    }
  }

  private var timerText: String {
    isTimerRunning
      ? "Pause \(remainingSeconds / 60):\(String(format: "%02d", remainingSeconds % 60))"
      : "Start 10-minute urge timer"
  }

  private func startTimer() {
    timerTask?.cancel()
    remainingSeconds = 10 * 60
    isTimerRunning = true
    timerTask = Task { @MainActor in
      while remainingSeconds > 0 && !Task.isCancelled {
        try? await Task.sleep(nanoseconds: 1_000_000_000)
        remainingSeconds -= 1
      }
      isTimerRunning = false
    }
  }
}

private struct WatchValueStepper: View {
  let title: String
  @Binding var value: Int
  let icon: String

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Label("\(title) \(value)/10", systemImage: icon)
        .font(.caption.bold())
      HStack(spacing: 8) {
        Button {
          value = max(0, value - 1)
        } label: {
          Image(systemName: "minus")
            .frame(width: 36, height: 36)
        }
        .buttonStyle(.bordered)
        Button {
          value = min(10, value + 1)
        } label: {
          Image(systemName: "plus")
            .frame(width: 36, height: 36)
        }
        .buttonStyle(.borderedProminent)
        .tint(WatchTheme.lime)
        .foregroundStyle(WatchTheme.actionText)
      }
    }
    .padding(10)
    .background(WatchTheme.cardFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(title), \(value) out of 10")
  }
}

private struct WatchDataStatusView: View {
  @ObservedObject var syncBridge: WatchSyncBridge
  @ObservedObject var dashboard: WatchDashboardViewModel

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 10) {
          WatchSectionTitle(title: "Step goal", icon: "target")

          Picker("Daily step goal", selection: stepGoalBinding) {
            Text("No goal").tag(0)
            Text("6,000").tag(6_000)
            Text("8,000").tag(8_000)
            Text("10,000").tag(10_000)
            Text("12,000").tag(12_000)
          }
          .accessibilityHint("Sets a goal stored only on this Watch")

          WatchSectionTitle(title: "HealthKit", icon: "heart.text.square")
          statusRow(label: "Step permission", value: permissionText)
          statusRow(
            label: "Background updates",
            value: dashboard.backgroundUpdateError == nil ? "Opportunistic" : "Unavailable"
          )

          if let backgroundUpdateError = dashboard.backgroundUpdateError {
            Text(backgroundUpdateError)
              .font(.caption2)
              .foregroundStyle(WatchTheme.orange)
              .fixedSize(horizontal: false, vertical: true)
          }

          WatchSectionTitle(title: "iPhone sync", icon: "iphone")
          statusRow(
            label: "Metrics snapshot",
            value: syncBridge.dashboardSnapshot.map {
              "\($0.metrics.count) metrics"
            } ?? "Waiting"
          )
          if let dashboardSnapshot = syncBridge.dashboardSnapshot {
            statusRow(label: "Snapshot updated", value: dashboardSnapshot.statusText)
          }

          Text(syncBridge.status.title)
            .font(.headline)
          Text(syncBridge.status.detail)
            .font(.caption)
            .foregroundStyle(WatchTheme.secondaryText)
            .fixedSize(horizontal: false, vertical: true)

          Button {
            syncBridge.requestSync()
          } label: {
            Label(
              syncBridge.status.isWorking ? "Sync running" : "Request iPhone sync",
              systemImage: "arrow.triangle.2.circlepath"
            )
            .frame(maxWidth: .infinity, minHeight: 44)
          }
          .buttonStyle(.borderedProminent)
          .tint(WatchTheme.lime)
          .foregroundStyle(WatchTheme.actionText)
          .disabled(!syncBridge.canRequestSync || syncBridge.status.isWorking)

          Text(syncBridge.connectionText)
            .font(.caption2)
            .foregroundStyle(WatchTheme.secondaryText)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 8)
      }
      .background(WatchTheme.background)
      .navigationTitle("Status")
    }
  }

  private var stepGoalBinding: Binding<Int> {
    Binding(
      get: { dashboard.stepGoal ?? 0 },
      set: { dashboard.setStepGoal($0 == 0 ? nil : $0) }
    )
  }

  private var permissionText: String {
    switch dashboard.permissionStatus {
    case .unavailable:
      return "Unavailable"
    case .notDetermined:
      return "Not requested"
    case .requested:
      return "Requested"
    case .denied:
      return "Access off"
    }
  }

  private func statusRow(label: String, value: String) -> some View {
    HStack(alignment: .top) {
      Text(label)
        .foregroundStyle(WatchTheme.secondaryText)
      Spacer(minLength: 6)
      Text(value)
        .multilineTextAlignment(.trailing)
    }
    .font(.caption)
    .accessibilityElement(children: .combine)
  }
}

private struct WatchSectionTitle: View {
  let title: String
  let icon: String

  var body: some View {
    Label(title, systemImage: icon)
      .font(.caption.weight(.bold))
      .foregroundStyle(WatchTheme.lime)
  }
}

enum WatchTheme {
  static let background = Color(red: 0.075, green: 0.075, blue: 0.075)
  static let cardFill = Color.white.opacity(0.07)
  static let cardStroke = Color.white.opacity(0.12)
  static let secondaryText = Color(red: 0.77, green: 0.79, blue: 0.67)
  static let lime = Color(red: 0.76, green: 0.96, blue: 0.0)
  static let orange = Color(red: 1.0, green: 0.36, blue: 0.02)
  static let actionText = Color(red: 0.09, green: 0.13, blue: 0.0)
}
