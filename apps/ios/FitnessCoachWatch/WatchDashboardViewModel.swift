import Combine
import Foundation

@MainActor
final class WatchDashboardViewModel: ObservableObject {
  @Published private(set) var cards: [WatchDashboardCard]
  @Published private(set) var permissionStatus: WatchHealthPermissionStatus = .notDetermined
  @Published private(set) var isRefreshing = false
  @Published private(set) var backgroundUpdateError: String?

  private let stepProvider: any WatchStepHealthProviding
  private let cache: any WatchDashboardCaching
  private var goalStore: any WatchStepGoalStoring
  private let calendarProvider: () -> Calendar
  private let now: () -> Date
  private var refreshGeneration = 0
  private var hasStartedBackgroundUpdates = false

  init(
    stepProvider: any WatchStepHealthProviding,
    cache: any WatchDashboardCaching = UserDefaultsWatchDashboardCache(),
    goalStore: any WatchStepGoalStoring = UserDefaultsWatchStepGoalStore(),
    calendarProvider: @escaping () -> Calendar = { .current },
    now: @escaping () -> Date = Date.init
  ) {
    self.stepProvider = stepProvider
    self.cache = cache
    self.goalStore = goalStore
    self.calendarProvider = calendarProvider
    self.now = now

    let placeholders = Self.placeholderCards()
    let baseCards = [Self.loadingStepsCard()] + placeholders
    if let snapshot = cache.load() {
      let cachedCards = Self.currentLocalDayCards(
        Self.markCached(snapshot.cards),
        now: now(),
        calendar: calendarProvider()
      )
      cards = Self.merging(
        cachedCards: cachedCards,
        into: baseCards
      )
    } else {
      cards = baseCards
    }
  }

  var stepGoal: Int? {
    goalStore.stepGoal
  }

  func prepare() async {
    permissionStatus = await stepProvider.permissionStatus()
    await refreshSteps()
    await startBackgroundUpdatesIfNeeded()
  }

  func refreshSteps() async {
    refreshGeneration += 1
    let generation = refreshGeneration
    isRefreshing = true

    if stepCard?.state != .content {
      replace(Self.loadingStepsCard())
    }

    do {
      let outcome = try await stepProvider.fetchCurrentDaySteps(
        now: now(),
        calendar: calendarProvider()
      )
      guard generation == refreshGeneration else {
        return
      }
      apply(outcome)
    } catch {
      guard generation == refreshGeneration else {
        return
      }
      replace(
        Self.stepsStateCard(
          state: .error,
          message: error.localizedDescription,
          action: .retry
        ))
    }

    if generation == refreshGeneration {
      isRefreshing = false
    }
  }

  func requestStepPermission() async {
    permissionStatus = await stepProvider.requestPermission()
    await refreshSteps()
    await startBackgroundUpdatesIfNeeded()
  }

  func setStepGoal(_ goal: Int?) {
    goalStore.stepGoal = goal
    guard let card = stepCard,
      card.state == .content,
      let rawValue = card.rawValue,
      let freshness = card.freshness
    else {
      return
    }
    replace(
      Self.stepsCard(
        reading: WatchStepReading(
          steps: Int(rawValue.rounded()),
          startDate: calendarProvider().startOfDay(for: freshness.refreshedAt),
          endDate: freshness.refreshedAt,
          refreshedAt: freshness.refreshedAt
        ),
        goal: goal,
        cached: freshness.isCached
      ))
    saveSuccessfulDashboard()
  }

  func applyCachedSnapshot(_ snapshot: WatchDashboardSnapshot) {
    let cachedCards = Self.currentLocalDayCards(
      Self.markCached(snapshot.cards),
      now: now(),
      calendar: calendarProvider()
    )
    for cachedCard in cachedCards {
      guard shouldReplaceCurrentCard(with: cachedCard) else {
        continue
      }
      replace(cachedCard)
    }
  }

  func applyDashboardSnapshot(_ snapshot: HealthDashboardSnapshot) {
    let snapshotCards = Self.cards(from: snapshot)

    for snapshotCard in snapshotCards {
      if snapshotCard.metricKey == .steps,
        stepCard?.state == .content,
        stepCard?.freshness?.source == .healthKit
      {
        continue
      }

      guard shouldReplaceCurrentCard(with: snapshotCard) else {
        continue
      }

      replace(snapshotCard)
    }

    saveSuccessfulDashboard()
  }

  private var stepCard: WatchDashboardCard? {
    cards.first(where: { $0.metricKey == .steps })
  }

  private func apply(_ outcome: WatchStepFetchOutcome) {
    switch outcome {
    case .value(let reading):
      permissionStatus = .requested
      let newCard = Self.stepsCard(
        reading: reading,
        goal: goalStore.stepGoal,
        cached: false
      )
      if shouldReplaceCurrentCard(with: newCard) {
        replace(newCard)
        saveSuccessfulDashboard()
      }
    case .empty(let permission):
      permissionStatus = permission
      if permission == .notDetermined {
        replace(
          Self.stepsStateCard(
            state: .permissionRequired,
            message: "Allow step-count access to show live steps.",
            action: .requestHealthPermission
          ))
      } else {
        replace(
          Self.stepsStateCard(
            state: .empty,
            message: "No steps found today. Health access may be off.",
            action: .retry
          ))
      }
    case .unavailable:
      permissionStatus = .unavailable
      replace(
        Self.stepsStateCard(
          state: .unavailable,
          message: "Health data is unavailable on this Watch.",
          action: nil
        ))
    case .denied:
      permissionStatus = .denied
      replace(
        Self.stepsStateCard(
          state: .permissionRequired,
          message: "Step access is off. Enable Fitness Coach in Health settings.",
          action: nil
        ))
    }
  }

  private func startBackgroundUpdatesIfNeeded() async {
    guard !hasStartedBackgroundUpdates, permissionStatus == .requested else {
      return
    }
    hasStartedBackgroundUpdates = true
    do {
      try await stepProvider.startBackgroundUpdates { [weak self] in
        await self?.refreshSteps()
      }
    } catch {
      backgroundUpdateError = error.localizedDescription
    }
  }

  private func shouldReplaceCurrentCard(with candidate: WatchDashboardCard) -> Bool {
    guard let current = cards.first(where: { $0.metricKey == candidate.metricKey }) else {
      return true
    }
    guard let currentDate = current.freshness?.refreshedAt else {
      return true
    }
    guard let candidateDate = candidate.freshness?.refreshedAt else {
      return current.state != .content
    }
    return candidateDate >= currentDate
  }

  private func replace(_ card: WatchDashboardCard) {
    if let index = cards.firstIndex(where: { $0.metricKey == card.metricKey }) {
      cards[index] = card
    } else {
      cards.append(card)
    }
  }

  private func saveSuccessfulDashboard() {
    guard cards.contains(where: { $0.state == .content }) else {
      return
    }
    cache.save(WatchDashboardSnapshot(cards: cards, savedAt: now()))
  }

  private static func stepsCard(
    reading: WatchStepReading,
    goal: Int?,
    cached: Bool
  ) -> WatchDashboardCard {
    let resolvedGoal = goal.flatMap { $0 > 0 ? Double($0) : nil }
    let rawValue = Double(reading.steps)
    let progress = resolvedGoal.map { min(max(rawValue / $0, 0), 1) }
    let remaining = resolvedGoal.map { max(0, $0 - rawValue) }

    return WatchDashboardCard(
      id: WatchDashboardCard.stableID(for: .steps),
      metricKey: .steps,
      label: "Steps",
      rawValue: rawValue,
      formattedValue: WatchStepFormatting.integer(reading.steps),
      unit: "steps",
      goal: resolvedGoal,
      progress: progress,
      remainingValue: remaining,
      freshness: WatchDashboardFreshness(
        refreshedAt: reading.refreshedAt,
        source: .healthKit,
        isCached: cached,
        isStale: false
      ),
      state: .content,
      stateMessage: nil,
      action: .openStepGoalSettings
    )
  }

  private static func loadingStepsCard() -> WatchDashboardCard {
    stepsStateCard(state: .loading, message: "Reading HealthKit", action: nil)
  }

  private static func stepsStateCard(
    state: WatchDashboardCardState,
    message: String,
    action: WatchDashboardAction?
  ) -> WatchDashboardCard {
    WatchDashboardCard(
      id: WatchDashboardCard.stableID(for: .steps),
      metricKey: .steps,
      label: "Steps",
      rawValue: nil,
      formattedValue: nil,
      unit: "steps",
      goal: nil,
      progress: nil,
      remainingValue: nil,
      freshness: nil,
      state: state,
      stateMessage: message,
      action: action
    )
  }

  private static func placeholderCards() -> [WatchDashboardCard] {
    [
      placeholder(.weight, "Weight", "Open Fitness Coach on iPhone to sync."),
      placeholder(.activeEnergy, "Active", "Open Fitness Coach on iPhone to sync."),
      placeholder(.restingEnergy, "Resting", "Open Fitness Coach on iPhone to sync."),
      placeholder(.sleep, "Sleep", "Open Fitness Coach on iPhone to sync."),
      placeholder(.heartRate, "Heart", "Open Fitness Coach on iPhone to sync."),
      placeholder(.restingHeartRate, "Rest HR", "Open Fitness Coach on iPhone to sync."),
      placeholder(.walkingHeartRate, "Walk HR", "Open Fitness Coach on iPhone to sync."),
      placeholder(.dietaryEnergy, "Calories", "Open Fitness Coach on iPhone to sync."),
      placeholder(.protein, "Protein", "Open Fitness Coach on iPhone to sync."),
      placeholder(.carbs, "Carbs", "Open Fitness Coach on iPhone to sync."),
      placeholder(.fat, "Fat", "Open Fitness Coach on iPhone to sync."),
      placeholder(.fiber, "Fiber", "Open Fitness Coach on iPhone to sync."),
    ]
  }

  private static func cards(from snapshot: HealthDashboardSnapshot) -> [WatchDashboardCard] {
    guard snapshot.state == .ready else {
      return []
    }

    return snapshot.metrics.compactMap { metric in
      guard let key = WatchDashboardMetricKey(rawValue: metric.metricName) else {
        return nil
      }

      return WatchDashboardCard(
        id: WatchDashboardCard.stableID(for: key),
        metricKey: key,
        label: metric.title,
        rawValue: nil,
        formattedValue: metric.valueText,
        unit: nil,
        goal: nil,
        progress: nil,
        remainingValue: nil,
        freshness: WatchDashboardFreshness(
          refreshedAt: snapshot.updatedAt,
          source: .local,
          isCached: false,
          isStale: false
        ),
        state: .content,
        stateMessage: metric.detailText ?? metric.caption,
        action: key == .steps ? .openStepGoalSettings : nil
      )
    }
  }

  private static func placeholder(
    _ key: WatchDashboardMetricKey,
    _ label: String,
    _ message: String
  ) -> WatchDashboardCard {
    WatchDashboardCard(
      id: WatchDashboardCard.stableID(for: key),
      metricKey: key,
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

  private static func markCached(_ cards: [WatchDashboardCard]) -> [WatchDashboardCard] {
    cards.map { card in
      guard var freshness = card.freshness else {
        return card
      }
      freshness.isCached = true
      if freshness.source == .server {
        freshness.isStale = true
      }
      return WatchDashboardCard(
        id: card.id,
        metricKey: card.metricKey,
        label: card.label,
        rawValue: card.rawValue,
        formattedValue: card.formattedValue,
        unit: card.unit,
        goal: card.goal,
        progress: card.progress,
        remainingValue: card.remainingValue,
        freshness: freshness,
        state: card.state,
        stateMessage: card.stateMessage,
        action: card.action
      )
    }
  }

  private static func merging(
    cachedCards: [WatchDashboardCard],
    into baseCards: [WatchDashboardCard]
  ) -> [WatchDashboardCard] {
    var merged = baseCards
    for card in cachedCards {
      if let index = merged.firstIndex(where: { $0.metricKey == card.metricKey }) {
        merged[index] = card
      } else {
        merged.append(card)
      }
    }
    return merged
  }

  private static func currentLocalDayCards(
    _ cards: [WatchDashboardCard],
    now: Date,
    calendar: Calendar
  ) -> [WatchDashboardCard] {
    cards.filter { card in
      guard card.metricKey == .steps,
        let refreshedAt = card.freshness?.refreshedAt
      else {
        return true
      }
      return calendar.isDate(refreshedAt, inSameDayAs: now)
    }
  }
}
