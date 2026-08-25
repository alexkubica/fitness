import Foundation
import UIKit
import WatchConnectivity

enum WatchSyncMessage {
    static let commandKey = "command"
    static let requestIdKey = "requestId"
    static let stateKey = "state"
    static let titleKey = "title"
    static let detailKey = "detail"
    static let secondaryTextKey = "secondaryText"
    static let etaTextKey = "etaText"
    static let progressFractionKey = "progressFraction"
    static let updatedAtKey = "updatedAt"

    static let syncNowCommand = "syncNow"
    static let idleState = "idle"
    static let startedState = "started"
    static let completedState = "completed"
    static let failedState = "failed"
}

@MainActor
final class PhoneWatchSyncBridge: NSObject, WCSessionDelegate {
    private weak var healthKitStore: HealthKitStore?
    private var isSyncingFromWatch = false
    private var progressPublishTask: Task<Void, Never>?
    private var latestStepSnapshot: StepSnapshot?
    private var latestDashboardSnapshot: HealthDashboardSnapshot?
    private var latestNutritionSnapshot: NutritionCoachSnapshot?

    func activate(healthKitStore: HealthKitStore) {
        self.healthKitStore = healthKitStore
        latestStepSnapshot = StepSnapshotStore.load()
        latestDashboardSnapshot = HealthDashboardSnapshotStore.load()
        latestNutritionSnapshot = NutritionCoachSnapshotStore.load()

        guard WCSession.isSupported() else {
            return
        }

        WCSession.default.delegate = self
        WCSession.default.activate()
        publishStatus(
            state: WatchSyncMessage.idleState,
            title: "Ready",
            detail: "Sync runs on iPhone."
        )
    }

    func publishStepSnapshot(_ snapshot: StepSnapshot) {
        latestStepSnapshot = snapshot

        publishLatestSnapshots()
    }

    func publishDashboardSnapshot(_ snapshot: HealthDashboardSnapshot) {
        latestDashboardSnapshot = snapshot

        publishLatestSnapshots()
    }

    func publishNutritionSnapshot(_ snapshot: NutritionCoachSnapshot) {
        latestNutritionSnapshot = snapshot

        publishLatestSnapshots()
    }

    private func publishLatestSnapshots() {
        guard WCSession.isSupported() else {
            return
        }

        let session = WCSession.default

        guard session.activationState == .activated else {
            return
        }

        var payload: [String: Any] = [:]
        latestStepSnapshot?.applying(to: &payload)
        latestDashboardSnapshot?.applying(to: &payload)
        latestNutritionSnapshot?.applying(to: &payload)

        try? session.updateApplicationContext(payload)

        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil, errorHandler: nil)
        }
    }

    nonisolated func session(
        _: WCSession,
        activationDidCompleteWith _: WCSessionActivationState,
        error: Error?
    ) {
        guard let error else {
            return
        }

        Task { @MainActor in
            self.publishStatus(
                state: WatchSyncMessage.failedState,
                title: "Watch link failed",
                detail: error.localizedDescription
            )
        }
    }

    nonisolated func sessionDidBecomeInactive(_: WCSession) {}

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    nonisolated func session(
        _: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        let command = message[WatchSyncMessage.commandKey] as? String
        let requestId = message[WatchSyncMessage.requestIdKey] as? String

        guard command == WatchSyncMessage.syncNowCommand else {
            replyHandler([
                WatchSyncMessage.stateKey: WatchSyncMessage.failedState,
                WatchSyncMessage.titleKey: "Unsupported request",
                WatchSyncMessage.detailKey: "The iPhone app did not recognize that Watch action.",
            ])
            return
        }

        Task { @MainActor in
            self.startSyncFromWatch(requestId: requestId)
        }

        replyHandler([
            WatchSyncMessage.stateKey: WatchSyncMessage.startedState,
            WatchSyncMessage.titleKey: "Sync requested",
            WatchSyncMessage.detailKey: "The iPhone is starting Apple Health sync.",
        ])
    }

    nonisolated func session(
        _: WCSession,
        didReceiveUserInfo userInfo: [String: Any] = [:]
    ) {
        let command = userInfo[WatchSyncMessage.commandKey] as? String
        let requestId = userInfo[WatchSyncMessage.requestIdKey] as? String

        guard command == WatchSyncMessage.syncNowCommand else {
            return
        }

        Task { @MainActor in
            self.startSyncFromWatch(requestId: requestId)
        }
    }

    private func startSyncFromWatch(requestId: String?) {
        guard let healthKitStore else {
            publishStatus(
                state: WatchSyncMessage.failedState,
                title: "iPhone not ready",
                detail: "Open Fitness Coach on iPhone once, then try again.",
                requestId: requestId
            )
            return
        }

        guard UIApplication.shared.isProtectedDataAvailable else {
            publishStatus(
                state: WatchSyncMessage.failedState,
                title: "Unlock iPhone",
                detail: HealthKitProtectedData.unavailableMessage,
                requestId: requestId
            )
            return
        }

        guard !isSyncingFromWatch else {
            publishStatus(
                state: WatchSyncMessage.startedState,
                title: "Already syncing",
                detail: "The current iPhone sync is still running.",
                requestId: requestId
            )
            return
        }

        isSyncingFromWatch = true
        publishStatus(
            state: WatchSyncMessage.startedState,
            title: "Syncing",
            detail: "Reading Apple Health on iPhone.",
            requestId: requestId
        )
        startPublishingProgress(healthKitStore: healthKitStore, requestId: requestId)

        Task { @MainActor in
            await healthKitStore.syncFirstSliceDeltas()
            let result = healthKitStore.lastSyncResult
            self.progressPublishTask?.cancel()
            self.progressPublishTask = nil
            self.isSyncingFromWatch = false
            self.publishStatus(
                result: result,
                requestId: requestId
            )
        }
    }

    private func startPublishingProgress(
        healthKitStore: HealthKitStore,
        requestId: String?
    ) {
        progressPublishTask?.cancel()
        progressPublishTask = Task { @MainActor [weak self, weak healthKitStore] in
            while !Task.isCancelled {
                if let progress = healthKitStore?.syncProgress {
                    self?.publishStatus(
                        state: WatchSyncMessage.startedState,
                        title: progress.title,
                        detail: progress.detailText,
                        secondaryText: progress.secondaryText,
                        etaText: progress.etaText,
                        progressFraction: Self.sanitizedProgressFraction(
                            progress.fractionCompleted
                        ),
                        requestId: requestId
                    )
                }

                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }

    private func publishStatus(
        result: HealthKitSyncResult?,
        requestId: String?
    ) {
        guard let result else {
            publishStatus(
                state: WatchSyncMessage.failedState,
                title: "Sync status unknown",
                detail: "Open Fitness Coach on iPhone for details.",
                requestId: requestId
            )
            return
        }

        switch result {
        case .completed(_, let upload):
            publishStatus(
                state: WatchSyncMessage.completedState,
                title: "Sync complete",
                detail: upload.watchSummaryText,
                requestId: requestId
            )
        case .healthDataUnavailable:
            publishStatus(
                state: WatchSyncMessage.failedState,
                title: "Health unavailable",
                detail: "Apple Health is unavailable on this iPhone.",
                requestId: requestId
            )
        case .alreadyRunning:
            publishStatus(
                state: WatchSyncMessage.startedState,
                title: "Sync already running",
                detail: "Using the current HealthKit sync.",
                requestId: requestId
            )
        case .failed(let message):
            publishStatus(
                state: WatchSyncMessage.failedState,
                title: "Sync failed",
                detail: message,
                requestId: requestId
            )
        }
    }

    private func publishStatus(
        state: String,
        title: String,
        detail: String,
        secondaryText: String? = nil,
        etaText: String? = nil,
        progressFraction: Double? = nil,
        requestId: String? = nil,
        now: Date = Date()
    ) {
        guard WCSession.isSupported() else {
            return
        }

        let payload = watchPayload(
            state: state,
            title: title,
            detail: detail,
            secondaryText: secondaryText,
            etaText: etaText,
            progressFraction: progressFraction,
            requestId: requestId,
            now: now
        )
        let session = WCSession.default

        guard session.activationState == .activated else {
            return
        }

        try? session.updateApplicationContext(payload)

        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil, errorHandler: nil)
        }
    }

    private func watchPayload(
        state: String,
        title: String,
        detail: String,
        secondaryText: String?,
        etaText: String?,
        progressFraction: Double?,
        requestId: String?,
        now: Date
    ) -> [String: Any] {
        var payload: [String: Any] = [
            WatchSyncMessage.stateKey: state,
            WatchSyncMessage.titleKey: title,
            WatchSyncMessage.detailKey: detail,
            WatchSyncMessage.updatedAtKey: ISO8601DateFormatter().string(from: now),
        ]

        if let secondaryText {
            payload[WatchSyncMessage.secondaryTextKey] = secondaryText
        }

        if let etaText {
            payload[WatchSyncMessage.etaTextKey] = etaText
        }

        if let progressFraction {
            payload[WatchSyncMessage.progressFractionKey] = progressFraction
        }

        if let requestId {
            payload[WatchSyncMessage.requestIdKey] = requestId
        }

        latestStepSnapshot?.applying(to: &payload)
        latestDashboardSnapshot?.applying(to: &payload)
        latestNutritionSnapshot?.applying(to: &payload)

        return payload
    }

    private static func sanitizedProgressFraction(_ value: Double?) -> Double? {
        guard let value,
              value.isFinite else {
            return nil
        }

        return min(1, max(0, value))
    }
}

private extension HealthMetricUploadResult {
    var watchSummaryText: String {
        switch self {
        case .skippedEmptyBatch:
            return "No new daily rows."
        case .uploaded(let count):
            return "\(count.formatted(.number)) daily rows synced."
        case .skippedLiveHealthDataDisabled:
            return "Live upload is disabled on iPhone."
        case .skippedMissingBackendURL:
            return "Backend is not configured."
        case .skippedMissingAuthToken:
            return "Sign in with Google on iPhone."
        case .skippedNonDisposableBackend:
            return "Hosted upload is blocked."
        }
    }
}
