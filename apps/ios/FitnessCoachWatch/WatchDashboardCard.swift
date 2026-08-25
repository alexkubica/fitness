import Foundation

enum WatchDashboardMetricKey: String, Codable, CaseIterable {
  case steps
  case weight
  case activeEnergy = "active_energy"
  case restingEnergy = "resting_energy"
  case sleep
  case heartRate = "heart_rate"
  case restingHeartRate = "resting_heart_rate"
  case walkingHeartRate = "walking_heart_rate"
  case dietaryEnergy = "dietary_energy"
  case protein
  case carbs
  case fat
  case fiber
  case activeCalories = "active_calories"
  case exerciseMinutes = "exercise_minutes"
  case caloriesRemaining = "calories_remaining"
  case proteinRemaining = "protein_remaining"
  case nextPlannedMeal = "next_planned_meal"
}

enum WatchDashboardCardState: String, Codable, Equatable {
  case content
  case loading
  case empty
  case unavailable
  case permissionRequired
  case error
}

enum WatchDashboardDataSource: String, Codable, Equatable {
  case healthKit
  case local
  case server
}

struct WatchDashboardFreshness: Codable, Equatable {
  let refreshedAt: Date
  let source: WatchDashboardDataSource
  var isCached: Bool
  var isStale: Bool
}

enum WatchDashboardAction: String, Codable, Equatable {
  case requestHealthPermission
  case openStepGoalSettings
  case retry
}

struct WatchDashboardCard: Identifiable, Codable, Equatable {
  let id: String
  let metricKey: WatchDashboardMetricKey
  let label: String
  let rawValue: Double?
  let formattedValue: String?
  let unit: String?
  let goal: Double?
  let progress: Double?
  let remainingValue: Double?
  let freshness: WatchDashboardFreshness?
  let state: WatchDashboardCardState
  let stateMessage: String?
  let action: WatchDashboardAction?

  static func stableID(for metricKey: WatchDashboardMetricKey) -> String {
    "watch-dashboard.\(metricKey.rawValue)"
  }
}

enum WatchStepFormatting {
  static func integer(_ value: Int) -> String {
    value.formatted(.number.precision(.fractionLength(0)))
  }

  static func percentage(_ progress: Double) -> String {
    let bounded = min(max(progress, 0), 1)
    return Int((bounded * 100).rounded()).formatted() + "%"
  }
}
