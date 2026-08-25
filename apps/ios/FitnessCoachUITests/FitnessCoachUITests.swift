import XCTest

final class FitnessCoachUITests: XCTestCase {
    private let healthKitReadAuthorizationLaunchArguments = [
        "-AppleLanguages", "(en)",
        "-AppleLocale", "en_US",
        "-FitnessCoach.HealthKit.ReadAuthorizationRequested", "YES",
        "-FitnessCoach.HealthKit.ReadAuthorizationDescriptorSignature",
        [
            "weight",
            "steps",
            "active_energy",
            "resting_energy",
            "sleep",
            "heart_rate",
            "resting_heart_rate",
            "walking_heart_rate",
            "dietary_energy",
            "protein",
            "carbs",
            "fat",
            "fiber",
        ].joined(separator: ","),
    ]

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testLaunchAndShowsSyncProgressWhenSyncIsTapped() throws {
        let app = XCUIApplication()

        app.launchEnvironment["FITNESS_UI_TEST_MODE"] = "1"
        app.launchEnvironment["FITNESS_UI_TEST_SYNC_SCENARIO"] = "progress"
        app.launchEnvironment["ALLOW_LIVE_HEALTH_DATA"] = "0"
        app.launchEnvironment["ALLOW_HOSTED_HEALTH_BACKEND"] = "0"
        app.launchEnvironment["FITNESS_HEALTH_SYNC_TOKEN"] = ""
        app.launchArguments += healthKitReadAuthorizationLaunchArguments
        app.launch()

        XCTAssertTrue(app.staticTexts["Today"].waitForExistence(timeout: 5))

        let syncButton = app.buttons["Sync Health Deltas"]

        XCTAssertTrue(syncButton.waitForExistence(timeout: 5))
        XCTAssertTrue(syncButton.isHittable)

        syncButton.tap()

        let progressElement = app.descendants(matching: .any)["healthSyncProgress"]

        XCTAssertTrue(syncButton.exists)
        XCTAssertFalse(app.buttons["Syncing Health Deltas"].exists)
        XCTAssertTrue(progressElement.waitForExistence(timeout: 5))
        XCTAssertTrue(
            progressElement.value
                as? String == "Syncing Apple Health, 34 percent, 12,500 of 37,250 daily rows synced"
        )

        XCTAssertTrue(app.descendants(matching: .any)["lastSyncStatus"].waitForExistence(timeout: 7))
        XCTAssertTrue(app.descendants(matching: .any)["lastSyncSamples"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["lastSyncDeleted"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["lastSyncUpload"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["lastSyncMetrics"].exists)
    }

    @MainActor
    func testLaunchAndTapSyncHealthDeltasFailureScenario() throws {
        let app = XCUIApplication()

        app.launchEnvironment["FITNESS_UI_TEST_MODE"] = "1"
        app.launchEnvironment["FITNESS_UI_TEST_SYNC_SCENARIO"] = "failure"
        app.launchEnvironment["ALLOW_LIVE_HEALTH_DATA"] = "0"
        app.launchEnvironment["ALLOW_HOSTED_HEALTH_BACKEND"] = "0"
        app.launchEnvironment["FITNESS_HEALTH_SYNC_TOKEN"] = ""
        app.launchArguments += healthKitReadAuthorizationLaunchArguments
        app.launch()

        XCTAssertTrue(app.staticTexts["Today"].waitForExistence(timeout: 5))

        let syncButton = app.buttons["Sync Health Deltas"]

        XCTAssertTrue(syncButton.waitForExistence(timeout: 5))
        syncButton.tap()

        let failureText = app.staticTexts["Sync failed: Simulated sync failure."]
        if !failureText.waitForExistence(timeout: 2) {
            app.scrollViews.firstMatch.swipeUp()
        }

        XCTAssertTrue(failureText.waitForExistence(timeout: 5))
        XCTAssertTrue(syncButton.isEnabled)
    }

    @MainActor
    func testSettingsCanOpenWhileSyncProgressIsVisible() throws {
        let app = XCUIApplication()

        app.launchEnvironment["FITNESS_UI_TEST_MODE"] = "1"
        app.launchEnvironment["FITNESS_UI_TEST_SYNC_SCENARIO"] = "progress"
        app.launchEnvironment["ALLOW_LIVE_HEALTH_DATA"] = "0"
        app.launchEnvironment["ALLOW_HOSTED_HEALTH_BACKEND"] = "0"
        app.launchEnvironment["FITNESS_HEALTH_SYNC_TOKEN"] = ""
        app.launchArguments += healthKitReadAuthorizationLaunchArguments
        app.launch()

        XCTAssertTrue(app.staticTexts["Today"].waitForExistence(timeout: 5))

        let syncButton = app.buttons["Sync Health Deltas"]

        XCTAssertTrue(syncButton.waitForExistence(timeout: 5))
        syncButton.tap()

        let progressElement = app.descendants(matching: .any)["healthSyncProgress"]

        XCTAssertTrue(progressElement.waitForExistence(timeout: 5))

        let settingsButton = app.buttons["Settings"]

        XCTAssertTrue(settingsButton.waitForExistence(timeout: 2))
        XCTAssertTrue(settingsButton.isHittable)
        settingsButton.tap()

        XCTAssertTrue(app.staticTexts["Sync Controls"].waitForExistence(timeout: 3))
    }

    @MainActor
    func testMetricChartShowsWindowAndDisplayControls() throws {
        let app = XCUIApplication()

        app.launchEnvironment["FITNESS_UI_TEST_MODE"] = "1"
        app.launchEnvironment["FITNESS_UI_TEST_CHART_DATA"] = "1"
        app.launchArguments += healthKitReadAuthorizationLaunchArguments
        app.launch()

        XCTAssertTrue(app.staticTexts["Today"].waitForExistence(timeout: 5))

        let dashboardWeightMetric = app.buttons
            .matching(NSPredicate(format: "label CONTAINS %@", "Weight"))
            .firstMatch

        XCTAssertTrue(dashboardWeightMetric.waitForExistence(timeout: 5))
        dashboardWeightMetric.tap()

        XCTAssertTrue(app.navigationBars["Weight"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["metricChartDisplayMode"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.buttons["1D values"].exists)
        XCTAssertTrue(app.buttons["3D Avg values"].exists)
        XCTAssertTrue(app.buttons["1W Avg values"].exists)
        XCTAssertTrue(app.buttons["2W Avg values"].exists)
        XCTAssertTrue(app.buttons["1M Avg values"].exists)
        XCTAssertTrue(app.buttons["90D Avg values"].exists)
        XCTAssertTrue(app.staticTexts["Since High"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["metricTrendChart"].exists)
        XCTAssertTrue(app.buttons["metricChartMoveEarlier"].exists)
        XCTAssertTrue(app.buttons["metricChartMoveLater"].exists)
        XCTAssertTrue(app.buttons["metricChartRangeMenu"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["metricChartRangeSelector"].exists)

        if !app.staticTexts["History"].exists {
            app.swipeUp()
        }
        XCTAssertTrue(app.staticTexts["History"].exists)
        XCTAssertTrue(app.buttons["metricHistoryOlder"].exists)

        let oneWeekAverageButton = app.buttons["1W Avg values"]
        let oneMonthAverageButton = app.buttons["1M Avg values"]

        XCTAssertTrue(oneWeekAverageButton.exists)
        oneWeekAverageButton.tap()
        XCTAssertTrue(oneMonthAverageButton.exists)
        oneMonthAverageButton.tap()
    }
}
