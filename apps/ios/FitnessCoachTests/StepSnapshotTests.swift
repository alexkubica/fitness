import XCTest
@testable import FitnessCoach

final class StepSnapshotTests: XCTestCase {
    func testSnapshotPersistsInUserDefaults() throws {
        let suiteName = "StepSnapshotTests.persist"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaults.removePersistentDomain(forName: suiteName)
        let now = Date(timeIntervalSince1970: 1_800_123_456)
        let snapshot = StepSnapshot(
            state: .ready,
            stepCount: 9_876,
            sevenDayAverage: 8_765,
            localDate: "2027-01-16",
            timezoneIdentifier: "Asia/Jerusalem",
            sourceDate: now,
            updatedAt: now
        )

        StepSnapshotStore.save(snapshot, defaults: defaults)

        XCTAssertEqual(StepSnapshotStore.load(defaults: defaults), snapshot)
    }

    func testSnapshotPayloadRoundTripsForWatchConnectivity() throws {
        let now = Date(timeIntervalSince1970: 1_800_123_456)
        let snapshot = StepSnapshot(
            state: .ready,
            stepCount: 12_345,
            sevenDayAverage: 10_001,
            localDate: "2027-01-16",
            timezoneIdentifier: "Asia/Jerusalem",
            sourceDate: now,
            updatedAt: now
        )
        var payload: [String: Any] = [:]

        snapshot.applying(to: &payload)

        XCTAssertEqual(StepSnapshot.fromPayload(payload), snapshot)
    }

    func testDashboardSnapshotPersistsInUserDefaults() throws {
        let suiteName = "StepSnapshotTests.dashboard.persist"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaults.removePersistentDomain(forName: suiteName)
        let now = Date(timeIntervalSince1970: 1_800_123_456)
        let snapshot = HealthDashboardSnapshot.ready(
            metrics: [
                HealthDashboardMetric(
                    metricName: "steps",
                    title: "Steps",
                    valueText: "9,876",
                    caption: "Today",
                    detailText: "7D avg 8,765",
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
            ],
            now: now
        )

        HealthDashboardSnapshotStore.save(snapshot, defaults: defaults)

        XCTAssertEqual(HealthDashboardSnapshotStore.load(defaults: defaults), snapshot)
    }

    func testDashboardSnapshotPayloadRoundTripsForWatchConnectivity() throws {
        let now = Date(timeIntervalSince1970: 1_800_123_456)
        let snapshot = HealthDashboardSnapshot.ready(
            metrics: [
                HealthDashboardMetric(
                    metricName: "protein",
                    title: "Protein",
                    valueText: "128 g",
                    caption: "Latest",
                    detailText: nil,
                    systemImage: "fish",
                    accentColorName: .lime,
                    sortOrder: 1
                ),
            ],
            now: now
        )
        var payload: [String: Any] = [:]

        snapshot.applying(to: &payload)

        XCTAssertEqual(HealthDashboardSnapshot.fromPayload(payload), snapshot)
    }

    func testMetricDeepLinkRoundTripsMetricName() throws {
        let url = try XCTUnwrap(
            FitnessCoachDeepLink.metricURL(metricName: "resting_heart_rate")
        )

        XCTAssertEqual(url.absoluteString, "fitnesscoach://metric/resting_heart_rate")
        XCTAssertEqual(
            FitnessCoachDeepLink.metricName(from: url),
            "resting_heart_rate"
        )
    }

    func testNutritionSnapshotPersistsAndRoundTripsForWidgetAndWatch() throws {
        let suiteName = "StepSnapshotTests.nutrition.persist"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaults.removePersistentDomain(forName: suiteName)
        let now = Date(timeIntervalSince1970: 1_800_123_456)
        let snapshot = NutritionCoachSnapshot(
            localDate: "2027-01-16",
            timezoneIdentifier: "Asia/Jerusalem",
            actualCalories: 860,
            calorieTarget: 2_100,
            actualProtein: 74,
            proteinTarget: 155,
            nextPlannedMealTitle: "Snack",
            nextPlannedMealTime: "17:00",
            latestHunger: 6,
            quickAction: "confirm",
            updatedAt: now
        )
        var payload: [String: Any] = [:]

        NutritionCoachSnapshotStore.save(snapshot, defaults: defaults)
        snapshot.applying(to: &payload)

        XCTAssertEqual(NutritionCoachSnapshotStore.load(defaults: defaults), snapshot)
        XCTAssertEqual(NutritionCoachSnapshot.fromPayload(payload), snapshot)
        XCTAssertEqual(snapshot.calorieText, "860 / 2,100 kcal")
        XCTAssertEqual(snapshot.proteinText, "74 / 155 g")
        XCTAssertEqual(snapshot.nextMealText, "Snack 17:00")
        XCTAssertEqual(snapshot.hungerText, "Hunger 6/10")
        XCTAssertEqual(snapshot.quickActionURL?.absoluteString, "fitnesscoach://action/confirm")
    }

    func testActionDeepLinkRoundTripsActionName() throws {
        let url = try XCTUnwrap(FitnessCoachDeepLink.actionURL("urge"))

        XCTAssertEqual(url.absoluteString, "fitnesscoach://action/urge")
        XCTAssertEqual(FitnessCoachDeepLink.actionName(from: url), "urge")
        XCTAssertNil(FitnessCoachDeepLink.actionURL(""))
        XCTAssertNil(
            FitnessCoachDeepLink.actionName(
                from: try XCTUnwrap(URL(string: "fitnesscoach://metric/steps"))
            )
        )
    }

    func testMetricDeepLinkRejectsNonMetricURLs() throws {
        XCTAssertNil(FitnessCoachDeepLink.metricURL(metricName: ""))
        XCTAssertNil(
            FitnessCoachDeepLink.metricName(
                from: try XCTUnwrap(URL(string: "fitnesscoach://settings"))
            )
        )
        XCTAssertNil(
            FitnessCoachDeepLink.metricName(
                from: try XCTUnwrap(URL(string: "https://fitness-ten-fawn.vercel.app"))
            )
        )
    }

    func testAppAndWidgetEntitlementsShareOnlyTheWidgetAppGroup() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let appEntitlements = try entitlementDictionary(
            at: root.appendingPathComponent("FitnessCoach/FitnessCoach.entitlements")
        )
        let widgetEntitlements = try entitlementDictionary(
            at: root.appendingPathComponent("FitnessCoachStepsWidget/FitnessCoachStepsWidget.entitlements")
        )

        XCTAssertEqual(
            appEntitlements["com.apple.security.application-groups"] as? [String],
            [StepSnapshotStore.appGroupIdentifier]
        )
        XCTAssertEqual(
            widgetEntitlements["com.apple.security.application-groups"] as? [String],
            [StepSnapshotStore.appGroupIdentifier]
        )
        XCTAssertNil(widgetEntitlements["com.apple.developer.healthkit"])
    }

    func testAppInfoPlistSupportsLiveActivities() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let infoURL = root.appendingPathComponent("FitnessCoach/Info.plist")
        let data = try Data(contentsOf: infoURL)
        let info = try XCTUnwrap(
            PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        )

        XCTAssertEqual(info["NSSupportsLiveActivities"] as? Bool, true)
    }

    private func entitlementDictionary(at url: URL) throws -> [String: Any] {
        let data = try Data(contentsOf: url)

        return try XCTUnwrap(
            PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        )
    }
}
