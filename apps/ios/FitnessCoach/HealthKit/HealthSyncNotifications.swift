import Foundation
import UIKit
import UserNotifications
#if canImport(ActivityKit)
@preconcurrency import ActivityKit
#endif

enum HealthSyncNotificationAuthorizationStatus: Equatable {
    case notDetermined
    case denied
    case authorized

    var displayText: String {
        switch self {
        case .notDetermined:
            return "Not enabled"
        case .denied:
            return "Disabled in Settings"
        case .authorized:
            return "Enabled"
        }
    }

    fileprivate init(_ status: UNAuthorizationStatus) {
        switch status {
        case .authorized, .provisional, .ephemeral:
            self = .authorized
        case .denied:
            self = .denied
        case .notDetermined:
            self = .notDetermined
        @unknown default:
            self = .denied
        }
    }
}

@MainActor
final class HealthSyncNotificationSettings: ObservableObject {
    @Published private(set) var authorizationStatus: HealthSyncNotificationAuthorizationStatus = .notDetermined

    private let center: UNUserNotificationCenter

    init(center: UNUserNotificationCenter = .current()) {
        self.center = center
    }

    func refresh() async {
        let settings = await center.notificationSettings()

        authorizationStatus = HealthSyncNotificationAuthorizationStatus(
            settings.authorizationStatus
        )
    }

    func requestAuthorization() async {
        do {
            _ = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            await refresh()
        } catch {
            authorizationStatus = .denied
        }
    }

    func cancelStaleReminder() {
        center.removePendingNotificationRequests(
            withIdentifiers: [HealthSyncNotifier.staleReminderNotificationId]
        )
    }

    func cancelAllHealthSyncNotifications() {
        center.removePendingNotificationRequests(
            withIdentifiers: HealthSyncNotifier.notificationRequestIdentifiers
        )
        center.removeDeliveredNotifications(
            withIdentifiers: HealthSyncNotifier.notificationRequestIdentifiers
        )
    }
}

struct HealthSyncNotificationContent: Equatable {
    let title: String
    let body: String

    static let started = HealthSyncNotificationContent(
        title: "Health sync started",
        body: "Fitness Coach is updating your Apple Health data."
    )

    static let staleReminder = HealthSyncNotificationContent(
        title: "Health data may be stale",
        body: "Open Fitness Coach to update your Apple Health summary."
    )

    static func finished(for result: HealthKitSyncResult) -> HealthSyncNotificationContent {
        switch result {
        case .completed(_, let upload):
            return HealthSyncNotificationContent(
                title: "Health sync complete",
                body: upload.notificationText
            )
        case .healthDataUnavailable:
            return HealthSyncNotificationContent(
                title: "Health sync did not run",
                body: "Apple Health data is unavailable on this device."
            )
        case .alreadyRunning:
            return HealthSyncNotificationContent(
                title: "Health sync already running",
                body: "Fitness Coach is using the current Apple Health sync."
            )
        case .failed(let message):
            return HealthSyncNotificationContent(
                title: "Health sync failed",
                body: message
            )
        }
    }

}

@MainActor
struct HealthSyncNotifier {
    enum Event {
        case started
        case finished
        case staleReminder
    }

    static let completionNotificationsEnabledDefaultsKey =
        "FitnessCoach.HealthSyncNotifications.CompletionEnabled"
    static let staleReminderEnabledDefaultsKey =
        "FitnessCoach.HealthSyncNotifications.StaleReminderEnabled"
    nonisolated static let completionNotificationsDefaultEnabled = false
    nonisolated static let staleReminderDefaultEnabled = false
    nonisolated static let minimumFinishedNotificationDuration: TimeInterval = 5 * 60
    nonisolated static let inProgressNotificationId = "fitness.health-sync.in-progress"
    nonisolated static let finishedNotificationId = "fitness.health-sync.finished"
    static let staleReminderInterval: TimeInterval = 8 * 60 * 60
    nonisolated static let staleReminderNotificationId = "fitness.health-sync.stale-reminder"
    nonisolated static let notificationRequestIdentifiers = [
        inProgressNotificationId,
        finishedNotificationId,
        staleReminderNotificationId,
    ]

    private let center: UNUserNotificationCenter
    private let applicationState: () -> UIApplication.State
    private let preferences: UserDefaults

    init(
        center: UNUserNotificationCenter = .current(),
        preferences: UserDefaults = .standard,
        applicationState: @escaping () -> UIApplication.State = {
            UIApplication.shared.applicationState
        }
    ) {
        self.center = center
        self.preferences = preferences
        self.applicationState = applicationState
    }

    func notifySyncStarted() async {
        await schedule(
            id: Self.inProgressNotificationId,
            event: .started,
            content: .started,
            replacesPending: true
        )
    }

    func notifySyncFinished(
        _ result: HealthKitSyncResult,
        startedAt: Date? = nil,
        now: Date = Date()
    ) async {
        center.removePendingNotificationRequests(
            withIdentifiers: [Self.inProgressNotificationId]
        )
        center.removeDeliveredNotifications(
            withIdentifiers: [Self.inProgressNotificationId]
        )
        await scheduleStaleReminderIfNeeded(for: result)
        let duration = startedAt.map { now.timeIntervalSince($0) }

        guard Self.shouldNotifyFinished(result, syncDuration: duration) else {
            return
        }

        await schedule(
            id: Self.finishedNotificationId,
            event: .finished,
            content: .finished(for: result),
            replacesPending: true
        )
    }

    nonisolated static func shouldScheduleNotification(
        event: Event,
        applicationState: UIApplication.State,
        completionNotificationsEnabled: Bool = completionNotificationsDefaultEnabled,
        staleReminderEnabled: Bool = staleReminderDefaultEnabled
    ) -> Bool {
        switch event {
        case .started:
            return false
        case .finished:
            return applicationState != .active && completionNotificationsEnabled
        case .staleReminder:
            return staleReminderEnabled
        }
    }

    nonisolated static func shouldNotifyFinished(
        _ result: HealthKitSyncResult,
        syncDuration: TimeInterval?
    ) -> Bool {
        switch result {
        case .completed(_, .uploaded(let count)):
            guard let syncDuration,
                  syncDuration >= minimumFinishedNotificationDuration else {
                return false
            }

            return count > 0
        case .healthDataUnavailable, .alreadyRunning, .failed:
            return false
        case .completed:
            return false
        }
    }

    private func schedule(
        id: String,
        event: Event,
        content: HealthSyncNotificationContent,
        replacesPending: Bool
    ) async {
        await schedule(
            id: id,
            event: event,
            content: content,
            trigger: nil,
            replacesPending: replacesPending
        )
    }

    private func scheduleStaleReminderIfNeeded(for result: HealthKitSyncResult) async {
        guard case .completed = result else {
            return
        }

        await schedule(
            id: Self.staleReminderNotificationId,
            event: .staleReminder,
            content: .staleReminder,
            trigger: UNTimeIntervalNotificationTrigger(
                timeInterval: Self.staleReminderInterval,
                repeats: false
            ),
            replacesPending: true
        )
    }

    private func schedule(
        id: String,
        event: Event,
        content: HealthSyncNotificationContent,
        trigger: UNNotificationTrigger?,
        replacesPending: Bool
    ) async {
        guard Self.shouldScheduleNotification(
            event: event,
            applicationState: applicationState(),
            completionNotificationsEnabled: preference(
                for: Self.completionNotificationsEnabledDefaultsKey,
                defaultValue: Self.completionNotificationsDefaultEnabled
            ),
            staleReminderEnabled: preference(
                for: Self.staleReminderEnabledDefaultsKey,
                defaultValue: Self.staleReminderDefaultEnabled
            )
        ) else {
            center.removePendingNotificationRequests(withIdentifiers: [id])
            return
        }

        let settings = await center.notificationSettings()
        let status = HealthSyncNotificationAuthorizationStatus(
            settings.authorizationStatus
        )

        guard status == .authorized else {
            return
        }

        if replacesPending {
            center.removePendingNotificationRequests(withIdentifiers: [id])
        }

        let notificationContent = UNMutableNotificationContent()

        notificationContent.title = content.title
        notificationContent.body = content.body
        notificationContent.sound = .default

        do {
            try await center.add(
                UNNotificationRequest(
                    identifier: id,
                    content: notificationContent,
                    trigger: trigger
                )
            )
        } catch {
            // Notification delivery is best-effort; sync should never fail because
            // the user denied or iOS rejected an alert.
        }
    }

    private func preference(
        for key: String,
        defaultValue: Bool
    ) -> Bool {
        guard preferences.object(forKey: key) != nil else {
            return defaultValue
        }

        return preferences.bool(forKey: key)
    }
}

@MainActor
final class HealthSyncLiveActivityController {
#if canImport(ActivityKit)
    private var activity: Activity<FitnessCoachSyncActivityAttributes>?
#endif

    func start(
        title: String,
        detail: String,
        now: Date = Date()
    ) async {
#if canImport(ActivityKit)
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            return
        }

        if activity == nil {
            activity = Activity<FitnessCoachSyncActivityAttributes>.activities.first
        }

        let state = FitnessCoachSyncActivityAttributes.ContentState(
            title: title,
            detail: detail,
            progressFraction: nil,
            updatedAt: now,
            state: "running"
        )
        let content = ActivityContent(state: state, staleDate: nil)

        if let activity {
            await activity.update(content)
            return
        }

        do {
            activity = try Activity.request(
                attributes: FitnessCoachSyncActivityAttributes(source: "iphone-healthkit"),
                content: content,
                pushType: nil
            )
        } catch {
            activity = nil
        }
#endif
    }

    func update(
        progress: HealthKitSyncProgress?,
        now: Date = Date()
    ) async {
#if canImport(ActivityKit)
        guard let progress else {
            return
        }

        if activity == nil {
            activity = Activity<FitnessCoachSyncActivityAttributes>.activities.first
        }

        guard let activity else {
            return
        }

        await activity.update(ActivityContent(
            state: FitnessCoachSyncActivityAttributes.ContentState(
                title: progress.title,
                detail: progress.detailText,
                progressFraction: Self.sanitizedProgress(progress.fractionCompleted),
                updatedAt: now,
                state: "running"
            ),
            staleDate: nil
        ))
#endif
    }

    func showAlreadyRunning(
        progress: HealthKitSyncProgress?,
        now: Date = Date()
    ) async {
        if let progress {
            await update(progress: progress, now: now)
            return
        }

        await start(
            title: "Sync already running",
            detail: "Using the current Apple Health sync.",
            now: now
        )
    }

    func end(
        result: HealthKitSyncResult?,
        now: Date = Date()
    ) async {
#if canImport(ActivityKit)
        if activity == nil {
            activity = Activity<FitnessCoachSyncActivityAttributes>.activities.first
        }

        guard let activity else {
            return
        }

        await activity.end(
            ActivityContent(
                state: Self.contentState(for: result, now: now),
                staleDate: nil
            ),
            dismissalPolicy: .after(now.addingTimeInterval(20 * 60))
        )
        self.activity = nil
#endif
    }

#if canImport(ActivityKit)
    private static func contentState(
        for result: HealthKitSyncResult?,
        now: Date
    ) -> FitnessCoachSyncActivityAttributes.ContentState {
        switch result {
        case .completed(_, let upload):
            return FitnessCoachSyncActivityAttributes.ContentState(
                title: "Sync complete",
                detail: upload.liveActivityText,
                progressFraction: 1,
                updatedAt: now,
                state: "completed"
            )
        case .healthDataUnavailable:
            return FitnessCoachSyncActivityAttributes.ContentState(
                title: "Health unavailable",
                detail: "Apple Health is unavailable on this iPhone.",
                progressFraction: nil,
                updatedAt: now,
                state: "failed"
            )
        case .alreadyRunning:
            return FitnessCoachSyncActivityAttributes.ContentState(
                title: "Sync already running",
                detail: "Using the current Apple Health sync.",
                progressFraction: nil,
                updatedAt: now,
                state: "running"
            )
        case .failed(let message):
            return FitnessCoachSyncActivityAttributes.ContentState(
                title: "Sync failed",
                detail: message,
                progressFraction: nil,
                updatedAt: now,
                state: "failed"
            )
        case nil:
            return FitnessCoachSyncActivityAttributes.ContentState(
                title: "Sync finished",
                detail: "Open Fitness Coach for details.",
                progressFraction: nil,
                updatedAt: now,
                state: "completed"
            )
        }
    }

    private static func sanitizedProgress(_ value: Double?) -> Double? {
        guard let value,
              value.isFinite else {
            return nil
        }

        return min(1, max(0, value))
    }
#endif
}

private extension HealthMetricUploadResult {
    var notificationText: String {
        switch self {
        case .skippedEmptyBatch:
            return "No new Health data to sync."
        case .skippedLiveHealthDataDisabled:
            return "Apple Health upload is disabled for this app launch."
        case .skippedMissingBackendURL:
            return "Sign in with Google in Fitness Coach to sync Apple Health."
        case .skippedMissingAuthToken:
            return "Sign in with Google in Fitness Coach to sync Apple Health."
        case .skippedNonDisposableBackend:
            return "Apple Health upload is blocked for this backend."
        case .uploaded(let count):
            return "\(count.formatted(.number)) daily rows synced."
        }
    }

    var liveActivityText: String {
        switch self {
        case .skippedEmptyBatch:
            return "No new Health data to sync."
        case .skippedLiveHealthDataDisabled:
            return "Live upload is disabled on iPhone."
        case .skippedMissingBackendURL, .skippedMissingAuthToken:
            return "Sign in with Google on iPhone."
        case .skippedNonDisposableBackend:
            return "Apple Health upload is blocked for this backend."
        case .uploaded(let count):
            return "\(count.formatted(.number)) daily rows synced."
        }
    }
}
