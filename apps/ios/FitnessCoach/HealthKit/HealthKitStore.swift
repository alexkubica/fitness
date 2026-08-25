import BackgroundTasks
import Foundation
import HealthKit
import UIKit

struct HealthKitMetricDescriptor: Equatable, Identifiable {
    let metricName: String
    let normalizedUnit: String
    let quantityIdentifier: HKQuantityTypeIdentifier?
    let categoryIdentifier: HKCategoryTypeIdentifier?
    let unit: HKUnit

    var id: String { metricName }

    var objectType: HKObjectType? {
        if let quantityIdentifier {
            return HKObjectType.quantityType(forIdentifier: quantityIdentifier)
        }

        if let categoryIdentifier {
            return HKObjectType.categoryType(forIdentifier: categoryIdentifier)
        }

        return nil
    }

    var sampleType: HKSampleType? {
        objectType as? HKSampleType
    }
}

enum HealthKitAuthorizationSummary: Equatable {
    case unavailable
    case notRequested
    case requested
    case failed(String)

    var displayText: String {
        switch self {
        case .unavailable:
            return "Health data is unavailable on this device."
        case .notRequested:
            return "Health permissions have not been requested."
        case .requested:
            return "Health permissions requested. Apple controls per-metric status visibility."
        case .failed(let message):
            return "Health permission request failed: \(message)"
        }
    }
}

enum BodyMassSyncResult: Equatable {
    case completed(samples: Int, deleted: Int, upload: HealthMetricUploadResult)
    case healthDataUnavailable
    case missingBodyMassType
    case failed(String)
}

struct HealthKitMetricSyncSummary: Equatable, Identifiable {
    let metricName: String
    let samples: Int
    let deleted: Int

    var id: String { metricName }
}

struct HealthMetricChartPoint: Equatable, Identifiable {
    let date: Date
    let value: Double
    let unit: String

    var id: Date { date }
}

enum HealthKitSyncResult: Equatable {
    case completed(metrics: [HealthKitMetricSyncSummary], upload: HealthMetricUploadResult)
    case healthDataUnavailable
    case alreadyRunning
    case failed(String)
}

extension HealthKitSyncResult {
    var requiresGoogleSignIn: Bool {
        switch self {
        case .failed(let message):
            return message.localizedCaseInsensitiveContains("Sign in with Google")
        case .completed, .healthDataUnavailable, .alreadyRunning:
            return false
        }
    }
}

enum HealthKitProtectedData {
    static let unavailableMessage =
        "Protected Health data is inaccessible. Unlock the iPhone and try sync again."
}

struct HealthKitNutritionWritebackResult: Equatable {
    let localDate: String
    let sampleCount: Int

    var displayText: String {
        "Wrote \(sampleCount) nutrition values to Apple Health for \(localDate)."
    }
}

enum HealthKitSyncProgress: Equatable {
    case reading
    case uploading(HealthMetricUploadProgress)
    case planning(HealthKitSyncPlanProgress)
    case readingOverall(HealthKitSyncProgressContext)
    case uploadingOverall(HealthKitSyncProgressContext, HealthMetricUploadProgress)

    var title: String {
        switch self {
        case .reading:
            return "Syncing Health Deltas"
        case .uploading:
            return "Uploading HealthKit data"
        case .planning, .readingOverall, .uploadingOverall:
            return "Syncing Apple Health"
        }
    }

    var detailText: String {
        switch self {
        case .reading:
            return "Reading Apple Health data..."
        case .uploading(let progress):
            return "\(progress.percentComplete)% • \(Self.formatCount(progress.uploadedSamples)) / \(Self.formatCount(progress.totalSamples)) samples"
        case .planning(let progress):
            return progress.primaryText
        case .readingOverall(let context):
            return context.primaryText
        case .uploadingOverall(let context, _):
            return context.primaryText
        }
    }

    var secondaryText: String? {
        switch self {
        case .reading, .uploading:
            return nil
        case .planning(let progress):
            return progress.secondaryText
        case .readingOverall(let context), .uploadingOverall(let context, _):
            return context.overallText
        }
    }

    var etaText: String? {
        switch self {
        case .reading, .planning, .readingOverall:
            return nil
        case .uploading(let progress):
            guard let seconds = progress.estimatedRemainingSeconds else {
                return progress.uploadedSamples < progress.totalSamples ? "ETA: calculating..." : nil
            }

            return "ETA: \(Self.formatEta(seconds))"
        case .uploadingOverall(let context, _):
            guard let seconds = context.estimatedRemainingSeconds else {
                return context.uploadedItems < (context.totalItems ?? 0) ? "ETA: calculating..." : nil
            }

            return "ETA: \(Self.formatEta(seconds))"
        }
    }

    var fractionCompleted: Double? {
        switch self {
        case .reading, .planning, .readingOverall:
            return nil
        case .uploading(let progress):
            guard progress.totalSamples > 0 else {
                return nil
            }

            return min(1, Double(progress.uploadedSamples) / Double(progress.totalSamples))
        case .uploadingOverall(let context, _):
            return context.fractionCompleted
        }
    }

    var accessibilityText: String {
        switch self {
        case .reading:
            return "Syncing Health Deltas, reading Apple Health data"
        case .uploading(let progress):
            let baseText = "Uploading HealthKit data, \(progress.percentComplete) percent, \(Self.formatCount(progress.uploadedSamples)) of \(Self.formatCount(progress.totalSamples)) samples"

            guard let seconds = progress.estimatedRemainingSeconds else {
                return "\(baseText), estimated time remaining is calculating"
            }

            return "\(baseText), \(Self.formatEtaForAccessibility(seconds)) left"
        case .planning(let progress):
            return "Syncing Apple Health, planning upload, \(progress.accessibilityText)"
        case .readingOverall(let context):
            return "Syncing Apple Health, reading, \(context.accessibilityText)"
        case .uploadingOverall(let context, _):
            return "Syncing Apple Health, \(context.accessibilityText)"
        }
    }

    private static func formatCount(_ value: Int) -> String {
        value.formatted(.number)
    }

    private static func formatEta(_ seconds: TimeInterval) -> String {
        if seconds < 60 {
            return "less than 1 min"
        }

        let minutes = max(1, Int((seconds / 60).rounded(.up)))

        return "about \(minutes) min"
    }

    private static func formatEtaForAccessibility(_ seconds: TimeInterval) -> String {
        if seconds < 60 {
            return "less than 1 minute"
        }

        let minutes = max(1, Int((seconds / 60).rounded(.up)))

        return "about \(minutes) minutes"
    }
}

struct HealthKitSyncPlanProgress: Equatable, Sendable {
    let metricName: String?
    let plannedItems: Int
    let readDeleted: Int

    var primaryText: String {
        if let metricName {
            return "Planning \(displayMetricName(metricName))"
        }

        return "Calculating upload size"
    }

    var secondaryText: String {
        "\(Self.formatCount(plannedItems)) daily rows ready"
    }

    var accessibilityText: String {
        "\(Self.formatCount(plannedItems)) daily rows ready"
    }

    private func displayMetricName(_ metricName: String) -> String {
        metricName.replacingOccurrences(of: "_", with: " ")
    }

    private static func formatCount(_ value: Int) -> String {
        value.formatted(.number)
    }
}

struct HealthKitSyncProgressContext: Equatable, Sendable {
    let readSamples: Int
    let readDeleted: Int
    let uploadedItems: Int
    let totalItems: Int?
    let startedAt: Date?
    let updatedAt: Date?

    init(
        readSamples: Int,
        readDeleted: Int,
        uploadedItems: Int,
        totalItems: Int? = nil,
        startedAt: Date? = nil,
        updatedAt: Date? = nil
    ) {
        self.readSamples = readSamples
        self.readDeleted = readDeleted
        self.uploadedItems = uploadedItems
        self.totalItems = totalItems
        self.startedAt = startedAt
        self.updatedAt = updatedAt
    }

    var primaryText: String {
        if let totalItems, totalItems > 0 {
            return "\(percentComplete)% • \(Self.formatCount(uploadedItems)) / \(Self.formatCount(totalItems)) daily rows"
        }

        if uploadedItems > 0 {
            return "\(Self.formatCount(uploadedItems)) daily rows synced"
        }

        if readSamples > 0 || readDeleted > 0 {
            return "\(Self.formatCount(readSamples)) daily rows ready"
        }

        return "Reading Apple Health data..."
    }

    var overallText: String {
        if let totalItems {
            return "\(Self.formatCount(totalItems)) daily rows planned"
        }

        return "\(Self.formatCount(readSamples)) daily rows ready"
    }

    var accessibilityText: String {
        if let totalItems {
            return "\(percentComplete) percent, \(Self.formatCount(uploadedItems)) of \(Self.formatCount(totalItems)) daily rows synced"
        }

        return "\(Self.formatCount(uploadedItems)) daily rows synced, \(Self.formatCount(readSamples)) daily rows ready"
    }

    var percentComplete: Int {
        guard let totalItems, totalItems > 0 else {
            return 0
        }

        return min(100, Int((Double(uploadedItems) / Double(totalItems) * 100).rounded()))
    }

    var fractionCompleted: Double? {
        guard let totalItems, totalItems > 0 else {
            return nil
        }

        return min(1, Double(uploadedItems) / Double(totalItems))
    }

    var estimatedRemainingSeconds: TimeInterval? {
        guard let totalItems,
              totalItems > 0,
              uploadedItems > 0,
              uploadedItems < totalItems,
              let startedAt,
              let updatedAt else {
            return nil
        }

        let elapsedSeconds = max(0, updatedAt.timeIntervalSince(startedAt))

        guard elapsedSeconds > 0 else {
            return nil
        }

        let itemsPerSecond = Double(uploadedItems) / elapsedSeconds

        guard itemsPerSecond > 0 else {
            return nil
        }

        return Double(totalItems - uploadedItems) / itemsPerSecond
    }

    private static func formatCount(_ value: Int) -> String {
        value.formatted(.number)
    }
}

enum HealthKitBackgroundDeliveryError: LocalizedError, Sendable {
    case enableFailed(metricName: String)

    var errorDescription: String? {
        switch self {
        case .enableFailed(let metricName):
            return "HealthKit background delivery could not be enabled for \(metricName)."
        }
    }
}

enum HealthKitStatisticsError: LocalizedError, Sendable {
    case missingResults

    var errorDescription: String? {
        switch self {
        case .missingResults:
            return "HealthKit statistics query did not return results."
        }
    }
}

@MainActor
final class HealthKitStore: ObservableObject {
    nonisolated static let dailyAggregateAnchorNamespace =
        "FitnessCoach.HealthKit.DailyAggregateAnchor.v2"
    nonisolated static let readAuthorizationRequestedDefaultsKey =
        "FitnessCoach.HealthKit.ReadAuthorizationRequested"
    nonisolated static let readAuthorizationDescriptorSignatureDefaultsKey =
        "FitnessCoach.HealthKit.ReadAuthorizationDescriptorSignature"
    nonisolated static let appleHealthDailySource = "apple_health_daily"

    static let firstSliceReadDescriptors: [HealthKitMetricDescriptor] = [
        HealthKitMetricDescriptor(
            metricName: "weight",
            normalizedUnit: "kg",
            quantityIdentifier: .bodyMass,
            categoryIdentifier: nil,
            unit: HKUnit.gramUnit(with: .kilo)
        ),
        HealthKitMetricDescriptor(
            metricName: "steps",
            normalizedUnit: "count",
            quantityIdentifier: .stepCount,
            categoryIdentifier: nil,
            unit: .count()
        ),
        HealthKitMetricDescriptor(
            metricName: "active_energy",
            normalizedUnit: "kcal",
            quantityIdentifier: .activeEnergyBurned,
            categoryIdentifier: nil,
            unit: .kilocalorie()
        ),
        HealthKitMetricDescriptor(
            metricName: "resting_energy",
            normalizedUnit: "kcal",
            quantityIdentifier: .basalEnergyBurned,
            categoryIdentifier: nil,
            unit: .kilocalorie()
        ),
        HealthKitMetricDescriptor(
            metricName: "sleep",
            normalizedUnit: "minute",
            quantityIdentifier: nil,
            categoryIdentifier: .sleepAnalysis,
            unit: .minute()
        ),
        HealthKitMetricDescriptor(
            metricName: "heart_rate",
            normalizedUnit: "bpm",
            quantityIdentifier: .heartRate,
            categoryIdentifier: nil,
            unit: HKUnit.count().unitDivided(by: .minute())
        ),
        HealthKitMetricDescriptor(
            metricName: "resting_heart_rate",
            normalizedUnit: "bpm",
            quantityIdentifier: .restingHeartRate,
            categoryIdentifier: nil,
            unit: HKUnit.count().unitDivided(by: .minute())
        ),
        HealthKitMetricDescriptor(
            metricName: "walking_heart_rate",
            normalizedUnit: "bpm",
            quantityIdentifier: .walkingHeartRateAverage,
            categoryIdentifier: nil,
            unit: HKUnit.count().unitDivided(by: .minute())
        ),
        HealthKitMetricDescriptor(
            metricName: "dietary_energy",
            normalizedUnit: "kcal",
            quantityIdentifier: .dietaryEnergyConsumed,
            categoryIdentifier: nil,
            unit: .kilocalorie()
        ),
        HealthKitMetricDescriptor(
            metricName: "protein",
            normalizedUnit: "g",
            quantityIdentifier: .dietaryProtein,
            categoryIdentifier: nil,
            unit: .gram()
        ),
        HealthKitMetricDescriptor(
            metricName: "carbs",
            normalizedUnit: "g",
            quantityIdentifier: .dietaryCarbohydrates,
            categoryIdentifier: nil,
            unit: .gram()
        ),
        HealthKitMetricDescriptor(
            metricName: "fat",
            normalizedUnit: "g",
            quantityIdentifier: .dietaryFatTotal,
            categoryIdentifier: nil,
            unit: .gram()
        ),
        HealthKitMetricDescriptor(
            metricName: "fiber",
            normalizedUnit: "g",
            quantityIdentifier: .dietaryFiber,
            categoryIdentifier: nil,
            unit: .gram()
        ),
    ]

    static let writeTypesForFirstSlice: [HKSampleType] = []
    static var nutritionWriteDescriptors: [HealthKitMetricDescriptor] {
        firstSliceReadDescriptors.filter {
            ["dietary_energy", "protein", "carbs", "fat", "fiber"].contains($0.metricName)
        }
    }
    static var nutritionWriteTypes: [HKSampleType] {
        nutritionWriteDescriptors.compactMap(\.sampleType)
    }
    static let readAuthorizationDescriptorSignature =
        firstSliceReadDescriptors.map(\.metricName).joined(separator: ",")
    nonisolated static let backgroundDeliveryFrequency: HKUpdateFrequency = .hourly
    nonisolated static let backgroundProcessingTaskIdentifier =
        "com.alexkubica.fitnesscoach.healthkit-sync"
    nonisolated static let lastSuccessfulSyncAtDefaultsKey =
        "FitnessCoach.HealthKit.LastSuccessfulSyncAt"
    nonisolated static let anchoredQueryPageLimit = 25_000
    nonisolated static let observerBackgroundPageBudget = 1
    nonisolated static let scheduledBackgroundPageBudget = 3
    nonisolated static let fullHistoryStatisticsStartDate = Date(timeIntervalSince1970: 1_262_304_000)
    static var backgroundDeliveryMetricNames: [String] {
        firstSliceReadDescriptors.map(\.metricName)
    }

    @Published private(set) var authorizationSummary: HealthKitAuthorizationSummary
    @Published private(set) var lastSyncResult: HealthKitSyncResult?
    @Published private(set) var lastBodyMassSyncResult: BodyMassSyncResult?
    @Published private(set) var syncProgress: HealthKitSyncProgress?
    @Published private(set) var lastSuccessfulSyncAt: Date?

    private let healthStore: HKHealthStore
    private let anchorStore: HealthKitAnchorStore
    private let authorizationDefaults: UserDefaults
    private let syncSessionManager: HealthSyncSessionManager
    private let syncNotifier: HealthSyncNotifier
    private var backgroundObserverQueries: [String: HKObserverQuery] = [:]
    private var backgroundDeliveryConfigured = false
    private static var syncInProgress = false

    init(
        healthStore: HKHealthStore = HKHealthStore(),
        anchorStore: HealthKitAnchorStore = UserDefaultsHealthKitAnchorStore(),
        authorizationDefaults: UserDefaults = .standard,
        syncSessionManager: HealthSyncSessionManager = HealthSyncSessionManager(),
        syncNotifier: HealthSyncNotifier = HealthSyncNotifier()
    ) {
        self.healthStore = healthStore
        self.anchorStore = anchorStore
        self.authorizationDefaults = authorizationDefaults
        self.syncSessionManager = syncSessionManager
        self.syncNotifier = syncNotifier

        try? syncSessionManager.bootstrapFromEnvironment()

        if !HKHealthStore.isHealthDataAvailable() {
            authorizationSummary = .unavailable
        } else if Self.hasCurrentReadAuthorizationRequest(in: authorizationDefaults) {
            authorizationSummary = .requested
        } else {
            authorizationSummary = .notRequested
        }

        if let lastSuccessfulSyncSeconds = authorizationDefaults.object(
            forKey: Self.lastSuccessfulSyncAtDefaultsKey
        ) as? Double {
            lastSuccessfulSyncAt = Date(timeIntervalSince1970: lastSuccessfulSyncSeconds)
        }
    }

    func requestReadAuthorization() async {
        guard HKHealthStore.isHealthDataAvailable() else {
            authorizationSummary = .unavailable
            return
        }

        let readTypes = Set(Self.firstSliceReadDescriptors.compactMap(\.objectType))

        do {
            try await healthStore.requestAuthorization(
                toShare: Set(Self.writeTypesForFirstSlice),
                read: readTypes
            )
            authorizationDefaults.set(true, forKey: Self.readAuthorizationRequestedDefaultsKey)
            authorizationDefaults.set(
                Self.readAuthorizationDescriptorSignature,
                forKey: Self.readAuthorizationDescriptorSignatureDefaultsKey
            )
            authorizationSummary = .requested
            await startBackgroundDelivery()
        } catch {
            authorizationSummary = .failed(error.localizedDescription)
        }
    }

    func clearSignInRequiredSyncFailure() {
        guard lastSyncResult?.requiresGoogleSignIn == true else {
            return
        }

        lastSyncResult = nil
    }

    func startBackgroundDelivery() async {
        guard HKHealthStore.isHealthDataAvailable(),
              Self.hasCurrentReadAuthorizationRequest(in: authorizationDefaults),
              !backgroundDeliveryConfigured else {
            return
        }

        backgroundDeliveryConfigured = true

        for descriptor in Self.firstSliceReadDescriptors {
            guard let sampleType = descriptor.sampleType else {
                continue
            }

            observeBackgroundUpdates(for: descriptor, sampleType: sampleType)

            do {
                try await enableBackgroundDelivery(
                    for: descriptor,
                    sampleType: sampleType
                )
            } catch {
                lastSyncResult = .failed(error.localizedDescription)
            }
        }
    }

    func writeNutritionTotalsToAppleHealth(
        _ totals: MacroTotals,
        on date: Date,
        calendar: Calendar = .current
    ) async throws -> HealthKitNutritionWritebackResult {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitNutritionWritebackError.healthDataUnavailable
        }

        let valuesByMetric = Self.nutritionWriteValues(from: totals)
        guard !valuesByMetric.isEmpty else {
            throw HealthKitNutritionWritebackError.noNutritionValues
        }

        let writableDescriptors = Self.nutritionWriteDescriptors.filter {
            valuesByMetric[$0.metricName] != nil
        }
        let writeTypes = Set(writableDescriptors.compactMap(\.sampleType))

        guard writeTypes.count == writableDescriptors.count else {
            throw HealthKitNutritionWritebackError.missingHealthKitTypes
        }

        try await healthStore.requestAuthorization(toShare: writeTypes, read: [])

        let dayStart = calendar.startOfDay(for: date)
        let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart)
            ?? dayStart.addingTimeInterval(24 * 60 * 60)
        let localDate = Self.localDateString(dayStart, calendar: calendar)
        let syncVersion = Int(Date().timeIntervalSince1970)
        var samples: [HKQuantitySample] = []

        for descriptor in writableDescriptors {
            guard let value = valuesByMetric[descriptor.metricName],
                  let quantityType = descriptor.sampleType as? HKQuantityType else {
                continue
            }

            let syncIdentifier = Self.nutritionWritebackSyncIdentifier(
                metricName: descriptor.metricName,
                localDate: localDate
            )

            try await deleteNutritionWritebackSamples(
                quantityType: quantityType,
                syncIdentifier: syncIdentifier
            )

            samples.append(
                HKQuantitySample(
                    type: quantityType,
                    quantity: HKQuantity(unit: descriptor.unit, doubleValue: value),
                    start: dayStart,
                    end: dayEnd,
                    metadata: [
                        HKMetadataKeySyncIdentifier: syncIdentifier,
                        HKMetadataKeySyncVersion: syncVersion,
                        "FitnessCoachSource": "meal_log_day_writeback_v1",
                        "FitnessCoachLocalDate": localDate,
                    ]
                )
            )
        }

        guard !samples.isEmpty else {
            throw HealthKitNutritionWritebackError.noNutritionValues
        }

        try await saveNutritionWritebackSamples(samples)

        return HealthKitNutritionWritebackResult(
            localDate: localDate,
            sampleCount: samples.count
        )
    }

    func syncBodyMassDeltas(
        uploader: HealthMetricUploader? = nil
    ) async {
        do {
            lastBodyMassSyncResult = try await syncBodyMassDeltasThrowing(
                uploader: try await resolvedUploader(uploader)
            )
        } catch {
            lastBodyMassSyncResult = .failed(error.localizedDescription)
        }
    }

    func metricChartPoints(
        for descriptor: HealthKitMetricDescriptor,
        days: Int = 90,
        now: Date = Date()
    ) async throws -> [HealthMetricChartPoint] {
#if DEBUG
        if let debugPoints = Self.debugMetricChartPointsIfNeeded(
            for: descriptor,
            days: days,
            now: now
        ) {
            return debugPoints
        }
#endif

        guard HKHealthStore.isHealthDataAvailable(),
              let sampleType = descriptor.sampleType else {
            return []
        }

        let calendar = Calendar.current
        let end = now
        let start = calendar.date(
            byAdding: .day,
            value: -max(1, days),
            to: calendar.startOfDay(for: now)
        ) ?? now.addingTimeInterval(TimeInterval(-max(1, days) * 24 * 60 * 60))
        let dailySamples: [HealthMetricUploadSample]

        if let quantityType = sampleType as? HKQuantityType,
           Self.dailyStatisticsAggregation(for: descriptor) != nil,
           descriptor.metricName != "weight" {
            dailySamples = try await dailyStatisticsUploadSamples(
                for: Self.dailyBuckets(from: start, to: end, timezone: .current),
                quantityType: quantityType,
                descriptor: descriptor
            )
        } else {
            let queryStart = descriptor.metricName == "sleep"
                ? start.addingTimeInterval(-24 * 60 * 60)
                : start
            let samples = try await samplesForRange(
                sampleType: sampleType,
                start: queryStart,
                end: end
            )
            dailySamples = await Self.dailyUploadSamplesAsync(
                from: samples,
                descriptor: descriptor
            )
        }

        return dailySamples
            .filter { $0.startTime >= start }
            .map {
                HealthMetricChartPoint(
                    date: $0.startTime,
                    value: $0.value,
                    unit: $0.unit
                )
            }
    }

#if DEBUG
    private static func debugMetricChartPointsIfNeeded(
        for descriptor: HealthKitMetricDescriptor,
        days: Int,
        now: Date,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> [HealthMetricChartPoint]? {
        guard environment["FITNESS_UI_TEST_MODE"] == "1",
              environment["FITNESS_UI_TEST_CHART_DATA"] == "1" else {
            return nil
        }

        let calendar = Calendar.current
        let count = min(max(days, 30), 120)
        let start = calendar.date(
            byAdding: .day,
            value: -(count - 1),
            to: calendar.startOfDay(for: now)
        ) ?? now

        return (0..<count).map { offset in
            let date = calendar.date(
                byAdding: .day,
                value: offset,
                to: start
            ) ?? start

            return HealthMetricChartPoint(
                date: date,
                value: Self.debugMetricChartValue(
                    for: descriptor,
                    offset: offset
                ),
                unit: descriptor.normalizedUnit
            )
        }
    }

    private static func debugMetricChartValue(
        for descriptor: HealthKitMetricDescriptor,
        offset: Int
    ) -> Double {
        switch descriptor.metricName {
        case "weight":
            return 90 - (Double(offset) * 0.035)
                + sin(Double(offset) / 4) * 0.18
        case "steps":
            return 9_000 + (Double(offset % 7) * 650)
                + sin(Double(offset) / 5) * 900
        case "sleep":
            return 420 + sin(Double(offset) / 3) * 45
        case "heart_rate", "resting_heart_rate", "walking_heart_rate":
            return 68 + sin(Double(offset) / 6) * 4
        case "active_energy":
            return 650 + (Double(offset % 6) * 45)
        case "resting_energy":
            return 2_050 + sin(Double(offset) / 8) * 55
        default:
            return Double(offset)
        }
    }
#endif

    func syncFirstSliceDeltas(
        uploader: HealthMetricUploader? = nil
    ) async {
#if DEBUG
        if await runDebugSyncScenarioIfNeeded() {
            return
        }
#endif

        HealthKitBackgroundProcessingScheduler.scheduleSoon()
        guard !Self.syncInProgress else {
            lastSyncResult = .alreadyRunning
            return
        }

        Self.syncInProgress = true
        let backgroundTask = HealthKitExtendedRuntimeTask.begin(
            name: "FitnessCoach HealthKit Sync"
        )
        syncProgress = .reading
        defer {
            Self.syncInProgress = false
            backgroundTask.end()
            syncProgress = nil
            HealthKitBackgroundProcessingScheduler.scheduleSoon()
        }

        do {
            let syncStartedAt = Date()

            await syncNotifier.notifySyncStarted()
            let result = try await syncFirstSliceDeltasThrowing(
                uploader: try await resolvedUploader(uploader)
            )
            lastSyncResult = result
            recordSuccessfulSyncIfNeeded(result)
            await syncNotifier.notifySyncFinished(result, startedAt: syncStartedAt)
        } catch {
            let result = HealthKitSyncResult.failed(error.localizedDescription)

            lastSyncResult = result
            await syncNotifier.notifySyncFinished(result)
        }
    }

    private func observeBackgroundUpdates(
        for descriptor: HealthKitMetricDescriptor,
        sampleType: HKSampleType
    ) {
        guard backgroundObserverQueries[descriptor.metricName] == nil else {
            return
        }

        let query = HKObserverQuery(
            sampleType: sampleType,
            predicate: nil
        ) { [weak self] _, completionHandler, error in
            guard error == nil else {
                completionHandler()
                return
            }

            let observerCompletion = HealthKitObserverCompletion(completionHandler)

            Task { @MainActor [weak self] in
                guard let self else {
                    observerCompletion.call()
                    return
                }

                await self.runBackgroundSync(
                    completion: observerCompletion,
                    preferredMetricName: descriptor.metricName
                )
            }
        }

        backgroundObserverQueries[descriptor.metricName] = query
        healthStore.execute(query)
    }

    private func enableBackgroundDelivery(
        for descriptor: HealthKitMetricDescriptor,
        sampleType: HKSampleType
    ) async throws {
        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Void, Error>) in
            healthStore.enableBackgroundDelivery(
                for: sampleType,
                frequency: Self.backgroundDeliveryFrequency
            ) { success, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                guard success else {
                    continuation.resume(
                        throwing: HealthKitBackgroundDeliveryError.enableFailed(
                            metricName: descriptor.metricName
                        )
                    )
                    return
                }

                continuation.resume()
            }
        }
    }

    private func runBackgroundSync(
        completion: HealthKitObserverCompletion,
        preferredMetricName: String
    ) async {
        guard !Self.syncInProgress else {
            completion.call()
            return
        }

        Self.syncInProgress = true
        defer {
            Self.syncInProgress = false
            completion.call()
            HealthKitBackgroundProcessingScheduler.scheduleSoon()
        }

        do {
            let syncStartedAt = Date()
            let result = try await syncFirstSliceDeltasThrowing(
                uploader: try await resolvedUploader(nil),
                maxPages: Self.observerBackgroundPageBudget,
                preferredMetricName: preferredMetricName
            )
            lastSyncResult = result
            recordSuccessfulSyncIfNeeded(result)
            await syncNotifier.notifySyncFinished(result, startedAt: syncStartedAt)
        } catch {
            let result = HealthKitSyncResult.failed(error.localizedDescription)

            lastSyncResult = result
            await syncNotifier.notifySyncFinished(result)
        }
    }

    func runScheduledBackgroundSync() async {
        await startBackgroundDelivery()

        guard !Self.syncInProgress else {
            return
        }

        Self.syncInProgress = true
        defer {
            Self.syncInProgress = false
            HealthKitBackgroundProcessingScheduler.scheduleSoon()
        }

        do {
            let syncStartedAt = Date()
            let result = try await syncFirstSliceDeltasThrowing(
                uploader: try await resolvedUploader(nil),
                maxPages: Self.scheduledBackgroundPageBudget
            )
            lastSyncResult = result
            recordSuccessfulSyncIfNeeded(result)
            await syncNotifier.notifySyncFinished(result, startedAt: syncStartedAt)
        } catch {
            let result = HealthKitSyncResult.failed(error.localizedDescription)

            lastSyncResult = result
            await syncNotifier.notifySyncFinished(result)
        }
    }

    private func recordSuccessfulSyncIfNeeded(
        _ result: HealthKitSyncResult,
        now: Date = Date()
    ) {
        guard case .completed = result else {
            return
        }

        lastSuccessfulSyncAt = now
        authorizationDefaults.set(
            now.timeIntervalSince1970,
            forKey: Self.lastSuccessfulSyncAtDefaultsKey
        )
    }

    static func hasCurrentReadAuthorizationRequest(
        in defaults: UserDefaults
    ) -> Bool {
        defaults.bool(forKey: Self.readAuthorizationRequestedDefaultsKey)
            && defaults.string(
                forKey: Self.readAuthorizationDescriptorSignatureDefaultsKey
            ) == Self.readAuthorizationDescriptorSignature
    }

    private func resolvedUploader(_ uploader: HealthMetricUploader?) async throws
        -> HealthMetricUploader {
        if let uploader {
            return uploader
        }

        return try await syncSessionManager.uploader()
    }

#if DEBUG
    private func runDebugSyncScenarioIfNeeded(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) async -> Bool {
        guard let scenario = environment["FITNESS_UI_TEST_SYNC_SCENARIO"] else {
            return false
        }

        guard environment["FITNESS_UI_TEST_MODE"] == "1" else {
            lastSyncResult = .failed("Debug sync scenario requires UI test mode.")
            return true
        }

#if targetEnvironment(simulator)
        syncProgress = .planning(
            HealthKitSyncPlanProgress(
                metricName: nil,
                plannedItems: 0,
                readDeleted: 0
            )
        )

        try? await Task.sleep(nanoseconds: 150_000_000)

        switch scenario {
        case "progress":
            let updatedAt = Date()

            syncProgress = .uploadingOverall(
                HealthKitSyncProgressContext(
                    readSamples: 37_250,
                    readDeleted: 0,
                    uploadedItems: 12_500,
                    totalItems: 37_250,
                    startedAt: updatedAt.addingTimeInterval(-60),
                    updatedAt: updatedAt
                ),
                HealthMetricUploadProgress(
                    uploadedSamples: 12_500,
                    totalSamples: 37_250,
                    completedChunks: 50,
                    totalChunks: 149,
                    startedAt: updatedAt.addingTimeInterval(-60),
                    updatedAt: updatedAt
                )
            )
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            lastSyncResult = .completed(
                metrics: [
                    HealthKitMetricSyncSummary(
                        metricName: "steps",
                        samples: 37_250,
                        deleted: 0
                    ),
                ],
                upload: .uploaded(count: 37_250)
            )
            syncProgress = nil
            return true
        case "failure":
            syncProgress = nil
            lastSyncResult = .failed("Simulated sync failure.")
            return true
        default:
            syncProgress = nil
            lastSyncResult = .failed("Unknown debug sync scenario.")
            return true
        }
#else
        lastSyncResult = .failed("Debug sync scenario is only available on Simulator.")
        return true
#endif
    }
#endif

    func syncFirstSliceDeltasThrowing(
        uploader: HealthMetricUploader,
        now: Date = Date(),
        maxPages: Int? = nil,
        preferredMetricName: String? = nil
    ) async throws -> HealthKitSyncResult {
        guard HKHealthStore.isHealthDataAvailable() else {
            syncProgress = nil
            return .healthDataUnavailable
        }

        guard UIApplication.shared.isProtectedDataAvailable else {
            syncProgress = nil
            return .failed(HealthKitProtectedData.unavailableMessage)
        }

        var plans: [HealthKitMetricUploadPlan] = []
        var summaries: [HealthKitMetricSyncSummary] = []
        var plannedSamples = 0
        var readDeleted = 0
        var processedPages = 0

        for descriptor in Self.syncDescriptors(preferredMetricName: preferredMetricName) {
            if Self.didReachPageBudget(maxPages, processedPages: processedPages) {
                break
            }

            guard let sampleType = descriptor.sampleType else {
                continue
            }

            var descriptorTotals = HealthKitDescriptorSyncTotals(
                metricName: descriptor.metricName
            )
            let descriptorAnchorKey = anchorKey(for: descriptor)
            let startingAnchor = anchorStore.loadAnchor(for: descriptorAnchorKey)
            var pageAnchor = startingAnchor
            let canUseFullHistoryStatistics = Self.shouldUseFullHistoryStatisticsPlan(
                for: descriptor,
                startingAnchor: startingAnchor
            )
            var collectedSamples: [HKSample] = []
            var collectedDeletedObjectIds: [UUID] = []
            var finalAnchor: HKQueryAnchor?
            var reachedDescriptorEnd = false

            while true {
                if Self.didReachPageBudget(maxPages, processedPages: processedPages) {
                    break
                }

                try Task.checkCancellation()
                syncProgress = .planning(
                    HealthKitSyncPlanProgress(
                        metricName: descriptor.metricName,
                        plannedItems: plannedSamples,
                        readDeleted: readDeleted
                    )
                )

                let queryResult = try await anchoredSamples(
                    sampleType: sampleType,
                    anchor: pageAnchor,
                    now: now,
                    limit: Self.anchoredQueryPageLimit
                )

                if !canUseFullHistoryStatistics {
                    collectedSamples.append(contentsOf: queryResult.samples)
                }
                collectedDeletedObjectIds.append(
                    contentsOf: queryResult.deletedObjects.map(\.uuid)
                )

                if queryResult.resultCount > 0 {
                    processedPages += 1
                }

                pageAnchor = queryResult.newAnchor ?? pageAnchor

                if queryResult.resultCount < Self.anchoredQueryPageLimit {
                    finalAnchor = queryResult.newAnchor
                    reachedDescriptorEnd = true
                    break
                }

                await Task.yield()
            }

            guard reachedDescriptorEnd else {
                summaries.append(descriptorTotals.summary)
                continue
            }

            let descriptorSamples: [HealthMetricUploadSample]

            if canUseFullHistoryStatistics,
               let quantityType = sampleType as? HKQuantityType {
                descriptorSamples = try await fullHistoryStatisticsUploadSamples(
                    quantityType: quantityType,
                    descriptor: descriptor,
                    now: now
                )
            } else if startingAnchor == nil {
                descriptorSamples = try await dailyUploadSamplesForChangedSamples(
                    from: collectedSamples,
                    descriptor: descriptor,
                    sampleType: sampleType
                )
            } else {
                descriptorSamples = try await dailyUploadSamplesForAffectedDays(
                    from: collectedSamples,
                    descriptor: descriptor,
                    sampleType: sampleType
                )
            }

            descriptorTotals.samples += descriptorSamples.count
            descriptorTotals.deleted += collectedDeletedObjectIds.count
            plannedSamples += descriptorSamples.count
            readDeleted += collectedDeletedObjectIds.count
            summaries.append(descriptorTotals.summary)

            if let finalAnchor {
                plans.append(
                    HealthKitMetricUploadPlan(
                        metricName: descriptor.metricName,
                        anchorKey: descriptorAnchorKey,
                        finalAnchor: finalAnchor,
                        samples: descriptorSamples
                    )
                )
            }

            syncProgress = .planning(
                HealthKitSyncPlanProgress(
                    metricName: nil,
                    plannedItems: plannedSamples,
                    readDeleted: readDeleted
                )
            )
            await Task.yield()
        }

        let totalPlannedSamples = plannedSamples
        let totalDeleted = readDeleted
        var uploadedCount = 0
        var skippedResult: HealthMetricUploadResult?
        let uploadStartedAt = Date()

        for plan in plans {
            try Task.checkCancellation()

            let uploadId = currentOrCreatePageUploadId(for: plan.anchorKey)
            let uploadedCountBeforeMetric = uploadedCount
            syncProgress = .uploadingOverall(
                HealthKitSyncProgressContext(
                    readSamples: plannedSamples,
                    readDeleted: readDeleted,
                    uploadedItems: uploadedCount,
                    totalItems: totalPlannedSamples,
                    startedAt: uploadStartedAt,
                    updatedAt: Date()
                ),
                HealthMetricUploadProgress(
                    uploadedSamples: 0,
                    totalSamples: max(1, plannedSamples),
                    completedChunks: 0,
                    totalChunks: 1,
                    startedAt: uploadStartedAt,
                    updatedAt: Date()
                )
            )

            let uploadResult = try await uploader.uploadInChunks(
                samples: plan.samples,
                deletedSamples: [],
                idempotencyKey: Self.pageIdempotencyKey(
                    metricName: plan.metricName,
                    pageUploadId: uploadId
                ),
                progress: { [weak self] progress in
                    await MainActor.run {
                        self?.syncProgress = .uploadingOverall(
                            HealthKitSyncProgressContext(
                                readSamples: totalPlannedSamples,
                                readDeleted: totalDeleted,
                                uploadedItems: uploadedCountBeforeMetric + progress.uploadedSamples,
                                totalItems: totalPlannedSamples,
                                startedAt: uploadStartedAt,
                                updatedAt: progress.updatedAt
                            ),
                            progress
                        )
                    }
                }
            )

            switch uploadResult {
            case .uploaded(let count):
                uploadedCount += count
            case .skippedEmptyBatch:
                break
            case .skippedLiveHealthDataDisabled,
                 .skippedMissingBackendURL,
                 .skippedMissingAuthToken,
                 .skippedNonDisposableBackend:
                skippedResult = uploadResult
            }

            if uploadResult.shouldPersistHealthKitAnchors {
                anchorStore.saveAnchor(plan.finalAnchor, for: plan.anchorKey)
                clearPageUploadId(for: plan.anchorKey)
            }

            if skippedResult != nil {
                break
            }
        }

        return Self.finalSyncResult(
            metrics: summaries,
            uploadedCount: uploadedCount,
            skippedResult: skippedResult
        )
    }

    nonisolated static func finalSyncResult(
        metrics: [HealthKitMetricSyncSummary],
        uploadedCount: Int,
        skippedResult: HealthMetricUploadResult?
    ) -> HealthKitSyncResult {
        if let syncFailureText = skippedResult?.syncFailureText {
            return .failed(syncFailureText)
        }

        let uploadResult = skippedResult ?? (uploadedCount > 0
            ? .uploaded(count: uploadedCount)
            : .skippedEmptyBatch)

        return .completed(metrics: metrics, upload: uploadResult)
    }

    nonisolated static func dailyUploadSamples(
        from samples: [HKSample],
        descriptor: HealthKitMetricDescriptor,
        timezone: TimeZone = .current
    ) -> [HealthMetricUploadSample] {
        var valueGroups: [DailyHealthKitBucket: DailyValueAccumulator] = [:]
        var weightGroups: [DailyHealthKitBucket: DailyWeightAccumulator] = [:]

        for sample in samples {
            accumulateDailySample(
                sample,
                descriptor: descriptor,
                timezone: timezone,
                valueGroups: &valueGroups,
                weightGroups: &weightGroups
            )
        }

        return uploadSamples(
            valueGroups: valueGroups,
            weightGroups: weightGroups,
            descriptor: descriptor
        )
    }

    nonisolated private static func dailyUploadSamplesAsync(
        from samples: [HKSample],
        descriptor: HealthKitMetricDescriptor,
        timezone: TimeZone = .current
    ) async -> [HealthMetricUploadSample] {
        var valueGroups: [DailyHealthKitBucket: DailyValueAccumulator] = [:]
        var weightGroups: [DailyHealthKitBucket: DailyWeightAccumulator] = [:]

        for (index, sample) in samples.enumerated() {
            accumulateDailySample(
                sample,
                descriptor: descriptor,
                timezone: timezone,
                valueGroups: &valueGroups,
                weightGroups: &weightGroups
            )

            if index.isMultiple(of: 500) {
                await Task.yield()
            }
        }

        return uploadSamples(
            valueGroups: valueGroups,
            weightGroups: weightGroups,
            descriptor: descriptor
        )
    }

    nonisolated private static func accumulateDailySample(
        _ sample: HKSample,
        descriptor: HealthKitMetricDescriptor,
        timezone: TimeZone,
        valueGroups: inout [DailyHealthKitBucket: DailyValueAccumulator],
        weightGroups: inout [DailyHealthKitBucket: DailyWeightAccumulator]
    ) {
        if let quantitySample = sample as? HKQuantitySample,
           descriptor.quantityIdentifier != nil {
            let bucket = dailyBucket(
                for: quantitySample,
                descriptor: descriptor,
                timezone: timezone
            )
            let value = quantitySample.quantity.doubleValue(for: descriptor.unit)

            if descriptor.metricName == "weight" {
                var group = weightGroups[bucket] ?? DailyWeightAccumulator(
                    bucket: bucket
                )
                group.add(value: value, endDate: quantitySample.endDate)
                weightGroups[bucket] = group
                return
            }

            var group = valueGroups[bucket] ?? DailyValueAccumulator(
                bucket: bucket
            )
            group.add(value: value)
            valueGroups[bucket] = group
            return
        }

        if let categorySample = sample as? HKCategorySample,
           descriptor.categoryIdentifier == .sleepAnalysis,
           isAsleepSleepAnalysisValue(categorySample.value) {
            let bucket = dailyBucket(
                for: categorySample,
                descriptor: descriptor,
                timezone: timezone
            )
            var group = valueGroups[bucket] ?? DailyValueAccumulator(
                bucket: bucket
            )
            group.add(value: categorySample.endDate.timeIntervalSince(categorySample.startDate) / 60)
            valueGroups[bucket] = group
        }
    }

    nonisolated private static func uploadSamples(
        valueGroups: [DailyHealthKitBucket: DailyValueAccumulator],
        weightGroups: [DailyHealthKitBucket: DailyWeightAccumulator],
        descriptor: HealthKitMetricDescriptor
    ) -> [HealthMetricUploadSample] {
        let valueSamples = valueGroups.values.compactMap { group in
            group.uploadSample(
                descriptor: descriptor,
                aggregation: dailyAggregation(for: descriptor.metricName)
            )
        }
        let weightSamples = weightGroups.values.compactMap { group in
            group.uploadSample(descriptor: descriptor)
        }

        return (valueSamples + weightSamples).sorted {
            if $0.startTime == $1.startTime {
                return $0.sourceSampleId < $1.sourceSampleId
            }

            return $0.startTime < $1.startTime
        }
    }

    private func dailyUploadSamplesForChangedSamples(
        from samples: [HKSample],
        descriptor: HealthKitMetricDescriptor,
        sampleType: HKSampleType,
        timezone: TimeZone = .current
    ) async throws -> [HealthMetricUploadSample] {
        let buckets = Self.affectedDailyBuckets(
            from: samples,
            descriptor: descriptor,
            timezone: timezone
        )

        guard let quantityType = sampleType as? HKQuantityType,
              Self.dailyStatisticsAggregation(for: descriptor) != nil,
              descriptor.metricName != "weight" else {
            return await Self.dailyUploadSamplesAsync(
                from: samples,
                descriptor: descriptor,
                timezone: timezone
            )
        }

        return try await dailyStatisticsUploadSamples(
            for: buckets,
            quantityType: quantityType,
            descriptor: descriptor
        )
    }

    private func dailyUploadSamplesForAffectedDays(
        from samples: [HKSample],
        descriptor: HealthKitMetricDescriptor,
        sampleType: HKSampleType,
        timezone: TimeZone = .current
    ) async throws -> [HealthMetricUploadSample] {
        let buckets = Self.affectedDailyBuckets(
            from: samples,
            descriptor: descriptor,
            timezone: timezone
        )
        var uploadSamples: [HealthMetricUploadSample] = []

        if let quantityType = sampleType as? HKQuantityType,
           Self.dailyStatisticsAggregation(for: descriptor) != nil,
           descriptor.metricName != "weight" {
            return try await dailyStatisticsUploadSamples(
                for: buckets,
                quantityType: quantityType,
                descriptor: descriptor
            )
        }

        for bucket in buckets {
            let daySamples = try await samplesForDay(
                sampleType: sampleType,
                bucket: bucket
            )
            uploadSamples.append(
                contentsOf: await Self.dailyUploadSamplesAsync(
                    from: daySamples,
                    descriptor: descriptor,
                    timezone: timezone
                )
            )
            await Task.yield()
        }

        return Self.deduplicatedDailySamples(uploadSamples)
    }

    private func dailyStatisticsUploadSamples(
        for buckets: [DailyHealthKitBucket],
        quantityType: HKQuantityType,
        descriptor: HealthKitMetricDescriptor
    ) async throws -> [HealthMetricUploadSample] {
        guard !buckets.isEmpty,
              let aggregation = Self.dailyStatisticsAggregation(for: descriptor),
              let firstBucket = buckets.first,
              let lastBucket = buckets.last else {
            return []
        }

        let bucketDates = Set(buckets.map(\.dateString))
        let statistics = try await dailyStatisticsCollection(
            quantityType: quantityType,
            start: firstBucket.start,
            end: lastBucket.end,
            timezone: TimeZone(identifier: firstBucket.timezoneIdentifier) ?? .current,
            aggregation: aggregation
        )
        var uploadSamples: [HealthMetricUploadSample] = []

        statistics.enumerateStatistics(from: firstBucket.start, to: lastBucket.end) {
            statistic,
            _ in
            let bucket = Self.dailyBucket(
                forDayStarting: statistic.startDate,
                timezone: TimeZone(identifier: firstBucket.timezoneIdentifier) ?? .current
            )

            guard bucketDates.contains(bucket.dateString),
                  let quantity = statistic.quantity(for: aggregation) else {
                return
            }

            uploadSamples.append(
                HealthMetricUploadSample(
                    metricName: descriptor.metricName,
                    unit: descriptor.normalizedUnit,
                    value: roundToTwoDecimals(quantity.doubleValue(for: descriptor.unit)),
                    startTime: bucket.start,
                    endTime: bucket.end,
                    timezone: bucket.timezoneIdentifier,
                    source: Self.appleHealthDailySource,
                    sourceSampleId: bucket.sourceSampleId(metricName: descriptor.metricName)
                )
            )
        }

        return Self.deduplicatedDailySamples(uploadSamples)
    }

    nonisolated private static func affectedDailyBuckets(
        from samples: [HKSample],
        descriptor: HealthKitMetricDescriptor,
        timezone: TimeZone
    ) -> [DailyHealthKitBucket] {
        var bucketsByDate: [String: DailyHealthKitBucket] = [:]

        for sample in samples {
            let bucket = dailyBucket(
                for: sample,
                descriptor: descriptor,
                timezone: timezone
            )
            bucketsByDate[bucket.dateString] = bucket
        }

        return bucketsByDate.values.sorted {
            $0.start < $1.start
        }
    }

    nonisolated private static func dailyBucket(
        for sample: HKSample,
        descriptor: HealthKitMetricDescriptor,
        timezone: TimeZone
    ) -> DailyHealthKitBucket {
        let date = descriptor.metricName == "sleep" ? sample.endDate : sample.startDate
        var calendar = Calendar(identifier: .gregorian)

        calendar.timeZone = timezone

        let start = calendar.startOfDay(for: date)
        let end = calendar.date(byAdding: .day, value: 1, to: start) ?? start

        return DailyHealthKitBucket(
            dateString: dailyDateString(for: start, timezone: timezone),
            start: start,
            end: end,
            timezoneIdentifier: timezone.identifier
        )
    }

    nonisolated private static func dailyBucket(
        forDayStarting start: Date,
        timezone: TimeZone
    ) -> DailyHealthKitBucket {
        var calendar = Calendar(identifier: .gregorian)

        calendar.timeZone = timezone

        let dayStart = calendar.startOfDay(for: start)
        let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart) ?? dayStart

        return DailyHealthKitBucket(
            dateString: dailyDateString(for: dayStart, timezone: timezone),
            start: dayStart,
            end: dayEnd,
            timezoneIdentifier: timezone.identifier
        )
    }

    nonisolated private static func dailyBuckets(
        from start: Date,
        to end: Date,
        timezone: TimeZone
    ) -> [DailyHealthKitBucket] {
        var calendar = Calendar(identifier: .gregorian)

        calendar.timeZone = timezone

        var buckets: [DailyHealthKitBucket] = []
        var current = calendar.startOfDay(for: start)

        while current < end {
            let bucket = dailyBucket(forDayStarting: current, timezone: timezone)

            buckets.append(bucket)
            current = calendar.date(byAdding: .day, value: 1, to: current) ?? end
        }

        return buckets
    }

    nonisolated private static func dailyDateString(
        for date: Date,
        timezone: TimeZone
    ) -> String {
        let formatter = DateFormatter()

        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timezone
        formatter.dateFormat = "yyyy-MM-dd"

        return formatter.string(from: date)
    }

    nonisolated private static func dailyAggregation(
        for metricName: String
    ) -> DailyHealthMetricAggregation {
        switch metricName {
        case "steps",
             "active_energy",
             "resting_energy",
             "sleep",
             "dietary_energy",
             "protein",
             "carbs",
             "fat",
             "fiber":
            return .sum
        case "heart_rate", "resting_heart_rate", "walking_heart_rate":
            return .average
        case "weight":
            return .mode
        default:
            return .average
        }
    }

    nonisolated static func dailyStatisticsOptions(
        for descriptor: HealthKitMetricDescriptor
    ) -> HKStatisticsOptions? {
        dailyStatisticsAggregation(for: descriptor)?.statisticsOptions
    }

    nonisolated static func shouldUseFullHistoryStatisticsPlan(
        for descriptor: HealthKitMetricDescriptor,
        startingAnchor: HKQueryAnchor?
    ) -> Bool {
        startingAnchor == nil
            && descriptor.metricName != "weight"
            && dailyStatisticsAggregation(for: descriptor) != nil
            && descriptor.quantityIdentifier != nil
    }

    nonisolated private static func dailyStatisticsAggregation(
        for descriptor: HealthKitMetricDescriptor
    ) -> DailyHealthKitStatisticsAggregation? {
        switch descriptor.metricName {
        case "steps",
             "active_energy",
             "resting_energy",
             "dietary_energy",
             "protein",
             "carbs",
             "fat",
             "fiber":
            return .cumulativeSum
        case "heart_rate", "resting_heart_rate", "walking_heart_rate":
            return .discreteAverage
        case "weight", "sleep":
            return nil
        default:
            return nil
        }
    }

    private func fullHistoryStatisticsUploadSamples(
        quantityType: HKQuantityType,
        descriptor: HealthKitMetricDescriptor,
        now: Date
    ) async throws -> [HealthMetricUploadSample] {
        try await dailyStatisticsUploadSamples(
            for: Self.dailyBuckets(
                from: Self.fullHistoryStatisticsStartDate,
                to: now,
                timezone: .current
            ),
            quantityType: quantityType,
            descriptor: descriptor
        )
    }

    nonisolated private static func deduplicatedDailySamples(
        _ samples: [HealthMetricUploadSample]
    ) -> [HealthMetricUploadSample] {
        var samplesById: [String: HealthMetricUploadSample] = [:]

        for sample in samples {
            samplesById[sample.sourceSampleId] = sample
        }

        return samplesById.values.sorted {
            if $0.startTime == $1.startTime {
                return $0.sourceSampleId < $1.sourceSampleId
            }

            return $0.startTime < $1.startTime
        }
    }

    func syncBodyMassDeltasThrowing(
        uploader: HealthMetricUploader,
        now: Date = Date()
    ) async throws -> BodyMassSyncResult {
        guard HKHealthStore.isHealthDataAvailable() else {
            return .healthDataUnavailable
        }

        guard let bodyMassType = HKObjectType.quantityType(forIdentifier: .bodyMass) else {
            return .missingBodyMassType
        }

        let queryResult = try await anchoredBodyMassSamples(
            bodyMassType: bodyMassType,
            anchor: anchorStore.loadAnchor(for: bodyMassAnchorKey),
            now: now
        )
        let descriptor = HealthKitMetricDescriptor(
            metricName: "weight",
            normalizedUnit: "kg",
            quantityIdentifier: .bodyMass,
            categoryIdentifier: nil,
            unit: HKUnit.gramUnit(with: .kilo)
        )
        let uploadSamples = Self.dailyUploadSamples(
            from: queryResult.samples,
            descriptor: descriptor
        )
        let uploadResult = try await uploader.uploadInChunks(
            samples: uploadSamples,
            deletedSamples: [],
            idempotencyKey: "healthkit-daily-body-mass-\(ISO8601DateFormatter().string(from: Date()))"
        )

        if let newAnchor = queryResult.newAnchor,
           uploadResult.shouldPersistHealthKitAnchors {
            anchorStore.saveAnchor(newAnchor, for: bodyMassAnchorKey)
        }

        return .completed(
            samples: uploadSamples.count,
            deleted: queryResult.deletedObjects.count,
            upload: uploadResult
        )
    }

    private func anchoredBodyMassSamples(
        bodyMassType: HKQuantityType,
        anchor: HKQueryAnchor?,
        now: Date
    ) async throws -> AnchoredBodyMassResult {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<AnchoredBodyMassResult, Error>) in
            let query = HKAnchoredObjectQuery(
                type: bodyMassType,
                predicate: Self.anchoredQueryPredicate(anchor: anchor, now: now),
                anchor: anchor,
                limit: HKObjectQueryNoLimit
            ) { _, samples, deletedObjects, newAnchor, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                let quantitySamples = (samples ?? []).compactMap { $0 as? HKQuantitySample }
                continuation.resume(
                    returning: AnchoredBodyMassResult(
                        samples: quantitySamples,
                        deletedObjects: deletedObjects ?? [],
                        newAnchor: newAnchor
                    )
                )
            }

            healthStore.execute(query)
        }
    }

    private func samplesForDay(
        sampleType: HKSampleType,
        bucket: DailyHealthKitBucket
    ) async throws -> [HKSample] {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[HKSample], Error>) in
            let query = HKSampleQuery(
                sampleType: sampleType,
                predicate: HKQuery.predicateForSamples(
                    withStart: bucket.start,
                    end: bucket.end,
                    options: []
                ),
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                continuation.resume(returning: samples ?? [])
            }

            healthStore.execute(query)
        }
    }

    private func dailyStatisticsCollection(
        quantityType: HKQuantityType,
        start: Date,
        end: Date,
        timezone: TimeZone,
        aggregation: DailyHealthKitStatisticsAggregation
    ) async throws -> HKStatisticsCollection {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<HKStatisticsCollection, Error>) in
            var calendar = Calendar(identifier: .gregorian)
            var interval = DateComponents()

            calendar.timeZone = timezone
            interval.day = 1

            let query = HKStatisticsCollectionQuery(
                quantityType: quantityType,
                quantitySamplePredicate: HKQuery.predicateForSamples(
                    withStart: start,
                    end: end,
                    options: []
                ),
                options: aggregation.statisticsOptions,
                anchorDate: calendar.startOfDay(for: start),
                intervalComponents: interval
            )

            query.initialResultsHandler = { _, statistics, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let statistics else {
                    continuation.resume(
                        throwing: HealthKitStatisticsError.missingResults
                    )
                    return
                }

                continuation.resume(returning: statistics)
            }

            healthStore.execute(query)
        }
    }

    private func samplesForRange(
        sampleType: HKSampleType,
        start: Date,
        end: Date
    ) async throws -> [HKSample] {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[HKSample], Error>) in
            let query = HKSampleQuery(
                sampleType: sampleType,
                predicate: HKQuery.predicateForSamples(
                    withStart: start,
                    end: end,
                    options: []
                ),
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                continuation.resume(returning: samples ?? [])
            }

            healthStore.execute(query)
        }
    }

    private func anchoredSamples(
        sampleType: HKSampleType,
        anchor: HKQueryAnchor?,
        now: Date,
        limit: Int = HKObjectQueryNoLimit
    ) async throws -> AnchoredHealthKitResult {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<AnchoredHealthKitResult, Error>) in
            let query = HKAnchoredObjectQuery(
                type: sampleType,
                predicate: Self.anchoredQueryPredicate(anchor: anchor, now: now),
                anchor: anchor,
                limit: limit
            ) { _, samples, deletedObjects, newAnchor, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                continuation.resume(
                    returning: AnchoredHealthKitResult(
                        samples: samples ?? [],
                        deletedObjects: deletedObjects ?? [],
                        newAnchor: newAnchor
                    )
                )
            }

            healthStore.execute(query)
        }
    }

    static func anchoredQueryPredicate(anchor _: HKQueryAnchor?, now _: Date) -> NSPredicate? {
        nil
    }

    nonisolated static func pageIdempotencyKey(
        metricName: String,
        pageUploadId: String
    ) -> String {
        "healthkit-daily-\(metricName)-page-\(pageUploadId)"
    }

    nonisolated static func pageUploadDefaultsKey(for anchorKey: String) -> String {
        "\(anchorKey).PendingPageUploadId"
    }

    private static func didReachPageBudget(
        _ maxPages: Int?,
        processedPages: Int
    ) -> Bool {
        guard let maxPages else {
            return false
        }

        return processedPages >= max(0, maxPages)
    }

    private static func syncDescriptors(
        preferredMetricName: String?
    ) -> [HealthKitMetricDescriptor] {
        guard let preferredMetricName,
              let preferredDescriptor = firstSliceReadDescriptors.first(
                  where: { $0.metricName == preferredMetricName }
              ) else {
            return firstSliceReadDescriptors
        }

        return [preferredDescriptor] + firstSliceReadDescriptors.filter {
            $0.metricName != preferredMetricName
        }
    }

    private func currentOrCreatePageUploadId(for anchorKey: String) -> String {
        let key = Self.pageUploadDefaultsKey(for: anchorKey)

        if let existingValue = authorizationDefaults.string(forKey: key),
           !existingValue.isEmpty {
            return existingValue
        }

        let newValue = UUID().uuidString.lowercased()
        authorizationDefaults.set(newValue, forKey: key)

        return newValue
    }

    private func clearPageUploadId(for anchorKey: String) {
        authorizationDefaults.removeObject(forKey: Self.pageUploadDefaultsKey(for: anchorKey))
    }

    nonisolated private static func isAsleepSleepAnalysisValue(_ value: Int) -> Bool {
        let asleepValues = Set([
            1,
            HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
            HKCategoryValueSleepAnalysis.asleepCore.rawValue,
            HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
            HKCategoryValueSleepAnalysis.asleepREM.rawValue,
        ])

        return asleepValues.contains(value)
    }
}

private enum DailyHealthMetricAggregation {
    case average
    case mode
    case sum
}

private enum DailyHealthKitStatisticsAggregation {
    case cumulativeSum
    case discreteAverage

    var statisticsOptions: HKStatisticsOptions {
        switch self {
        case .cumulativeSum:
            return .cumulativeSum
        case .discreteAverage:
            return .discreteAverage
        }
    }
}

private extension HKStatistics {
    func quantity(
        for aggregation: DailyHealthKitStatisticsAggregation
    ) -> HKQuantity? {
        switch aggregation {
        case .cumulativeSum:
            return sumQuantity()
        case .discreteAverage:
            return averageQuantity()
        }
    }
}

private struct DailyHealthKitBucket: Hashable {
    let dateString: String
    let start: Date
    let end: Date
    let timezoneIdentifier: String

    func sourceSampleId(metricName: String) -> String {
        "apple-health-daily:\(metricName):\(dateString):\(safeTimezoneIdentifier)"
    }

    private var safeTimezoneIdentifier: String {
        timezoneIdentifier.replacingOccurrences(of: "/", with: "_")
    }
}

private struct DailyValueAccumulator {
    let bucket: DailyHealthKitBucket
    private(set) var total = 0.0
    private(set) var count = 0

    mutating func add(value: Double) {
        total += value
        count += 1
    }

    func uploadSample(
        descriptor: HealthKitMetricDescriptor,
        aggregation: DailyHealthMetricAggregation
    ) -> HealthMetricUploadSample? {
        guard count > 0 else {
            return nil
        }

        let value: Double

        switch aggregation {
        case .average:
            value = total / Double(count)
        case .sum:
            value = total
        case .mode:
            return nil
        }

        return HealthMetricUploadSample(
            metricName: descriptor.metricName,
            unit: descriptor.normalizedUnit,
            value: roundToTwoDecimals(value),
            startTime: bucket.start,
            endTime: bucket.end,
            timezone: bucket.timezoneIdentifier,
            source: HealthKitStore.appleHealthDailySource,
            sourceSampleId: bucket.sourceSampleId(metricName: descriptor.metricName)
        )
    }
}

private struct DailyWeightAccumulator {
    let bucket: DailyHealthKitBucket
    private var candidates: [String: DailyWeightCandidate] = [:]

    init(bucket: DailyHealthKitBucket) {
        self.bucket = bucket
    }

    mutating func add(value: Double, endDate: Date) {
        let roundedValue = roundToTwoDecimals(value)
        let key = String(format: "%.2f", roundedValue)
        var candidate = candidates[key] ?? DailyWeightCandidate(
            value: roundedValue,
            count: 0,
            latestEndDate: endDate
        )

        candidate.count += 1

        if endDate > candidate.latestEndDate {
            candidate.latestEndDate = endDate
        }

        candidates[key] = candidate
    }

    func uploadSample(
        descriptor: HealthKitMetricDescriptor
    ) -> HealthMetricUploadSample? {
        guard let selected = candidates.values.sorted(by: weightCandidateSort)[safe: 0] else {
            return nil
        }

        return HealthMetricUploadSample(
            metricName: descriptor.metricName,
            unit: descriptor.normalizedUnit,
            value: selected.value,
            startTime: bucket.start,
            endTime: bucket.end,
            timezone: bucket.timezoneIdentifier,
            source: HealthKitStore.appleHealthDailySource,
            sourceSampleId: bucket.sourceSampleId(metricName: descriptor.metricName)
        )
    }

    private func weightCandidateSort(
        _ left: DailyWeightCandidate,
        _ right: DailyWeightCandidate
    ) -> Bool {
        if left.count != right.count {
            return left.count > right.count
        }

        if left.latestEndDate != right.latestEndDate {
            return left.latestEndDate > right.latestEndDate
        }

        return left.value > right.value
    }
}

private struct DailyWeightCandidate {
    let value: Double
    var count: Int
    var latestEndDate: Date
}

private func roundToTwoDecimals(_ value: Double) -> Double {
    (value * 100).rounded() / 100
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

private let bodyMassAnchorKey = "\(HealthKitStore.dailyAggregateAnchorNamespace).BodyMassAnchor"

private func anchorKey(for descriptor: HealthKitMetricDescriptor) -> String {
    if descriptor.metricName == "weight" {
        return bodyMassAnchorKey
    }

    return "\(HealthKitStore.dailyAggregateAnchorNamespace).\(descriptor.metricName)"
}

private struct AnchoredHealthKitResult {
    let samples: [HKSample]
    let deletedObjects: [HKDeletedObject]
    let newAnchor: HKQueryAnchor?

    var resultCount: Int {
        samples.count + deletedObjects.count
    }
}

private struct AnchoredBodyMassResult {
    let samples: [HKQuantitySample]
    let deletedObjects: [HKDeletedObject]
    let newAnchor: HKQueryAnchor?
}

private struct HealthKitDescriptorSyncTotals {
    let metricName: String
    var samples = 0
    var deleted = 0

    var summary: HealthKitMetricSyncSummary {
        HealthKitMetricSyncSummary(
            metricName: metricName,
            samples: samples,
            deleted: deleted
        )
    }
}

private struct HealthKitMetricUploadPlan {
    let metricName: String
    let anchorKey: String
    let finalAnchor: HKQueryAnchor
    let samples: [HealthMetricUploadSample]
}

private final class HealthKitObserverCompletion: @unchecked Sendable {
    private let completion: () -> Void

    init(_ completion: @escaping () -> Void) {
        self.completion = completion
    }

    func call() {
        completion()
    }
}

private final class HealthKitExtendedRuntimeTask {
    private var identifier = UIBackgroundTaskIdentifier.invalid

    @MainActor
    static func begin(name: String) -> HealthKitExtendedRuntimeTask {
        var task: HealthKitExtendedRuntimeTask!
        task = HealthKitExtendedRuntimeTask()
        task.identifier = UIApplication.shared.beginBackgroundTask(
            withName: name
        ) {
            Task { @MainActor in
                task.end()
            }
        }

        return task
    }

    @MainActor
    func end() {
        guard identifier != .invalid else {
            return
        }

        UIApplication.shared.endBackgroundTask(identifier)
        identifier = .invalid
    }
}

enum HealthKitBackgroundProcessingScheduler {
    static let taskIdentifier = HealthKitStore.backgroundProcessingTaskIdentifier

    static func scheduleSoon(
        earliestBeginDate: Date = Date(timeIntervalSinceNow: 15 * 60)
    ) {
        let request = BGProcessingTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = earliestBeginDate
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false

        try? BGTaskScheduler.shared.submit(request)
    }
}

enum HealthKitNutritionWritebackError: LocalizedError, Equatable {
    case healthDataUnavailable
    case noNutritionValues
    case missingHealthKitTypes

    var errorDescription: String? {
        switch self {
        case .healthDataUnavailable:
            return "Apple Health is unavailable on this device."
        case .noNutritionValues:
            return "There are no calories or macros to write for this day."
        case .missingHealthKitTypes:
            return "This device does not expose all nutrition write types."
        }
    }
}

private extension HealthKitStore {
    static func nutritionWriteValues(from totals: MacroTotals) -> [String: Double] {
        [
            "dietary_energy": totals.calories,
            "protein": totals.proteinGrams,
            "carbs": totals.carbsGrams,
            "fat": totals.fatGrams,
            "fiber": totals.fiberGrams,
        ].filter { _, value in
            value > 0 && value.isFinite
        }
    }

    static func nutritionWritebackSyncIdentifier(
        metricName: String,
        localDate: String
    ) -> String {
        "com.alexkubica.fitnesscoach.nutrition.\(metricName).\(localDate)"
    }

    static func localDateString(_ date: Date, calendar: Calendar) -> String {
        let components = calendar.dateComponents([.year, .month, .day], from: date)

        guard let year = components.year,
              let month = components.month,
              let day = components.day else {
            return "unknown-date"
        }

        return "\(year)-\(String(month).padLeft(to: 2, with: "0"))-\(String(day).padLeft(to: 2, with: "0"))"
    }

    func deleteNutritionWritebackSamples(
        quantityType: HKQuantityType,
        syncIdentifier: String
    ) async throws {
        let predicate = HKQuery.predicateForObjects(
            withMetadataKey: HKMetadataKeySyncIdentifier,
            operatorType: .equalTo,
            value: syncIdentifier
        )
        let samples = try await queryNutritionWritebackSamples(
            quantityType: quantityType,
            predicate: predicate
        )

        guard !samples.isEmpty else {
            return
        }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            healthStore.delete(samples) { success, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if success {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: HealthKitNutritionWritebackError.noNutritionValues)
                }
            }
        }
    }

    func queryNutritionWritebackSamples(
        quantityType: HKQuantityType,
        predicate: NSPredicate
    ) async throws -> [HKSample] {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[HKSample], Error>) in
            let query = HKSampleQuery(
                sampleType: quantityType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: samples ?? [])
                }
            }

            healthStore.execute(query)
        }
    }

    func saveNutritionWritebackSamples(_ samples: [HKQuantitySample]) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            healthStore.save(samples) { success, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if success {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: HealthKitNutritionWritebackError.noNutritionValues)
                }
            }
        }
    }
}

private extension String {
    func padLeft(to length: Int, with character: Character) -> String {
        if count >= length {
            return self
        }

        return String(repeating: String(character), count: length - count) + self
    }
}

private extension HealthMetricUploadResult {
    var syncFailureText: String? {
        switch self {
        case .skippedEmptyBatch, .uploaded:
            return nil
        case .skippedMissingAuthToken:
            return "Sign in with Google in Account settings to sync Apple Health."
        case .skippedMissingBackendURL:
            return "Apple Health sync is not configured. Sign in with Google in Account settings."
        case .skippedLiveHealthDataDisabled:
            return "Apple Health upload is disabled for this app launch."
        case .skippedNonDisposableBackend:
            return "Apple Health upload is blocked for this backend."
        }
    }

    var shouldPersistHealthKitAnchors: Bool {
        switch self {
        case .skippedEmptyBatch, .uploaded:
            return true
        case .skippedLiveHealthDataDisabled,
             .skippedMissingBackendURL,
             .skippedMissingAuthToken,
             .skippedNonDisposableBackend:
            return false
        }
    }
}

protocol HealthKitAnchorStore {
    func loadAnchor(for key: String) -> HKQueryAnchor?
    func saveAnchor(_ anchor: HKQueryAnchor, for key: String)
}

struct UserDefaultsHealthKitAnchorStore: HealthKitAnchorStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func loadAnchor(for key: String) -> HKQueryAnchor? {
        guard let data = defaults.data(forKey: key) else {
            return nil
        }

        return try? NSKeyedUnarchiver.unarchivedObject(
            ofClass: HKQueryAnchor.self,
            from: data
        )
    }

    func saveAnchor(_ anchor: HKQueryAnchor, for key: String) {
        guard let data = try? NSKeyedArchiver.archivedData(
            withRootObject: anchor,
            requiringSecureCoding: true
        ) else {
            return
        }

        defaults.set(data, forKey: key)
    }
}
