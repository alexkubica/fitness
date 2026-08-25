import XCTest

@testable import FitnessCoach

final class WatchDashboardTests: XCTestCase {
  func testStepQueryRangeStartsAtBeginningOfLocalDay() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "Asia/Jerusalem"))
    let now = try date("2026-07-15T13:42:00+03:00")

    let range = WatchStepsHealthStore.queryRange(now: now, calendar: calendar)

    XCTAssertEqual(range.lowerBound, try date("2026-07-15T00:00:00+03:00"))
    XCTAssertEqual(range.upperBound, now)
  }

  func testStepQueryRangeUsesInjectedTimezoneAcrossDayBoundary() throws {
    let now = try date("2026-07-15T01:30:00+03:00")
    var jerusalem = Calendar(identifier: .gregorian)
    jerusalem.timeZone = try XCTUnwrap(TimeZone(identifier: "Asia/Jerusalem"))
    var losAngeles = Calendar(identifier: .gregorian)
    losAngeles.timeZone = try XCTUnwrap(TimeZone(identifier: "America/Los_Angeles"))

    let jerusalemRange = WatchStepsHealthStore.queryRange(now: now, calendar: jerusalem)
    let losAngelesRange = WatchStepsHealthStore.queryRange(now: now, calendar: losAngeles)

    XCTAssertEqual(jerusalemRange.lowerBound, try date("2026-07-15T00:00:00+03:00"))
    XCTAssertEqual(losAngelesRange.lowerBound, try date("2026-07-14T00:00:00-07:00"))
  }

  func testIntegerStepFormattingHasNoFractionalValue() {
    XCTAssertEqual(WatchStepFormatting.integer(12_345), "12,345")
    XCTAssertFalse(WatchStepFormatting.integer(12_345).contains("."))
  }

  func testStepQueryUsesOneCumulativeTotalToAvoidDoubleCounting() {
    XCTAssertEqual(WatchStepsHealthStore.statisticsOptions, .cumulativeSum)
  }

  @MainActor
  func testPermissionDeniedCreatesPermissionRequiredCard() async {
    let provider = MockWatchStepProvider(outcomes: [.denied])
    provider.permission = .denied
    let model = makeModel(provider: provider)

    await model.prepare()

    XCTAssertEqual(model.permissionStatus, .denied)
    XCTAssertEqual(model.stepsCard?.state, .permissionRequired)
    XCTAssertTrue(model.stepsCard?.stateMessage?.contains("Health settings") == true)
  }

  @MainActor
  func testHealthDataUnavailableCreatesUnavailableCard() async {
    let provider = MockWatchStepProvider(outcomes: [.unavailable])
    provider.permission = .unavailable
    let model = makeModel(provider: provider)

    await model.prepare()

    XCTAssertEqual(model.permissionStatus, .unavailable)
    XCTAssertEqual(model.stepsCard?.state, .unavailable)
  }

  @MainActor
  func testEmptyStepResultDoesNotFakeZero() async {
    let provider = MockWatchStepProvider(outcomes: [.empty(permission: .requested)])
    let model = makeModel(provider: provider)

    await model.prepare()

    XCTAssertEqual(model.stepsCard?.state, .empty)
    XCTAssertNil(model.stepsCard?.rawValue)
    XCTAssertNil(model.stepsCard?.formattedValue)
  }

  @MainActor
  func testRefreshReadsAgainAndUpdatesValue() async throws {
    let first = try reading(steps: 1_200, refreshedAt: "2026-07-15T08:00:00+03:00")
    let second = try reading(steps: 2_450, refreshedAt: "2026-07-15T09:00:00+03:00")
    let provider = MockWatchStepProvider(outcomes: [.value(first), .value(second)])
    let model = makeModel(provider: provider)

    await model.prepare()
    await model.refreshSteps()

    XCTAssertEqual(provider.fetchCount, 2)
    XCTAssertEqual(model.stepsCard?.rawValue, 2_450)
    XCTAssertEqual(model.stepsCard?.formattedValue, "2,450")
  }

  @MainActor
  func testCachedStateLoadsImmediately() throws {
    let cached = try stepsCard(steps: 3_100, refreshedAt: "2026-07-15T07:00:00+03:00")
    let cache = MemoryWatchDashboardCache(
      snapshot: WatchDashboardSnapshot(
        cards: [cached],
        savedAt: try date("2026-07-15T07:00:00+03:00")
      ))

    let model = makeModel(provider: MockWatchStepProvider(outcomes: []), cache: cache)

    XCTAssertEqual(model.stepsCard?.rawValue, 3_100)
    XCTAssertEqual(model.stepsCard?.freshness?.isCached, true)
  }

  @MainActor
  func testNewHealthKitValueReplacesStaleCache() async throws {
    let cached = try stepsCard(steps: 1_000, refreshedAt: "2026-07-15T07:00:00+03:00")
    let live = try reading(steps: 1_800, refreshedAt: "2026-07-15T08:00:00+03:00")
    let cache = MemoryWatchDashboardCache(
      snapshot: WatchDashboardSnapshot(
        cards: [cached],
        savedAt: try date("2026-07-15T07:00:00+03:00")
      ))
    let model = makeModel(
      provider: MockWatchStepProvider(outcomes: [.value(live)]),
      cache: cache
    )

    await model.refreshSteps()

    XCTAssertEqual(model.stepsCard?.rawValue, 1_800)
    XCTAssertEqual(model.stepsCard?.freshness?.isCached, false)
  }

  @MainActor
  func testStaleCacheDoesNotReplaceNewerHealthKitValue() async throws {
    let live = try reading(steps: 4_000, refreshedAt: "2026-07-15T10:00:00+03:00")
    let model = makeModel(provider: MockWatchStepProvider(outcomes: [.value(live)]))
    await model.refreshSteps()

    let stale = try stepsCard(steps: 900, refreshedAt: "2026-07-15T06:00:00+03:00")
    model.applyCachedSnapshot(
      WatchDashboardSnapshot(
        cards: [stale],
        savedAt: try date("2026-07-15T06:00:00+03:00")
      ))

    XCTAssertEqual(model.stepsCard?.rawValue, 4_000)
    XCTAssertEqual(model.stepsCard?.freshness?.isCached, false)
  }

  @MainActor
  func testStepGoalCalculatesProgressAndRemaining() async throws {
    let live = try reading(steps: 7_500, refreshedAt: "2026-07-15T10:00:00+03:00")
    let goalStore = MemoryWatchStepGoalStore(stepGoal: 10_000)
    let model = makeModel(
      provider: MockWatchStepProvider(outcomes: [.value(live)]),
      goalStore: goalStore
    )

    await model.refreshSteps()

    XCTAssertEqual(model.stepsCard?.goal, 10_000)
    XCTAssertEqual(model.stepsCard?.progress, 0.75)
    XCTAssertEqual(model.stepsCard?.remainingValue, 2_500)
  }

  @MainActor
  func testIPhoneDashboardSnapshotAddsPublishedMetrics() throws {
    let model = makeModel(provider: MockWatchStepProvider(outcomes: []))
    let snapshot = HealthDashboardSnapshot.ready(
      metrics: [
        HealthDashboardMetric(
          metricName: "steps",
          title: "Steps",
          valueText: "8,420",
          caption: "Today",
          detailText: "7D avg 7,850",
          systemImage: "figure.walk",
          accentColorName: .lime,
          sortOrder: 1
        ),
        HealthDashboardMetric(
          metricName: "heart_rate",
          title: "Heart",
          valueText: "72 bpm",
          caption: "Latest",
          detailText: nil,
          systemImage: "waveform.path.ecg",
          accentColorName: .orange,
          sortOrder: 2
        ),
        HealthDashboardMetric(
          metricName: "protein",
          title: "Protein",
          valueText: "128 g",
          caption: "Latest",
          detailText: nil,
          systemImage: "fish",
          accentColorName: .lime,
          sortOrder: 3
        ),
      ],
      now: try date("2026-07-15T11:00:00+03:00")
    )

    model.applyDashboardSnapshot(snapshot)

    XCTAssertEqual(model.stepsCard?.formattedValue, "8,420")
    XCTAssertEqual(model.card(.heartRate)?.formattedValue, "72 bpm")
    XCTAssertEqual(model.card(.protein)?.formattedValue, "128 g")
    XCTAssertEqual(model.card(.heartRate)?.freshness?.source, .local)
  }

  @MainActor
  func testIPhoneDashboardSnapshotDoesNotReplaceLiveWatchSteps() async throws {
    let live = try reading(steps: 4_000, refreshedAt: "2026-07-15T10:00:00+03:00")
    let model = makeModel(provider: MockWatchStepProvider(outcomes: [.value(live)]))

    await model.refreshSteps()
    model.applyDashboardSnapshot(
      HealthDashboardSnapshot.ready(
        metrics: [
          HealthDashboardMetric(
            metricName: "steps",
            title: "Steps",
            valueText: "8,420",
            caption: "Today",
            detailText: nil,
            systemImage: "figure.walk",
            accentColorName: .lime,
            sortOrder: 1
          ),
        ],
        now: try date("2026-07-15T11:00:00+03:00")
      ))

    XCTAssertEqual(model.stepsCard?.rawValue, 4_000)
    XCTAssertEqual(model.stepsCard?.formattedValue, "4,000")
    XCTAssertEqual(model.stepsCard?.freshness?.source, .healthKit)
  }

  @MainActor
  func testPlaceholderCardsAreExplicitlyUnavailable() {
    let model = makeModel(provider: MockWatchStepProvider(outcomes: []))
    let placeholders = model.cards.filter { $0.metricKey != .steps }

    XCTAssertEqual(placeholders.count, 12)
    XCTAssertTrue(placeholders.allSatisfy { $0.state == .unavailable })
    XCTAssertTrue(placeholders.allSatisfy { $0.rawValue == nil })
  }

  private func date(_ value: String) throws -> Date {
    let formatter = ISO8601DateFormatter()
    return try XCTUnwrap(formatter.date(from: value))
  }

  private func reading(steps: Int, refreshedAt: String) throws -> WatchStepReading {
    let refreshedAt = try date(refreshedAt)
    return WatchStepReading(
      steps: steps,
      startDate: Calendar.current.startOfDay(for: refreshedAt),
      endDate: refreshedAt,
      refreshedAt: refreshedAt
    )
  }

  private func stepsCard(steps: Int, refreshedAt: String) throws -> WatchDashboardCard {
    WatchDashboardCard(
      id: WatchDashboardCard.stableID(for: .steps),
      metricKey: .steps,
      label: "Steps",
      rawValue: Double(steps),
      formattedValue: WatchStepFormatting.integer(steps),
      unit: "steps",
      goal: nil,
      progress: nil,
      remainingValue: nil,
      freshness: WatchDashboardFreshness(
        refreshedAt: try date(refreshedAt),
        source: .healthKit,
        isCached: false,
        isStale: false
      ),
      state: .content,
      stateMessage: nil,
      action: nil
    )
  }

  @MainActor
  private func makeModel(
    provider: MockWatchStepProvider,
    cache: MemoryWatchDashboardCache = MemoryWatchDashboardCache(),
    goalStore: MemoryWatchStepGoalStore = MemoryWatchStepGoalStore()
  ) -> WatchDashboardViewModel {
    WatchDashboardViewModel(
      stepProvider: provider,
      cache: cache,
      goalStore: goalStore,
      calendarProvider: { Calendar(identifier: .gregorian) },
      now: { Date(timeIntervalSince1970: 1_784_106_000) }
    )
  }
}

@MainActor
private final class MockWatchStepProvider: WatchStepHealthProviding {
  var permission: WatchHealthPermissionStatus = .requested
  var outcomes: [WatchStepFetchOutcome]
  private(set) var fetchCount = 0

  init(outcomes: [WatchStepFetchOutcome]) {
    self.outcomes = outcomes
  }

  func permissionStatus() async -> WatchHealthPermissionStatus {
    permission
  }

  func requestPermission() async -> WatchHealthPermissionStatus {
    permission
  }

  func fetchCurrentDaySteps(now: Date, calendar: Calendar) async throws -> WatchStepFetchOutcome {
    fetchCount += 1
    return outcomes.isEmpty ? .empty(permission: permission) : outcomes.removeFirst()
  }

  func startBackgroundUpdates(
    onUpdate: @MainActor @escaping () async -> Void
  ) async throws {}
}

private final class MemoryWatchDashboardCache: WatchDashboardCaching {
  var snapshot: WatchDashboardSnapshot?

  init(snapshot: WatchDashboardSnapshot? = nil) {
    self.snapshot = snapshot
  }

  func load() -> WatchDashboardSnapshot? {
    snapshot
  }

  func save(_ snapshot: WatchDashboardSnapshot) {
    self.snapshot = snapshot
  }
}

private final class MemoryWatchStepGoalStore: WatchStepGoalStoring {
  var stepGoal: Int?

  init(stepGoal: Int? = nil) {
    self.stepGoal = stepGoal
  }
}

extension WatchDashboardViewModel {
  fileprivate var stepsCard: WatchDashboardCard? {
    cards.first(where: { $0.metricKey == .steps })
  }

  fileprivate func card(_ key: WatchDashboardMetricKey) -> WatchDashboardCard? {
    cards.first(where: { $0.metricKey == key })
  }
}
