import Foundation

struct WatchDashboardSnapshot: Codable, Equatable {
  let cards: [WatchDashboardCard]
  let savedAt: Date
}

protocol WatchDashboardCaching {
  func load() -> WatchDashboardSnapshot?
  func save(_ snapshot: WatchDashboardSnapshot)
}

struct UserDefaultsWatchDashboardCache: WatchDashboardCaching {
  static let defaultsKey = "FitnessCoachWatch.DashboardSnapshot.v1"

  let defaults: UserDefaults

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  func load() -> WatchDashboardSnapshot? {
    guard let data = defaults.data(forKey: Self.defaultsKey) else {
      return nil
    }
    return try? JSONDecoder().decode(WatchDashboardSnapshot.self, from: data)
  }

  func save(_ snapshot: WatchDashboardSnapshot) {
    guard let data = try? JSONEncoder().encode(snapshot) else {
      return
    }
    defaults.set(data, forKey: Self.defaultsKey)
  }
}

protocol WatchStepGoalStoring {
  var stepGoal: Int? { get set }
}

struct UserDefaultsWatchStepGoalStore: WatchStepGoalStoring {
  static let defaultsKey = "FitnessCoachWatch.StepGoal"

  let defaults: UserDefaults

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  var stepGoal: Int? {
    get {
      let value = defaults.integer(forKey: Self.defaultsKey)
      return value > 0 ? value : nil
    }
    set {
      if let newValue, newValue > 0 {
        defaults.set(newValue, forKey: Self.defaultsKey)
      } else {
        defaults.removeObject(forKey: Self.defaultsKey)
      }
    }
  }
}
