import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

struct StepSnapshot: Codable, Equatable, Sendable {
    enum State: String, Codable, Sendable {
        case ready
        case noData
        case permissionNeeded
        case failed
    }

    static let schemaVersion = 1

    let schemaVersion: Int
    let state: State
    let stepCount: Int?
    let sevenDayAverage: Int?
    let localDate: String
    let timezoneIdentifier: String
    let sourceDate: Date?
    let updatedAt: Date
    let message: String?

    init(
        state: State,
        stepCount: Int?,
        sevenDayAverage: Int?,
        localDate: String,
        timezoneIdentifier: String,
        sourceDate: Date?,
        updatedAt: Date,
        message: String? = nil,
        schemaVersion: Int = StepSnapshot.schemaVersion
    ) {
        self.schemaVersion = schemaVersion
        self.state = state
        self.stepCount = stepCount.map { max(0, $0) }
        self.sevenDayAverage = sevenDayAverage.map { max(0, $0) }
        self.localDate = localDate
        self.timezoneIdentifier = timezoneIdentifier
        self.sourceDate = sourceDate
        self.updatedAt = updatedAt
        self.message = message
    }

    static func permissionNeeded(now: Date = Date(), timeZone: TimeZone = .current) -> StepSnapshot {
        StepSnapshot(
            state: .permissionNeeded,
            stepCount: nil,
            sevenDayAverage: nil,
            localDate: localDateString(for: now, timeZone: timeZone),
            timezoneIdentifier: timeZone.identifier,
            sourceDate: nil,
            updatedAt: now,
            message: "Open iPhone app"
        )
    }

    static func noData(now: Date = Date(), timeZone: TimeZone = .current) -> StepSnapshot {
        StepSnapshot(
            state: .noData,
            stepCount: nil,
            sevenDayAverage: nil,
            localDate: localDateString(for: now, timeZone: timeZone),
            timezoneIdentifier: timeZone.identifier,
            sourceDate: nil,
            updatedAt: now,
            message: "No local steps"
        )
    }

    static func failed(now: Date = Date(), timeZone: TimeZone = .current) -> StepSnapshot {
        StepSnapshot(
            state: .failed,
            stepCount: nil,
            sevenDayAverage: nil,
            localDate: localDateString(for: now, timeZone: timeZone),
            timezoneIdentifier: timeZone.identifier,
            sourceDate: nil,
            updatedAt: now,
            message: "Open iPhone app"
        )
    }

    static var placeholder: StepSnapshot {
        let now = Date(timeIntervalSince1970: 1_800_000_000)

        return StepSnapshot(
            state: .ready,
            stepCount: 8_420,
            sevenDayAverage: 7_850,
            localDate: localDateString(for: now),
            timezoneIdentifier: TimeZone.current.identifier,
            sourceDate: now,
            updatedAt: now
        )
    }

    var valueText: String {
        guard state == .ready,
              let stepCount else {
            switch state {
            case .ready, .noData:
                return "No data"
            case .permissionNeeded:
                return "Open app"
            case .failed:
                return "Unavailable"
            }
        }

        return Self.formatCount(stepCount)
    }

    var captionText: String {
        switch state {
        case .ready:
            if isCurrentLocalDay() {
                return "Today"
            }

            if let sourceDate {
                return "Latest \(sourceDate.formatted(.dateTime.month(.abbreviated).day()))"
            }

            return "Latest"
        case .noData:
            return message ?? "No local steps"
        case .permissionNeeded:
            return "Health permission needed"
        case .failed:
            return message ?? "Open iPhone app"
        }
    }

    var detailText: String? {
        guard let sevenDayAverage,
              state == .ready else {
            return nil
        }

        return "7D avg \(Self.formatCount(sevenDayAverage))"
    }

    var updatedText: String {
        updatedAt.formatted(.dateTime.hour().minute())
    }

    var accessibilityText: String {
        [
            "Steps",
            valueText,
            captionText,
            detailText,
        ]
        .compactMap { $0 }
        .joined(separator: ", ")
    }

    func applying(to payload: inout [String: Any]) {
        payload[StepSnapshotPayloadKey.schemaVersion] = schemaVersion
        payload[StepSnapshotPayloadKey.state] = state.rawValue
        payload[StepSnapshotPayloadKey.localDate] = localDate
        payload[StepSnapshotPayloadKey.timezoneIdentifier] = timezoneIdentifier
        payload[StepSnapshotPayloadKey.updatedAt] = Self.isoDateFormatter.string(from: updatedAt)

        if let stepCount {
            payload[StepSnapshotPayloadKey.stepCount] = stepCount
        }

        if let sevenDayAverage {
            payload[StepSnapshotPayloadKey.sevenDayAverage] = sevenDayAverage
        }

        if let sourceDate {
            payload[StepSnapshotPayloadKey.sourceDate] = Self.isoDateFormatter.string(from: sourceDate)
        }

        if let message {
            payload[StepSnapshotPayloadKey.message] = message
        }
    }

    static func fromPayload(_ payload: [String: Any]) -> StepSnapshot? {
        guard let stateText = payload[StepSnapshotPayloadKey.state] as? String,
              let state = State(rawValue: stateText),
              let localDate = payload[StepSnapshotPayloadKey.localDate] as? String,
              let timezoneIdentifier = payload[StepSnapshotPayloadKey.timezoneIdentifier] as? String,
              let updatedAtText = payload[StepSnapshotPayloadKey.updatedAt] as? String,
              let updatedAt = isoDateFormatter.date(from: updatedAtText) else {
            return nil
        }

        return StepSnapshot(
            state: state,
            stepCount: intValue(payload[StepSnapshotPayloadKey.stepCount]),
            sevenDayAverage: intValue(payload[StepSnapshotPayloadKey.sevenDayAverage]),
            localDate: localDate,
            timezoneIdentifier: timezoneIdentifier,
            sourceDate: (payload[StepSnapshotPayloadKey.sourceDate] as? String).flatMap {
                isoDateFormatter.date(from: $0)
            },
            updatedAt: updatedAt,
            message: payload[StepSnapshotPayloadKey.message] as? String,
            schemaVersion: intValue(payload[StepSnapshotPayloadKey.schemaVersion]) ?? StepSnapshot.schemaVersion
        )
    }

    static func localDateString(for date: Date, timeZone: TimeZone = .current) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let components = calendar.dateComponents([.year, .month, .day], from: date)

        return String(
            format: "%04d-%02d-%02d",
            components.year ?? 0,
            components.month ?? 0,
            components.day ?? 0
        )
    }

    private func isCurrentLocalDay(now: Date = Date()) -> Bool {
        let timeZone = TimeZone(identifier: timezoneIdentifier) ?? .current

        return localDate == Self.localDateString(for: now, timeZone: timeZone)
    }

    private static func formatCount(_ value: Int) -> String {
        value.formatted(.number.precision(.fractionLength(0)))
    }

    private static func intValue(_ value: Any?) -> Int? {
        if let value = value as? Int {
            return value
        }

        if let value = value as? NSNumber {
            return value.intValue
        }

        return nil
    }

    private static var isoDateFormatter: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }
}

enum StepSnapshotStore {
    static let appGroupIdentifier = "group.com.alexkubica.fitnesscoach"
    static let defaultsKey = "FitnessCoach.StepSnapshot.v1"
    static let widgetKind = "FitnessCoachStepsWidget"

    static func load(
        defaults: UserDefaults? = UserDefaults(suiteName: appGroupIdentifier)
    ) -> StepSnapshot? {
        guard let data = defaults?.data(forKey: defaultsKey) else {
            return nil
        }

        return try? JSONDecoder().decode(StepSnapshot.self, from: data)
    }

    static func save(
        _ snapshot: StepSnapshot,
        defaults: UserDefaults? = UserDefaults(suiteName: appGroupIdentifier)
    ) {
        guard let data = try? JSONEncoder().encode(snapshot) else {
            return
        }

        defaults?.set(data, forKey: defaultsKey)
    }
}

enum StepSnapshotPayloadKey {
    static let schemaVersion = "steps.schemaVersion"
    static let state = "steps.state"
    static let stepCount = "steps.count"
    static let sevenDayAverage = "steps.sevenDayAverage"
    static let localDate = "steps.localDate"
    static let timezoneIdentifier = "steps.timezoneIdentifier"
    static let sourceDate = "steps.sourceDate"
    static let updatedAt = "steps.updatedAt"
    static let message = "steps.message"
}

enum FitnessCoachDeepLink {
    static let scheme = "fitnesscoach"
    static let metricHost = "metric"
    static let actionHost = "action"

    static func metricURL(metricName: String) -> URL? {
        guard !metricName.isEmpty else {
            return nil
        }

        var components = URLComponents()
        components.scheme = scheme
        components.host = metricHost
        components.path = "/\(metricName)"

        return components.url
    }

    static func metricName(from url: URL) -> String? {
        guard url.scheme == scheme,
              url.host == metricHost else {
            return nil
        }

        if let metricName = url.pathComponents.dropFirst().first,
           !metricName.isEmpty {
            return metricName
        }

        return URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first { $0.name == "name" }?
            .value
    }

    static func actionURL(_ action: String) -> URL? {
        guard !action.isEmpty else {
            return nil
        }

        var components = URLComponents()
        components.scheme = scheme
        components.host = actionHost
        components.path = "/\(action)"

        return components.url
    }

    static func actionName(from url: URL) -> String? {
        guard url.scheme == scheme,
              url.host == actionHost else {
            return nil
        }

        return url.pathComponents.dropFirst().first
    }
}

struct HealthDashboardSnapshot: Codable, Equatable, Sendable {
    enum State: String, Codable, Sendable {
        case ready
        case noData
        case permissionNeeded
        case failed
    }

    static let schemaVersion = 1

    let schemaVersion: Int
    let state: State
    let metrics: [HealthDashboardMetric]
    let localDate: String
    let timezoneIdentifier: String
    let updatedAt: Date
    let message: String?

    init(
        state: State,
        metrics: [HealthDashboardMetric],
        localDate: String,
        timezoneIdentifier: String,
        updatedAt: Date,
        message: String? = nil,
        schemaVersion: Int = HealthDashboardSnapshot.schemaVersion
    ) {
        self.schemaVersion = schemaVersion
        self.state = state
        self.metrics = metrics.sorted { lhs, rhs in
            if lhs.sortOrder == rhs.sortOrder {
                return lhs.metricName < rhs.metricName
            }

            return lhs.sortOrder < rhs.sortOrder
        }
        self.localDate = localDate
        self.timezoneIdentifier = timezoneIdentifier
        self.updatedAt = updatedAt
        self.message = message
    }

    static func ready(
        metrics: [HealthDashboardMetric],
        now: Date = Date(),
        timeZone: TimeZone = .current
    ) -> HealthDashboardSnapshot {
        HealthDashboardSnapshot(
            state: metrics.isEmpty ? .noData : .ready,
            metrics: metrics,
            localDate: StepSnapshot.localDateString(for: now, timeZone: timeZone),
            timezoneIdentifier: timeZone.identifier,
            updatedAt: now,
            message: metrics.isEmpty ? "No local metrics" : nil
        )
    }

    static func permissionNeeded(
        now: Date = Date(),
        timeZone: TimeZone = .current
    ) -> HealthDashboardSnapshot {
        HealthDashboardSnapshot(
            state: .permissionNeeded,
            metrics: [],
            localDate: StepSnapshot.localDateString(for: now, timeZone: timeZone),
            timezoneIdentifier: timeZone.identifier,
            updatedAt: now,
            message: "Open iPhone app"
        )
    }

    static func failed(
        now: Date = Date(),
        timeZone: TimeZone = .current
    ) -> HealthDashboardSnapshot {
        HealthDashboardSnapshot(
            state: .failed,
            metrics: [],
            localDate: StepSnapshot.localDateString(for: now, timeZone: timeZone),
            timezoneIdentifier: timeZone.identifier,
            updatedAt: now,
            message: "Open iPhone app"
        )
    }

    static var placeholder: HealthDashboardSnapshot {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let metrics = [
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
                metricName: "active_energy",
                title: "Active",
                valueText: "620 kcal",
                caption: "1W avg",
                detailText: "Today 540 kcal",
                systemImage: "flame.fill",
                accentColorName: .orange,
                sortOrder: 2
            ),
            HealthDashboardMetric(
                metricName: "sleep",
                title: "Sleep",
                valueText: "7h 18m",
                caption: "1W avg",
                detailText: "Today 6h 54m",
                systemImage: "bed.double.fill",
                accentColorName: .cyan,
                sortOrder: 3
            ),
            HealthDashboardMetric(
                metricName: "weight",
                title: "Weight",
                valueText: "84.2 kg",
                caption: "Latest",
                detailText: "-0.8 kg vs 1W",
                systemImage: "scalemass",
                accentColorName: .lime,
                sortOrder: 4
            ),
            HealthDashboardMetric(
                metricName: "heart_rate",
                title: "Heart",
                valueText: "72 bpm",
                caption: "Latest",
                detailText: nil,
                systemImage: "waveform.path.ecg",
                accentColorName: .orange,
                sortOrder: 5
            ),
            HealthDashboardMetric(
                metricName: "protein",
                title: "Protein",
                valueText: "128 g",
                caption: "Latest",
                detailText: nil,
                systemImage: "fish",
                accentColorName: .lime,
                sortOrder: 6
            ),
        ]

        return HealthDashboardSnapshot(
            state: .ready,
            metrics: metrics,
            localDate: StepSnapshot.localDateString(for: now),
            timezoneIdentifier: TimeZone.current.identifier,
            updatedAt: now
        )
    }

    var primaryMetric: HealthDashboardMetric? {
        metrics.first { $0.metricName == "steps" } ?? metrics.first
    }

    var statusText: String {
        switch state {
        case .ready:
            return "Updated \(updatedAt.formatted(.dateTime.hour().minute()))"
        case .noData:
            return message ?? "No local metrics"
        case .permissionNeeded:
            return "Open iPhone app"
        case .failed:
            return message ?? "Unavailable"
        }
    }

    func applying(to payload: inout [String: Any]) {
        guard let data = try? JSONEncoder().encode(self) else {
            return
        }

        payload[HealthDashboardSnapshotPayloadKey.data] = data
    }

    static func fromPayload(_ payload: [String: Any]) -> HealthDashboardSnapshot? {
        let data: Data?

        if let payloadData = payload[HealthDashboardSnapshotPayloadKey.data] as? Data {
            data = payloadData
        } else if let encoded = payload[HealthDashboardSnapshotPayloadKey.data] as? String {
            data = Data(base64Encoded: encoded)
        } else {
            data = nil
        }

        guard let data else {
            return nil
        }

        return try? JSONDecoder().decode(HealthDashboardSnapshot.self, from: data)
    }
}

struct HealthDashboardMetric: Codable, Equatable, Identifiable, Sendable {
    enum AccentColorName: String, Codable, Sendable {
        case lime
        case orange
        case cyan
        case violet
        case neutral
    }

    let metricName: String
    let title: String
    let valueText: String
    let caption: String
    let detailText: String?
    let systemImage: String
    let accentColorName: AccentColorName
    let sortOrder: Int

    var id: String { metricName }

    var accessibilityText: String {
        [
            title,
            valueText,
            caption,
            detailText,
        ]
        .compactMap { $0 }
        .joined(separator: ", ")
    }
}

enum HealthDashboardSnapshotStore {
    static let defaultsKey = "FitnessCoach.HealthDashboardSnapshot.v1"
    static let widgetKind = StepSnapshotStore.widgetKind

    static func load(
        defaults: UserDefaults? = UserDefaults(suiteName: StepSnapshotStore.appGroupIdentifier)
    ) -> HealthDashboardSnapshot? {
        guard let data = defaults?.data(forKey: defaultsKey) else {
            return nil
        }

        return try? JSONDecoder().decode(HealthDashboardSnapshot.self, from: data)
    }

    static func save(
        _ snapshot: HealthDashboardSnapshot,
        defaults: UserDefaults? = UserDefaults(suiteName: StepSnapshotStore.appGroupIdentifier)
    ) {
        guard let data = try? JSONEncoder().encode(snapshot) else {
            return
        }

        defaults?.set(data, forKey: defaultsKey)
    }
}

enum HealthDashboardSnapshotPayloadKey {
    static let data = "dashboard.snapshotData"
}

struct NutritionCoachSnapshot: Codable, Equatable, Sendable {
    static let schemaVersion = 1

    let schemaVersion: Int
    let localDate: String
    let timezoneIdentifier: String
    let actualCalories: Int
    let calorieTarget: Int?
    let actualProtein: Int
    let proteinTarget: Int?
    let nextPlannedMealTitle: String?
    let nextPlannedMealTime: String?
    let latestHunger: Int?
    let quickAction: String
    let updatedAt: Date

    init(
        localDate: String,
        timezoneIdentifier: String,
        actualCalories: Int,
        calorieTarget: Int?,
        actualProtein: Int,
        proteinTarget: Int?,
        nextPlannedMealTitle: String?,
        nextPlannedMealTime: String?,
        latestHunger: Int?,
        quickAction: String,
        updatedAt: Date,
        schemaVersion: Int = NutritionCoachSnapshot.schemaVersion
    ) {
        self.schemaVersion = schemaVersion
        self.localDate = localDate
        self.timezoneIdentifier = timezoneIdentifier
        self.actualCalories = max(0, actualCalories)
        self.calorieTarget = calorieTarget.map { max(0, $0) }
        self.actualProtein = max(0, actualProtein)
        self.proteinTarget = proteinTarget.map { max(0, $0) }
        self.nextPlannedMealTitle = nextPlannedMealTitle
        self.nextPlannedMealTime = nextPlannedMealTime
        self.latestHunger = latestHunger.map { min(10, max(0, $0)) }
        self.quickAction = quickAction
        self.updatedAt = updatedAt
    }

    static var placeholder: NutritionCoachSnapshot {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        return NutritionCoachSnapshot(
            localDate: StepSnapshot.localDateString(for: now),
            timezoneIdentifier: TimeZone.current.identifier,
            actualCalories: 860,
            calorieTarget: 2_100,
            actualProtein: 74,
            proteinTarget: 155,
            nextPlannedMealTitle: "Snack",
            nextPlannedMealTime: "17:00",
            latestHunger: 6,
            quickAction: "checkin",
            updatedAt: now
        )
    }

    var calorieText: String {
        targetText(actual: actualCalories, target: calorieTarget, unit: "kcal")
    }

    var proteinText: String {
        targetText(actual: actualProtein, target: proteinTarget, unit: "g")
    }

    var nextMealText: String {
        guard let nextPlannedMealTitle else {
            return "No plan"
        }
        if let nextPlannedMealTime {
            return "\(nextPlannedMealTitle) \(nextPlannedMealTime)"
        }
        return nextPlannedMealTitle
    }

    var hungerText: String {
        latestHunger.map { "Hunger \($0)/10" } ?? "Check in"
    }

    var statusText: String {
        "Updated \(updatedAt.formatted(.dateTime.hour().minute()))"
    }

    var quickActionURL: URL? {
        FitnessCoachDeepLink.actionURL(quickAction)
    }

    func applying(to payload: inout [String: Any]) {
        guard let data = try? JSONEncoder().encode(self) else {
            return
        }

        payload[NutritionCoachSnapshotPayloadKey.data] = data
    }

    static func fromPayload(_ payload: [String: Any]) -> NutritionCoachSnapshot? {
        let data: Data?
        if let payloadData = payload[NutritionCoachSnapshotPayloadKey.data] as? Data {
            data = payloadData
        } else if let encoded = payload[NutritionCoachSnapshotPayloadKey.data] as? String {
            data = Data(base64Encoded: encoded)
        } else {
            data = nil
        }
        guard let data else {
            return nil
        }
        return try? JSONDecoder().decode(NutritionCoachSnapshot.self, from: data)
    }

    private func targetText(actual: Int, target: Int?, unit: String) -> String {
        guard let target, target > 0 else {
            return "\(actual.formatted(.number)) \(unit)"
        }

        return "\(actual.formatted(.number)) / \(target.formatted(.number)) \(unit)"
    }
}

enum NutritionCoachSnapshotStore {
    static let defaultsKey = "FitnessCoach.NutritionCoachSnapshot.v1"

    static func load(
        defaults: UserDefaults? = UserDefaults(suiteName: StepSnapshotStore.appGroupIdentifier)
    ) -> NutritionCoachSnapshot? {
        guard let data = defaults?.data(forKey: defaultsKey) else {
            return nil
        }

        return try? JSONDecoder().decode(NutritionCoachSnapshot.self, from: data)
    }

    static func save(
        _ snapshot: NutritionCoachSnapshot,
        defaults: UserDefaults? = UserDefaults(suiteName: StepSnapshotStore.appGroupIdentifier)
    ) {
        guard let data = try? JSONEncoder().encode(snapshot) else {
            return
        }

        defaults?.set(data, forKey: defaultsKey)
    }
}

enum NutritionCoachSnapshotPayloadKey {
    static let data = "nutrition.snapshotData"
}

#if canImport(ActivityKit)
struct FitnessCoachSyncActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        let title: String
        let detail: String
        let progressFraction: Double?
        let updatedAt: Date
        let state: String
    }

    let source: String
}
#endif
