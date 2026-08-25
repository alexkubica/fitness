import BackgroundTasks
import SwiftUI
import UIKit
import UserNotifications

@main
struct FitnessCoachApp: App {
    @UIApplicationDelegateAdaptor(FitnessCoachAppDelegate.self)
    private var appDelegate
    @StateObject private var healthKitStore = HealthKitStore()
    private let watchSyncBridge = PhoneWatchSyncBridge()

    var body: some Scene {
        WindowGroup {
            ContentView(
                healthKitStore: healthKitStore,
                watchSyncBridge: watchSyncBridge
            )
                .task {
                    watchSyncBridge.activate(healthKitStore: healthKitStore)
                    await healthKitStore.startBackgroundDelivery()
                    HealthKitBackgroundProcessingScheduler.scheduleSoon()
                }
        }
    }
}

@MainActor
final class FitnessCoachAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _: UIApplication,
        didFinishLaunchingWithOptions _: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self

        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: HealthKitBackgroundProcessingScheduler.taskIdentifier,
            using: nil
        ) { task in
            guard let task = task as? BGProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }

            let syncTask = Task { @MainActor in
                HealthKitBackgroundProcessingScheduler.scheduleSoon()
                await HealthKitStore().runScheduledBackgroundSync()
                task.setTaskCompleted(success: true)
            }

            task.expirationHandler = {
                syncTask.cancel()
            }
        }

        return true
    }

    nonisolated func userNotificationCenter(
        _: UNUserNotificationCenter,
        willPresent _: UNNotification
    ) async -> UNNotificationPresentationOptions {
        []
    }
}
