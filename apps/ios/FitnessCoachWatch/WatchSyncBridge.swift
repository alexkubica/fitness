import Foundation
import SwiftUI
import WatchConnectivity

private enum WatchSyncMessage {
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

struct WatchSyncStatus: Equatable {
    enum State: String {
        case idle
        case sending
        case queued
        case started
        case completed
        case failed
    }

    let state: State
    let title: String
    let detail: String
    let secondaryText: String?
    let etaText: String?
    let progressFraction: Double?
    let updatedAt: Date?

    static let idle = WatchSyncStatus(
        state: .idle,
        title: "Ready",
        detail: "Use your iPhone for Health permission and sign-in. Watch can request a sync.",
        secondaryText: nil,
        etaText: nil,
        progressFraction: nil,
        updatedAt: nil
    )

    var isWorking: Bool {
        state == .sending || state == .queued || state == .started
    }

    var systemImage: String {
        switch state {
        case .idle:
            return "iphone"
        case .sending, .queued, .started:
            return "arrow.triangle.2.circlepath"
        case .completed:
            return "checkmark"
        case .failed:
            return "exclamationmark.triangle.fill"
        }
    }

    var tint: Color {
        switch state {
        case .failed:
            return WatchTheme.orange
        default:
            return WatchTheme.lime
        }
    }

    var updatedText: String? {
        guard let updatedAt else {
            return nil
        }

        return updatedAt.formatted(.dateTime.hour().minute())
    }
}

@MainActor
final class WatchSyncBridge: NSObject, ObservableObject, WCSessionDelegate {
    @Published private(set) var connectionText = "Connecting to iPhone"
    @Published private(set) var canRequestSync = false
    @Published private(set) var status = WatchSyncStatus.idle
    @Published private(set) var stepSnapshot: StepSnapshot?
    @Published private(set) var dashboardSnapshot: HealthDashboardSnapshot?
    @Published private(set) var nutritionSnapshot: NutritionCoachSnapshot?
    private var activeRequestId: String?
    private var lastFinishedRequestAt: Date?

    func activate() {
        guard WCSession.isSupported() else {
            connectionText = "WatchConnectivity is unavailable."
            canRequestSync = false
            return
        }

        WCSession.default.delegate = self
        WCSession.default.activate()
        updateStepSnapshotIfPresent(WCSession.default.receivedApplicationContext)
        updateDashboardSnapshotIfPresent(WCSession.default.receivedApplicationContext)
        updateNutritionSnapshotIfPresent(WCSession.default.receivedApplicationContext)
        refreshConnectionState()
    }

    func requestSync() {
        guard activeRequestId == nil, !status.isWorking else {
            return
        }
        if let lastFinishedRequestAt,
           Date().timeIntervalSince(lastFinishedRequestAt) < 1.5 {
            return
        }

        guard WCSession.isSupported() else {
            updateStatus(WatchSyncStatus(
                state: .failed,
                title: "Cannot sync",
                detail: "WatchConnectivity is unavailable.",
                secondaryText: nil,
                etaText: nil,
                progressFraction: nil,
                updatedAt: Date()
            ))
            return
        }

        let session = WCSession.default
        let requestId = UUID().uuidString
        activeRequestId = requestId
        let payload: [String: Any] = [
            WatchSyncMessage.commandKey: WatchSyncMessage.syncNowCommand,
            WatchSyncMessage.requestIdKey: requestId,
        ]

        guard session.activationState == .activated else {
            updateStatus(WatchSyncStatus(
                state: .failed,
                title: "iPhone not connected",
                detail: "Open Fitness Coach on iPhone once, then try again.",
                secondaryText: nil,
                etaText: nil,
                progressFraction: nil,
                updatedAt: Date()
            ))
            refreshConnectionState()
            return
        }

        if session.isReachable {
            updateStatus(WatchSyncStatus(
                state: .sending,
                title: "Requesting sync",
                detail: "Sending the request to iPhone.",
                secondaryText: nil,
                etaText: nil,
                progressFraction: nil,
                updatedAt: Date()
            ))
            session.sendMessage(payload) { reply in
                let parsed = Self.status(from: reply)
                let stepSnapshot = StepSnapshot.fromPayload(reply)
                let dashboardSnapshot = HealthDashboardSnapshot.fromPayload(reply)
                let nutritionSnapshot = NutritionCoachSnapshot.fromPayload(reply)
                Task { @MainActor in
                    if let parsed {
                        self.updateStatus(parsed)
                    }
                    if let stepSnapshot {
                        self.stepSnapshot = stepSnapshot
                    }
                    if let dashboardSnapshot {
                        self.dashboardSnapshot = dashboardSnapshot
                    }
                    if let nutritionSnapshot {
                        self.nutritionSnapshot = nutritionSnapshot
                    }
                    self.refreshConnectionState()
                }
            } errorHandler: { error in
                let errorMessage = error.localizedDescription
                Task { @MainActor in
                    self.queueSyncRequest(payload: payload, errorMessage: errorMessage)
                }
            }
        } else {
            queueSyncRequest(payload: payload)
        }
    }

    nonisolated func session(
        _: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        let errorMessage = error?.localizedDescription
        Task { @MainActor in
            if let errorMessage {
                self.updateStatus(WatchSyncStatus(
                    state: .failed,
                    title: "iPhone link failed",
                    detail: errorMessage,
                    secondaryText: nil,
                    etaText: nil,
                    progressFraction: nil,
                    updatedAt: Date()
                ))
            }
            self.refreshConnectionState(activationState: activationState)
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let isReachable = session.isReachable
        let activationState = session.activationState

        Task { @MainActor in
            self.refreshConnectionState(
                activationState: activationState,
                isReachable: isReachable
            )
        }
    }

    nonisolated func session(
        _: WCSession,
        didReceiveMessage message: [String: Any]
    ) {
        let parsed = Self.status(from: message)
        let stepSnapshot = StepSnapshot.fromPayload(message)
        let dashboardSnapshot = HealthDashboardSnapshot.fromPayload(message)
        let nutritionSnapshot = NutritionCoachSnapshot.fromPayload(message)

        Task { @MainActor in
            if let parsed {
                self.updateStatus(parsed)
            }
            if let stepSnapshot {
                self.stepSnapshot = stepSnapshot
            }
            if let dashboardSnapshot {
                self.dashboardSnapshot = dashboardSnapshot
            }
            if let nutritionSnapshot {
                self.nutritionSnapshot = nutritionSnapshot
            }
            self.refreshConnectionState()
        }
    }

    nonisolated func session(
        _: WCSession,
        didReceiveApplicationContext applicationContext: [String: Any]
    ) {
        let parsed = Self.status(from: applicationContext)
        let stepSnapshot = StepSnapshot.fromPayload(applicationContext)
        let dashboardSnapshot = HealthDashboardSnapshot.fromPayload(applicationContext)
        let nutritionSnapshot = NutritionCoachSnapshot.fromPayload(applicationContext)

        Task { @MainActor in
            if let parsed {
                self.updateStatus(parsed)
            }
            if let stepSnapshot {
                self.stepSnapshot = stepSnapshot
            }
            if let dashboardSnapshot {
                self.dashboardSnapshot = dashboardSnapshot
            }
            if let nutritionSnapshot {
                self.nutritionSnapshot = nutritionSnapshot
            }
            self.refreshConnectionState()
        }
    }

    private func queueSyncRequest(
        payload: [String: Any],
        errorMessage: String? = nil
    ) {
        WCSession.default.transferUserInfo(payload)
        updateStatus(WatchSyncStatus(
            state: .queued,
            title: "Queued for iPhone",
            detail: errorMessage.map {
                "The request is queued. \($0)"
            } ?? "The sync will start when the iPhone app receives the request.",
            secondaryText: nil,
            etaText: nil,
            progressFraction: nil,
            updatedAt: Date()
        ))
        refreshConnectionState()
    }

    private func updateStatus(_ newStatus: WatchSyncStatus) {
        status = newStatus

        if !newStatus.isWorking {
            activeRequestId = nil
            lastFinishedRequestAt = Date()
        }
    }

    private func refreshConnectionState(
        activationState: WCSessionActivationState? = nil,
        isReachable: Bool? = nil
    ) {
        guard WCSession.isSupported() else {
            connectionText = "WatchConnectivity is unavailable."
            canRequestSync = false
            return
        }

        let session = WCSession.default
        let resolvedActivationState = activationState ?? session.activationState
        let resolvedReachable = isReachable ?? session.isReachable

        canRequestSync = resolvedActivationState == .activated

        if resolvedActivationState != .activated {
            connectionText = "Open Fitness Coach on iPhone once to connect."
        } else if resolvedReachable {
            connectionText = "iPhone is reachable."
        } else {
            connectionText = "iPhone is paired. Requests may queue until the app wakes."
        }
    }

    private func updateStepSnapshotIfPresent(_ payload: [String: Any]) {
        guard let snapshot = StepSnapshot.fromPayload(payload) else {
            return
        }

        stepSnapshot = snapshot
    }

    private func updateDashboardSnapshotIfPresent(_ payload: [String: Any]) {
        guard let snapshot = HealthDashboardSnapshot.fromPayload(payload) else {
            return
        }

        dashboardSnapshot = snapshot
    }

    private func updateNutritionSnapshotIfPresent(_ payload: [String: Any]) {
        guard let snapshot = NutritionCoachSnapshot.fromPayload(payload) else {
            return
        }

        nutritionSnapshot = snapshot
    }

    nonisolated private static func status(from message: [String: Any]) -> WatchSyncStatus? {
        guard let stateText = message[WatchSyncMessage.stateKey] as? String else {
            return nil
        }

        let state = WatchSyncStatus.State(rawValue: stateText) ?? .idle
        let title = message[WatchSyncMessage.titleKey] as? String ?? "Sync"
        let detail = message[WatchSyncMessage.detailKey] as? String
            ?? "Open Fitness Coach on iPhone for details."
        let secondaryText = message[WatchSyncMessage.secondaryTextKey] as? String
        let etaText = message[WatchSyncMessage.etaTextKey] as? String
        let progressFraction = sanitizedProgressFraction(
            message[WatchSyncMessage.progressFractionKey]
        )
        let updatedAtText = message[WatchSyncMessage.updatedAtKey] as? String
        let updatedAt = updatedAtText.flatMap {
            ISO8601DateFormatter().date(from: $0)
        }

        return WatchSyncStatus(
            state: state,
            title: title,
            detail: detail,
            secondaryText: secondaryText,
            etaText: etaText,
            progressFraction: progressFraction,
            updatedAt: updatedAt
        )
    }

    nonisolated private static func sanitizedProgressFraction(_ value: Any?) -> Double? {
        let number: Double?

        if let value = value as? Double {
            number = value
        } else if let value = value as? NSNumber {
            number = value.doubleValue
        } else {
            number = nil
        }

        guard let number,
              number.isFinite else {
            return nil
        }

        return min(1, max(0, number))
    }
}
