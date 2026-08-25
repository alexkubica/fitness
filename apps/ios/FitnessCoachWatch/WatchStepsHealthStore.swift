import Foundation
import HealthKit

enum WatchHealthPermissionStatus: String, Codable, Equatable {
  case unavailable
  case notDetermined
  case requested
  case denied
}

struct WatchStepReading: Codable, Equatable {
  let steps: Int
  let startDate: Date
  let endDate: Date
  let refreshedAt: Date
}

enum WatchStepFetchOutcome: Equatable {
  case value(WatchStepReading)
  case empty(permission: WatchHealthPermissionStatus)
  case unavailable
  case denied
}

@MainActor
protocol WatchStepHealthProviding: AnyObject {
  func permissionStatus() async -> WatchHealthPermissionStatus
  func requestPermission() async -> WatchHealthPermissionStatus
  func fetchCurrentDaySteps(now: Date, calendar: Calendar) async throws -> WatchStepFetchOutcome
  func startBackgroundUpdates(onUpdate: @MainActor @escaping () async -> Void) async throws
}

enum WatchStepsHealthStoreError: LocalizedError, Equatable {
  case missingStepType
  case queryReturnedNoStatistics
  case backgroundDeliveryFailed

  var errorDescription: String? {
    switch self {
    case .missingStepType:
      return "Step count is unavailable on this device."
    case .queryReturnedNoStatistics:
      return "HealthKit did not return step statistics."
    case .backgroundDeliveryFailed:
      return "Background step updates could not be enabled."
    }
  }
}

@MainActor
final class WatchStepsHealthStore: WatchStepHealthProviding {
  nonisolated static let statisticsOptions: HKStatisticsOptions = .cumulativeSum

  private let healthStore: HKHealthStore
  private let healthDataAvailable: () -> Bool
  private var observerQuery: HKObserverQuery?

  init(
    healthStore: HKHealthStore = HKHealthStore(),
    healthDataAvailable: @escaping () -> Bool = HKHealthStore.isHealthDataAvailable
  ) {
    self.healthStore = healthStore
    self.healthDataAvailable = healthDataAvailable
  }

  nonisolated static func queryRange(now: Date, calendar: Calendar) -> Range<Date> {
    let start = calendar.startOfDay(for: now)
    return start..<now
  }

  func permissionStatus() async -> WatchHealthPermissionStatus {
    guard healthDataAvailable(), let stepType = Self.stepType else {
      return .unavailable
    }

    return await withCheckedContinuation { continuation in
      healthStore.getRequestStatusForAuthorization(toShare: [], read: [stepType]) {
        status, _ in
        switch status {
        case .shouldRequest:
          continuation.resume(returning: .notDetermined)
        case .unnecessary, .unknown:
          // HealthKit intentionally does not reveal read authorization. Once the
          // request has been handled, query results/errors are the source of truth.
          continuation.resume(returning: .requested)
        @unknown default:
          continuation.resume(returning: .requested)
        }
      }
    }
  }

  func requestPermission() async -> WatchHealthPermissionStatus {
    guard healthDataAvailable(), let stepType = Self.stepType else {
      return .unavailable
    }

    return await withCheckedContinuation { continuation in
      healthStore.requestAuthorization(toShare: [], read: [stepType]) { success, error in
        if Self.isAuthorizationDenied(error) {
          continuation.resume(returning: .denied)
        } else {
          continuation.resume(returning: success ? .requested : .denied)
        }
      }
    }
  }

  func fetchCurrentDaySteps(
    now: Date = Date(),
    calendar: Calendar = .current
  ) async throws -> WatchStepFetchOutcome {
    guard healthDataAvailable(), let stepType = Self.stepType else {
      return .unavailable
    }

    let permission = await permissionStatus()
    if permission == .notDetermined {
      return .empty(permission: permission)
    }

    let range = Self.queryRange(now: now, calendar: calendar)
    let predicate = HKQuery.predicateForSamples(
      withStart: range.lowerBound,
      end: range.upperBound,
      options: .strictStartDate
    )

    return try await withCheckedThrowingContinuation { continuation in
      let query = HKStatisticsQuery(
        quantityType: stepType,
        quantitySamplePredicate: predicate,
        options: Self.statisticsOptions
      ) { _, statistics, error in
        if Self.isAuthorizationDenied(error) {
          continuation.resume(returning: .denied)
          return
        }
        if let error {
          continuation.resume(throwing: error)
          return
        }
        guard let statistics else {
          continuation.resume(throwing: WatchStepsHealthStoreError.queryReturnedNoStatistics)
          return
        }
        guard let sum = statistics.sumQuantity() else {
          continuation.resume(returning: .empty(permission: permission))
          return
        }

        let rawSteps = sum.doubleValue(for: .count())
        let steps = Int(max(0, rawSteps).rounded())
        continuation.resume(
          returning: .value(
            WatchStepReading(
              steps: steps,
              startDate: range.lowerBound,
              endDate: range.upperBound,
              refreshedAt: now
            )))
      }
      healthStore.execute(query)
    }
  }

  func startBackgroundUpdates(
    onUpdate: @MainActor @escaping () async -> Void
  ) async throws {
    guard healthDataAvailable(), let stepType = Self.stepType else {
      throw WatchStepsHealthStoreError.missingStepType
    }
    guard observerQuery == nil else {
      return
    }

    let query = HKObserverQuery(sampleType: stepType, predicate: nil) {
      _, completion, error in
      guard error == nil else {
        completion()
        return
      }
      let completionBox = WatchHealthObserverCompletion(completion)
      Task { @MainActor in
        await onUpdate()
        completionBox.finish()
      }
    }
    observerQuery = query
    healthStore.execute(query)

    try await withCheckedThrowingContinuation { continuation in
      healthStore.enableBackgroundDelivery(for: stepType, frequency: .immediate) {
        success, _ in
        if success {
          continuation.resume(returning: ())
        } else {
          continuation.resume(throwing: WatchStepsHealthStoreError.backgroundDeliveryFailed)
        }
      }
    }
  }

  private static var stepType: HKQuantityType? {
    HKQuantityType.quantityType(forIdentifier: .stepCount)
  }

  nonisolated private static func isAuthorizationDenied(_ error: Error?) -> Bool {
    guard let healthKitError = error as? HKError else {
      return false
    }
    return healthKitError.code == .errorAuthorizationDenied
  }
}

private final class WatchHealthObserverCompletion: @unchecked Sendable {
  private let completion: () -> Void

  init(_ completion: @escaping () -> Void) {
    self.completion = completion
  }

  func finish() {
    completion()
  }
}
