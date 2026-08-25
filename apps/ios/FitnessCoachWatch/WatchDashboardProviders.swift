import Foundation

protocol WatchDashboardCardProviding {
  var metricKey: WatchDashboardMetricKey { get }
  func card() async -> WatchDashboardCard
}

struct UnavailableWatchCardProvider: WatchDashboardCardProviding {
  let metricKey: WatchDashboardMetricKey
  let label: String
  let message: String

  func card() async -> WatchDashboardCard {
    WatchDashboardCard(
      id: WatchDashboardCard.stableID(for: metricKey),
      metricKey: metricKey,
      label: label,
      rawValue: nil,
      formattedValue: nil,
      unit: nil,
      goal: nil,
      progress: nil,
      remainingValue: nil,
      freshness: nil,
      state: .unavailable,
      stateMessage: message,
      action: nil
    )
  }
}

@MainActor
enum WatchPlaceholderProviders {
  static let all: [any WatchDashboardCardProviding] = [
    UnavailableWatchCardProvider(
      metricKey: .activeCalories,
      label: "Active calories",
      message: "HealthKit adapter not connected"
    ),
    UnavailableWatchCardProvider(
      metricKey: .exerciseMinutes,
      label: "Exercise minutes",
      message: "HealthKit adapter not connected"
    ),
    UnavailableWatchCardProvider(
      metricKey: .caloriesRemaining,
      label: "Calories remaining",
      message: "Server provider not connected"
    ),
    UnavailableWatchCardProvider(
      metricKey: .proteinRemaining,
      label: "Protein remaining",
      message: "Server provider not connected"
    ),
    UnavailableWatchCardProvider(
      metricKey: .nextPlannedMeal,
      label: "Next planned meal",
      message: "Meal plan provider not connected"
    ),
  ]
}

struct WatchComplicationStepEntry: Equatable {
  let steps: Int
  let date: Date
  let isStale: Bool
}

protocol WatchComplicationDataProviding {
  func currentStepEntry() -> WatchComplicationStepEntry?
}

struct CachedWatchComplicationDataProvider: WatchComplicationDataProviding {
  let cache: any WatchDashboardCaching

  func currentStepEntry() -> WatchComplicationStepEntry? {
    guard let card = cache.load()?.cards.first(where: { $0.metricKey == .steps }),
      card.state == .content,
      let rawValue = card.rawValue,
      let freshness = card.freshness
    else {
      return nil
    }
    return WatchComplicationStepEntry(
      steps: Int(max(0, rawValue).rounded()),
      date: freshness.refreshedAt,
      isStale: freshness.isStale || freshness.isCached
    )
  }
}
