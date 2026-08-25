import HealthKit
import XCTest
@testable import FitnessCoach

final class HealthKitStoreTests: XCTestCase {
    func testInfoPlistDeclaresFullscreenLaunchConfiguration() throws {
        let infoPlistURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("FitnessCoach/Info.plist")
        let data = try Data(contentsOf: infoPlistURL)
        let plist = try XCTUnwrap(
            PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        )

        XCTAssertEqual(plist["UIRequiresFullScreen"] as? Bool, true)
        XCTAssertNotNil(plist["UILaunchScreen"] as? [String: Any])
        XCTAssertEqual(
            plist["BGTaskSchedulerPermittedIdentifiers"] as? [String],
            [HealthKitStore.backgroundProcessingTaskIdentifier]
        )
        XCTAssertEqual(plist["UIBackgroundModes"] as? [String], ["processing"])
    }

    @MainActor
    func testAuthorizationSummaryUsesPersistedRequestedState() {
        let defaults = UserDefaults(suiteName: "HealthKitStoreTests.authorization")!
        defaults.removePersistentDomain(forName: "HealthKitStoreTests.authorization")

        defaults.set(
            true,
            forKey: HealthKitStore.readAuthorizationRequestedDefaultsKey
        )
        defaults.set(
            HealthKitStore.readAuthorizationDescriptorSignature,
            forKey: HealthKitStore.readAuthorizationDescriptorSignatureDefaultsKey
        )
        let store = HealthKitStore(authorizationDefaults: defaults)

        if case .unavailable = store.authorizationSummary {
            return
        }

        XCTAssertEqual(store.authorizationSummary, .requested)
    }

    @MainActor
    func testAuthorizationSummaryRequiresCurrentDescriptorSignature() {
        let defaults = UserDefaults(suiteName: "HealthKitStoreTests.staleAuthorization")!
        defaults.removePersistentDomain(forName: "HealthKitStoreTests.staleAuthorization")

        defaults.set(
            true,
            forKey: HealthKitStore.readAuthorizationRequestedDefaultsKey
        )

        XCTAssertFalse(HealthKitStore.hasCurrentReadAuthorizationRequest(in: defaults))

        let store = HealthKitStore(authorizationDefaults: defaults)

        if case .unavailable = store.authorizationSummary {
            return
        }

        XCTAssertEqual(store.authorizationSummary, .notRequested)
    }

    @MainActor
    func testFirstSliceRequestsReadTypesAndSeparateNutritionWriteTypes() {
        let descriptors = HealthKitStore.firstSliceReadDescriptors
        let identifiers = Set(descriptors.map(\.metricName))

        XCTAssertEqual(identifiers, [
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
        ])
        XCTAssertEqual(HealthKitStore.writeTypesForFirstSlice, [])
        XCTAssertEqual(
            Set(HealthKitStore.nutritionWriteDescriptors.map(\.metricName)),
            ["dietary_energy", "protein", "carbs", "fat", "fiber"]
        )
        XCTAssertEqual(HealthKitStore.nutritionWriteTypes.count, 5)
    }

    @MainActor
    func testBackgroundDeliveryTracksEveryFirstSliceReadDescriptor() {
        XCTAssertEqual(
            HealthKitStore.backgroundDeliveryMetricNames,
            HealthKitStore.firstSliceReadDescriptors.map(\.metricName)
        )
        XCTAssertEqual(HealthKitStore.backgroundDeliveryFrequency, .hourly)
    }

    @MainActor
    func testLastSuccessfulSyncAtUsesPersistedValue() {
        let defaults = UserDefaults(suiteName: "HealthKitStoreTests.lastSuccessfulSync")!
        defaults.removePersistentDomain(forName: "HealthKitStoreTests.lastSuccessfulSync")
        let timestamp = Date(timeIntervalSince1970: 1_781_950_400)

        defaults.set(
            timestamp.timeIntervalSince1970,
            forKey: HealthKitStore.lastSuccessfulSyncAtDefaultsKey
        )

        let store = HealthKitStore(authorizationDefaults: defaults)

        XCTAssertEqual(store.lastSuccessfulSyncAt, timestamp)
    }

    func testForegroundAutoSyncRunsOnAppEntryWithCooldown() {
        let now = Date(timeIntervalSince1970: 1_781_950_400)

        XCTAssertTrue(
            HealthSyncAutomation.shouldAutoSyncOnForeground(
                isEnabled: true,
                isUITestMode: false,
                authorizationSummary: .requested,
                isRequestingAuthorization: false,
                isSyncing: false,
                allowLiveHealthData: true,
                allowHostedBackend: true,
                backendURLString: "https://fitness-ten-fawn.vercel.app",
                lastAttemptAt: nil,
                now: now
            )
        )

        XCTAssertFalse(
            HealthSyncAutomation.shouldAutoSyncOnForeground(
                isEnabled: true,
                isUITestMode: false,
                authorizationSummary: .requested,
                isRequestingAuthorization: false,
                isSyncing: false,
                allowLiveHealthData: true,
                allowHostedBackend: true,
                backendURLString: "https://fitness-ten-fawn.vercel.app",
                lastAttemptAt: now.addingTimeInterval(
                    -HealthSyncAutomation.foregroundAttemptCooldown + 1
                ),
                now: now
            ),
            "recent foreground attempt should respect cooldown"
        )

        XCTAssertFalse(
            HealthSyncAutomation.shouldAutoSyncOnForeground(
                isEnabled: true,
                isUITestMode: true,
                authorizationSummary: .requested,
                isRequestingAuthorization: false,
                isSyncing: false,
                allowLiveHealthData: true,
                allowHostedBackend: true,
                backendURLString: "https://fitness-ten-fawn.vercel.app",
                lastAttemptAt: nil,
                now: now
            ),
            "UI test mode must suppress app-entry sync"
        )

        XCTAssertFalse(
            HealthSyncAutomation.shouldAutoSyncOnForeground(
                isEnabled: true,
                isUITestMode: false,
                authorizationSummary: .notRequested,
                isRequestingAuthorization: false,
                isSyncing: false,
                allowLiveHealthData: true,
                allowHostedBackend: true,
                backendURLString: "https://fitness-ten-fawn.vercel.app",
                lastAttemptAt: nil,
                now: now
            ),
            "missing HealthKit permission should suppress app-entry sync"
        )
    }

    func testManualSyncStartsSignInWhenHostedUploadNeedsAccount() {
        XCTAssertTrue(
            HealthSyncAutomation.shouldStartSignInBeforeManualSync(
                allowLiveHealthData: true,
                allowHostedBackend: true,
                backendURLString: "https://fitness-ten-fawn.vercel.app",
                isSignedIn: false,
                isSigningIn: false
            )
        )

        XCTAssertFalse(
            HealthSyncAutomation.shouldStartSignInBeforeManualSync(
                allowLiveHealthData: true,
                allowHostedBackend: true,
                backendURLString: "https://fitness-ten-fawn.vercel.app",
                isSignedIn: true,
                isSigningIn: false
            )
        )

        XCTAssertFalse(
            HealthSyncAutomation.shouldStartSignInBeforeManualSync(
                allowLiveHealthData: true,
                allowHostedBackend: true,
                backendURLString: "",
                isSignedIn: false,
                isSigningIn: false
            )
        )
    }

    func testNutritionTargetsUseGoalAndBaseline() {
        let profile = CoachProfile(
            goal: .loseWeight,
            weightKg: 87.5,
            estimatedStepsPerDay: 10_000,
            wakeTimeMinutes: 450,
            sleepTimeMinutes: 1_410,
            breakfastTimeMinutes: 540,
            lunchTimeMinutes: 780,
            snackTimeMinutes: 990,
            dinnerTimeMinutes: 1_200,
            mealRemindersEnabled: true,
            completedAt: Date(timeIntervalSince1970: 1_781_950_400)
        )

        let targets = NutritionTargetCalculator.targets(for: profile)

        XCTAssertEqual(targets.maintainCalories, 2_300)
        XCTAssertEqual(targets.loseCalories, 1_800)
        XCTAssertEqual(targets.gainCalories, 2_700)
        XCTAssertEqual(targets.selectedCalories, 1_800)
        XCTAssertEqual(targets.proteinGrams, 160)
        XCTAssertEqual(targets.fatGrams, 60)
        XCTAssertEqual(targets.carbGrams, 155)
        XCTAssertEqual(targets.fiberGrams, 30)
    }

    func testMealLogStorePersistsAndTotalsToday() {
        let suiteName = "MealLogStoreTests.persistence"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let store = MealLogStore(defaults: defaults)
        let now = Date(timeIntervalSince1970: 1_781_950_400)
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now)!

        store.add(
            MealLogEntry(
                id: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
                loggedAt: now,
                title: "Eggs and toast",
                note: "",
                totals: MacroTotals(
                    calories: 430,
                    proteinGrams: 28,
                    carbsGrams: 34,
                    fatGrams: 18,
                    fiberGrams: 5
                ),
                createdAt: now
            )
        )
        store.add(
            MealLogEntry(
                id: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!,
                loggedAt: yesterday,
                title: "Dinner",
                note: "",
                totals: MacroTotals(
                    calories: 900,
                    proteinGrams: 55,
                    carbsGrams: 90,
                    fatGrams: 35,
                    fiberGrams: 8
                ),
                createdAt: yesterday
            )
        )

        let totals = store.totals(on: now)
        let reloadedStore = MealLogStore(defaults: defaults)

        XCTAssertEqual(totals.calories, 430)
        XCTAssertEqual(totals.proteinGrams, 28)
        XCTAssertEqual(reloadedStore.meals.count, 2)
        XCTAssertEqual(reloadedStore.meals(on: now).map(\.title), ["Eggs and toast"])
    }

    func testMealIngredientRecalculatesWhenPortionChanges() {
        var ingredient = MealIngredientEntry(
            name: "cooked rice",
            quantity: 1,
            unit: "cup",
            baseQuantity: 1,
            baseUnit: "cup",
            baseGrams: 158,
            baseTotals: MacroTotals(
                calories: 205,
                proteinGrams: 4.3,
                carbsGrams: 44.5,
                fatGrams: 0.4,
                fiberGrams: 0.6
            )
        )

        ingredient.quantity = 2

        XCTAssertEqual(ingredient.totals.calories, 410)
        XCTAssertEqual(ingredient.totals.carbsGrams, 89)

        ingredient.changeUnit(to: "g")

        XCTAssertEqual(ingredient.quantity, 316)
        XCTAssertEqual(ingredient.totals.calories, 410)
    }

    func testMealLogStorePersistsIngredientBreakdown() {
        let suiteName = "MealLogStoreTests.ingredients"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let store = MealLogStore(defaults: defaults)
        let now = Date(timeIntervalSince1970: 1_781_950_400)

        store.add(
            MealLogEntry(
                id: UUID(uuidString: "99999999-9999-9999-9999-999999999999")!,
                loggedAt: now,
                mealType: "Lunch",
                title: "Rice and chicken",
                note: "",
                totals: MacroTotals(
                    calories: 470,
                    proteinGrams: 49,
                    carbsGrams: 45,
                    fatGrams: 6,
                    fiberGrams: 1
                ),
                ingredients: [
                    MealIngredientEntry(
                        name: "cooked rice",
                        quantity: 1,
                        unit: "cup",
                        baseQuantity: 1,
                        baseUnit: "cup",
                        baseGrams: 158,
                        baseTotals: MacroTotals(
                            calories: 205,
                            proteinGrams: 4.3,
                            carbsGrams: 44.5,
                            fatGrams: 0.4,
                            fiberGrams: 0.6
                        )
                    )
                ],
                estimateStatus: .aiEstimated,
                estimateConfidence: 0.86,
                createdAt: now
            )
        )

        let reloadedStore = MealLogStore(defaults: defaults)
        let reloadedMeal = reloadedStore.meals[0]

        XCTAssertEqual(reloadedMeal.ingredients.count, 1)
        XCTAssertEqual(reloadedMeal.ingredients[0].name, "cooked rice")
        XCTAssertEqual(reloadedMeal.ingredients[0].availableUnits, ["cup", "g"])
    }

    func testMealLogStoreSuppressesPendingDeletedRemoteMeals() {
        let suiteName = "MealLogStoreTests.deletedRemote"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let store = MealLogStore(defaults: defaults)
        let mealId = UUID(uuidString: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")!
        let now = Date(timeIntervalSince1970: 1_781_950_400)
        let meal = MealLogEntry(
            id: mealId,
            loggedAt: now,
            mealType: "Lunch",
            title: "Tuna",
            note: "",
            totals: MacroTotals(
                calories: 195,
                proteinGrams: 26,
                carbsGrams: 0,
                fatGrams: 10,
                fiberGrams: 0
            ),
            createdAt: now
        )

        store.add(meal)
        store.delete(meal)
        store.mergeRemote([meal])

        XCTAssertTrue(store.meals.isEmpty)
        XCTAssertEqual(store.pendingDeletedMealIds, [mealId])

        let reloadedStore = MealLogStore(defaults: defaults)
        reloadedStore.mergeRemote([meal])

        XCTAssertTrue(reloadedStore.meals.isEmpty)
        XCTAssertEqual(reloadedStore.pendingDeletedMealIds, [mealId])

        reloadedStore.markRemoteDeleteCompleted(mealId: mealId)
        reloadedStore.mergeRemote([meal])

        XCTAssertEqual(reloadedStore.meals.map(\.id), [mealId])
        XCTAssertTrue(reloadedStore.pendingDeletedMealIds.isEmpty)
    }

    func testSavedMealStoreKeepsRecentReusableTemplates() {
        let suiteName = "SavedMealStoreTests.persistence"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let store = SavedMealStore(defaults: defaults)
        let now = Date(timeIntervalSince1970: 1_781_950_400)
        let meal = MealLogEntry(
            id: UUID(uuidString: "88888888-8888-8888-8888-888888888888")!,
            loggedAt: now,
            mealType: "Lunch",
            title: "Rice and chicken",
            note: "",
            totals: MacroTotals(
                calories: 470,
                proteinGrams: 49,
                carbsGrams: 45,
                fatGrams: 6,
                fiberGrams: 1
            ),
            ingredients: [
                MealIngredientEntry(
                    name: "cooked chicken breast",
                    quantity: 150,
                    unit: "g",
                    baseQuantity: 150,
                    baseUnit: "g",
                    baseGrams: 150,
                    baseTotals: MacroTotals(
                        calories: 248,
                        proteinGrams: 46.5,
                        carbsGrams: 0,
                        fatGrams: 5.4,
                        fiberGrams: 0
                    )
                )
            ],
            createdAt: now
        )

        store.saveTemplate(from: meal, now: now)

        let reloadedStore = SavedMealStore(defaults: defaults)

        XCTAssertEqual(reloadedStore.templates.count, 1)
        XCTAssertEqual(reloadedStore.templates[0].title, "Rice and chicken")
        XCTAssertEqual(reloadedStore.templates[0].ingredients.count, 1)
    }

    func testRecentFoodSuggestionsUsePreviousMealIngredients() {
        let now = Date(timeIntervalSince1970: 1_781_950_400)
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now)!
        let older = Calendar.current.date(byAdding: .day, value: -3, to: now)!
        let milk = MealIngredientEntry(
            name: "cup of milk",
            quantity: 1,
            unit: "cup",
            baseQuantity: 1,
            baseUnit: "cup",
            baseGrams: 244,
            baseTotals: MacroTotals(
                calories: 122,
                proteinGrams: 8,
                carbsGrams: 12,
                fatGrams: 5,
                fiberGrams: 0
            )
        )
        let whiteCheese = MealIngredientEntry(
            name: "white cheese",
            quantity: 100,
            unit: "g",
            baseQuantity: 100,
            baseUnit: "g",
            baseGrams: 100,
            baseTotals: MacroTotals(
                calories: 95,
                proteinGrams: 10,
                carbsGrams: 4,
                fatGrams: 5,
                fiberGrams: 0
            )
        )
        let olderMilk = MealIngredientEntry(
            name: " Cup   Of Milk ",
            quantity: 0.5,
            unit: "cup",
            baseQuantity: 1,
            baseUnit: "cup",
            baseGrams: 244,
            baseTotals: milk.baseTotals
        )
        let meals = [
            MealLogEntry(
                id: UUID(uuidString: "33333333-3333-3333-3333-333333333333")!,
                loggedAt: older,
                mealType: "Breakfast",
                title: "Milk",
                note: "",
                totals: olderMilk.totals,
                ingredients: [olderMilk],
                createdAt: older
            ),
            MealLogEntry(
                id: UUID(uuidString: "44444444-4444-4444-4444-444444444444")!,
                loggedAt: yesterday,
                mealType: "Breakfast",
                title: "Milk and cheese",
                note: "",
                totals: milk.totals + whiteCheese.totals,
                ingredients: [milk, whiteCheese],
                createdAt: yesterday
            ),
        ]

        let suggestions = FoodIngredientSuggestion.recent(meals: meals)

        XCTAssertEqual(suggestions.map(\.title), ["cup of milk", "white cheese"])
        XCTAssertEqual(suggestions[0].usageCount, 2)
        XCTAssertEqual(suggestions[0].detail, "1 cup · 122 kcal")
    }

    func testRecentFoodSuggestionsExcludeSelectedIngredients() {
        let now = Date(timeIntervalSince1970: 1_781_950_400)
        let milk = MealIngredientEntry(
            name: "cup of milk",
            quantity: 1,
            unit: "cup",
            baseQuantity: 1,
            baseUnit: "cup",
            baseGrams: 244,
            baseTotals: MacroTotals(
                calories: 122,
                proteinGrams: 8,
                carbsGrams: 12,
                fatGrams: 5,
                fiberGrams: 0
            )
        )
        let cheese = MealIngredientEntry(
            name: "white cheese",
            quantity: 100,
            unit: "g",
            baseQuantity: 100,
            baseUnit: "g",
            baseGrams: 100,
            baseTotals: MacroTotals(
                calories: 95,
                proteinGrams: 10,
                carbsGrams: 4,
                fatGrams: 5,
                fiberGrams: 0
            )
        )
        let meal = MealLogEntry(
            id: UUID(uuidString: "55555555-5555-5555-5555-555555555555")!,
            loggedAt: now,
            mealType: "Breakfast",
            title: "Milk and cheese",
            note: "",
            totals: milk.totals + cheese.totals,
            ingredients: [milk, cheese],
            createdAt: now
        )

        let suggestions = FoodIngredientSuggestion.recent(
            meals: [meal],
            excluding: [milk]
        )

        XCTAssertEqual(suggestions.map(\.title), ["white cheese"])
    }

    func testMealShortTitleUsesDescriptionWhenTitleIsEmpty() {
        XCTAssertEqual(
            MealLogEntry.shortTitle(
                from: "גבינה לבנה 250ג 5 אחוז\nעם מלפפון וקצת מלח",
                fallback: "Breakfast"
            ),
            "גבינה לבנה 250ג 5 אחוז עם מלפפון"
        )
        XCTAssertEqual(MealLogEntry.shortTitle(from: "", fallback: "Lunch"), "Lunch")
        XCTAssertTrue(MealLogEntry.isGenericTitle("Meal"))
    }

    func testCoachProfileDecodesLegacyMealTimesAsEditableSlots() throws {
        let legacyProfile = LegacyCoachProfileFixture(
            goal: .loseWeight,
            weightKg: 87.5,
            estimatedStepsPerDay: 10_000,
            wakeTimeMinutes: 450,
            sleepTimeMinutes: 1_410,
            breakfastTimeMinutes: 540,
            lunchTimeMinutes: 780,
            snackTimeMinutes: 990,
            dinnerTimeMinutes: 1_200,
            mealRemindersEnabled: true,
            completedAt: Date(timeIntervalSince1970: 1_781_950_400)
        )
        let data = try JSONEncoder().encode(legacyProfile)

        let profile = try JSONDecoder().decode(CoachProfile.self, from: data)

        XCTAssertEqual(profile.effectiveMealSlots.map(\.displayName), [
            "Breakfast",
            "Lunch",
            "Snack",
            "Dinner",
        ])
        XCTAssertEqual(profile.effectiveMealSlots.map(\.timeMinutes), [
            540,
            780,
            990,
            1_200,
        ])
    }

    func testMealLogStorePersistsMealTypesAndPhotoAttachments() {
        let suiteName = "MealLogStoreTests.photos"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let store = MealLogStore(defaults: defaults)
        let now = Date(timeIntervalSince1970: 1_781_950_400)

        store.add(
            MealLogEntry(
                id: UUID(uuidString: "33333333-3333-3333-3333-333333333333")!,
                loggedAt: now,
                mealType: "Lunch",
                title: "Chicken bowl",
                note: "extra rice",
                totals: MacroTotals(
                    calories: 720,
                    proteinGrams: 52,
                    carbsGrams: 75,
                    fatGrams: 20,
                    fiberGrams: 9
                ),
                createdAt: now
            ),
            photoData: [Data([0x01, 0x02, 0x03])]
        )

        let reloadedStore = MealLogStore(defaults: defaults)
        let reloadedMeal = reloadedStore.meals[0]

        XCTAssertEqual(reloadedMeal.mealType, "Lunch")
        XCTAssertEqual(reloadedMeal.photoAttachments.count, 1)
        XCTAssertEqual(reloadedStore.thumbnailData(for: reloadedMeal), Data([0x01, 0x02, 0x03]))
        XCTAssertTrue(
            FileManager.default.fileExists(
                atPath: reloadedStore.photoURL(
                    for: reloadedMeal.photoAttachments[0]
                ).path
            )
        )

        reloadedStore.delete(reloadedMeal)
        XCTAssertFalse(
            FileManager.default.fileExists(
                atPath: reloadedStore.photoURL(
                    for: reloadedMeal.photoAttachments[0]
                ).path
            )
        )
    }

    func testMealLogStoreUpdatesExistingMealAndRemovesOldPhotos() {
        let suiteName = "MealLogStoreTests.update"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let store = MealLogStore(defaults: defaults)
        let now = Date(timeIntervalSince1970: 1_781_950_400)
        let mealId = UUID(uuidString: "44444444-4444-4444-4444-444444444444")!

        store.add(
            MealLogEntry(
                id: mealId,
                loggedAt: now,
                mealType: "Breakfast",
                title: "Default breakfast",
                note: "",
                totals: MacroTotals(
                    calories: 500,
                    proteinGrams: 35,
                    carbsGrams: 45,
                    fatGrams: 18,
                    fiberGrams: 6
                ),
                createdAt: now
            ),
            photoData: [Data([0x01, 0x02, 0x03])]
        )
        let originalMeal = store.meals[0]
        let originalPhotoURL = store.photoURL(for: originalMeal.photoAttachments[0])

        store.update(
            MealLogEntry(
                id: mealId,
                loggedAt: now,
                mealType: "Breakfast",
                title: "גבינה לבנה 250ג 5 אחוז",
                note: "",
                totals: MacroTotals(
                    calories: 240,
                    proteinGrams: 22,
                    carbsGrams: 11,
                    fatGrams: 12,
                    fiberGrams: 0
                ),
                estimateStatus: .aiEstimated,
                estimateConfidence: 0.82,
                createdAt: now
            ),
            photoData: []
        )

        let updatedMeal = store.meals[0]

        XCTAssertEqual(store.meals.count, 1)
        XCTAssertEqual(updatedMeal.title, "גבינה לבנה 250ג 5 אחוז")
        XCTAssertEqual(updatedMeal.totals.calories, 240)
        XCTAssertEqual(updatedMeal.estimateStatus, .aiEstimated)
        XCTAssertEqual(updatedMeal.estimateConfidence, 0.82)
        XCTAssertTrue(updatedMeal.photoAttachments.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: originalPhotoURL.path))
    }

    func testMealLogStoreMetadataUpdatePreservesPhotos() {
        let suiteName = "MealLogStoreTests.metadataUpdate"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let store = MealLogStore(defaults: defaults)
        let now = Date(timeIntervalSince1970: 1_781_950_400)
        let mealId = UUID(uuidString: "55555555-5555-5555-5555-555555555555")!

        store.add(
            MealLogEntry(
                id: mealId,
                loggedAt: now,
                mealType: "Meal",
                title: "Tuna and cheese",
                note: "Tuna in oil and white cheese",
                totals: MacroTotals(
                    calories: 420,
                    proteinGrams: 44,
                    carbsGrams: 8,
                    fatGrams: 22,
                    fiberGrams: 0
                ),
                ingredients: [
                    MealIngredientEntry(
                        name: "Tuna in oil",
                        quantity: 100,
                        unit: "g",
                        baseQuantity: 100,
                        baseUnit: "g",
                        baseGrams: 100,
                        baseTotals: MacroTotals(
                            calories: 195,
                            proteinGrams: 26,
                            carbsGrams: 0,
                            fatGrams: 10,
                            fiberGrams: 0
                        )
                    )
                ],
                createdAt: now
            ),
            photoData: [Data([0x04, 0x05, 0x06])]
        )
        let originalMeal = store.meals[0]
        let originalAttachment = originalMeal.photoAttachments[0]
        let originalPhotoURL = store.photoURL(for: originalAttachment)

        var editedMeal = originalMeal
        editedMeal.ingredients = []
        editedMeal.totals = .zero

        let storedMeal = store.updateMetadata(editedMeal)

        XCTAssertEqual(storedMeal.photoAttachments, [originalAttachment])
        XCTAssertTrue(FileManager.default.fileExists(atPath: originalPhotoURL.path))
        XCTAssertTrue(store.meals[0].ingredients.isEmpty)
        XCTAssertEqual(store.meals[0].totals.calories, 0)
    }

    func testMealLogStoreReordersMealsWithinDay() {
        let suiteName = "MealLogStoreTests.reorderMeals"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let store = MealLogStore(defaults: defaults)
        let calendar = Calendar(identifier: .gregorian)
        let day = Date(timeIntervalSince1970: 1_781_950_400)
        let firstID = UUID(uuidString: "66666666-6666-6666-6666-666666666666")!
        let secondID = UUID(uuidString: "77777777-7777-7777-7777-777777777777")!

        store.add(
            MealLogEntry(
                id: firstID,
                loggedAt: day.addingTimeInterval(60),
                title: "First",
                note: "",
                totals: .zero,
                createdAt: day
            )
        )
        store.add(
            MealLogEntry(
                id: secondID,
                loggedAt: day.addingTimeInterval(120),
                title: "Second",
                note: "",
                totals: .zero,
                createdAt: day
            )
        )

        let changedMeals = store.reorderMeals(
            Array(store.meals(on: day, calendar: calendar).reversed()),
            on: day,
            calendar: calendar
        )

        XCTAssertEqual(changedMeals.count, 2)
        XCTAssertEqual(store.meals(on: day, calendar: calendar).map(\.id), [firstID, secondID])
    }

    func testMealLogStoreReordersIngredientsWithoutChangingTotals() {
        let suiteName = "MealLogStoreTests.reorderIngredients"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let store = MealLogStore(defaults: defaults)
        let now = Date(timeIntervalSince1970: 1_781_950_400)
        let firstIngredient = MealIngredientEntry(
            name: "Milk",
            quantity: 1,
            unit: "cup",
            baseQuantity: 1,
            baseUnit: "cup",
            baseGrams: nil,
            baseTotals: MacroTotals(calories: 120, proteinGrams: 8, carbsGrams: 12, fatGrams: 5, fiberGrams: 0)
        )
        let secondIngredient = MealIngredientEntry(
            name: "Cheese",
            quantity: 100,
            unit: "g",
            baseQuantity: 100,
            baseUnit: "g",
            baseGrams: 100,
            baseTotals: MacroTotals(calories: 200, proteinGrams: 18, carbsGrams: 4, fatGrams: 12, fiberGrams: 0)
        )
        let meal = store.add(
            MealLogEntry(
                id: UUID(uuidString: "88888888-8888-8888-8888-888888888888")!,
                loggedAt: now,
                title: "Dairy",
                note: "",
                totals: MacroTotals(calories: 320, proteinGrams: 26, carbsGrams: 16, fatGrams: 17, fiberGrams: 0),
                ingredients: [firstIngredient, secondIngredient],
                createdAt: now
            )
        )

        let reorderedMeal = store.reorderIngredients([secondIngredient, firstIngredient], in: meal)

        XCTAssertEqual(reorderedMeal.ingredients.map(\.id), [secondIngredient.id, firstIngredient.id])
        XCTAssertEqual(reorderedMeal.totals.calories, 320)
        XCTAssertEqual(store.meals[0].ingredients.map(\.id), [secondIngredient.id, firstIngredient.id])
    }

    func testMealPromptSectionsParseHebrewMealLabels() {
        let sections = MealLogEntry.promptSections(
            from: """
            בוקר
            גבינה לבנה
            צהריים חזה עוף
            """,
            titleFallback: "Meal"
        )

        XCTAssertEqual(sections.map(\.title), ["בוקר", "צהריים"])
        XCTAssertEqual(sections.map(\.prompt), ["גבינה לבנה", "חזה עוף"])
    }

    func testMealLogStoreMovesIngredientBetweenMeals() {
        let suiteName = "MealLogStoreTests.moveIngredient"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let store = MealLogStore(defaults: defaults)
        let now = Date(timeIntervalSince1970: 1_781_950_400)
        let ingredient = MealIngredientEntry(
            id: UUID(uuidString: "99999999-9999-9999-9999-999999999999")!,
            name: "Chicken",
            quantity: 100,
            unit: "g",
            baseQuantity: 100,
            baseUnit: "g",
            baseGrams: 100,
            baseTotals: MacroTotals(calories: 165, proteinGrams: 31, carbsGrams: 0, fatGrams: 4, fiberGrams: 0)
        )
        let sourceMeal = store.add(
            MealLogEntry(
                id: UUID(uuidString: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")!,
                loggedAt: now,
                title: "Lunch",
                note: "",
                totals: ingredient.totals,
                ingredients: [ingredient],
                createdAt: now
            )
        )
        let targetMeal = store.add(
            MealLogEntry(
                id: UUID(uuidString: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff")!,
                loggedAt: now.addingTimeInterval(-60),
                title: "Dinner",
                note: "",
                totals: .zero,
                ingredients: [],
                createdAt: now
            )
        )

        let changedMeals = store.moveIngredient(ingredient.id, to: targetMeal.id)

        XCTAssertEqual(Set(changedMeals.map(\.id)), Set([sourceMeal.id, targetMeal.id]))
        XCTAssertTrue(store.meals.first { $0.id == sourceMeal.id }?.ingredients.isEmpty == true)
        XCTAssertEqual(store.meals.first { $0.id == targetMeal.id }?.ingredients.map(\.id), [ingredient.id])
        XCTAssertEqual(store.meals.first { $0.id == targetMeal.id }?.totals.proteinGrams, 31)
    }

    func testMealLogStoreSuppressesDeletedRemoteMealBySignature() {
        let suiteName = "MealLogStoreTests.deletedRemoteSignature"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let store = MealLogStore(defaults: defaults)
        let now = Date(timeIntervalSince1970: 1_781_950_400)
        let localMeal = store.add(
            MealLogEntry(
                id: UUID(uuidString: "cccccccc-cccc-cccc-cccc-cccccccccccc")!,
                loggedAt: now,
                mealType: "בוקר",
                title: "גבינה לבנה",
                note: "גבינה לבנה",
                totals: MacroTotals(calories: 180, proteinGrams: 20, carbsGrams: 6, fatGrams: 8, fiberGrams: 0),
                ingredients: [
                    MealIngredientEntry(
                        name: "גבינה לבנה",
                        quantity: 100,
                        unit: "g",
                        baseQuantity: 100,
                        baseUnit: "g",
                        baseGrams: 100,
                        baseTotals: MacroTotals(calories: 180, proteinGrams: 20, carbsGrams: 6, fatGrams: 8, fiberGrams: 0)
                    )
                ],
                createdAt: now
            )
        )
        let remoteSameMealDifferentId = MealLogEntry(
            id: UUID(uuidString: "dddddddd-dddd-dddd-dddd-dddddddddddd")!,
            loggedAt: now.addingTimeInterval(30),
            mealType: "בוקר",
            title: "גבינה לבנה",
            note: "גבינה לבנה",
            totals: localMeal.totals,
            ingredients: localMeal.ingredients,
            createdAt: now
        )

        store.delete(localMeal)
        store.markRemoteDeleteCompleted(mealId: localMeal.id)
        store.mergeRemote([remoteSameMealDifferentId])

        XCTAssertTrue(store.meals.isEmpty)
        XCTAssertTrue(store.pendingDeletedMealIds.contains(remoteSameMealDifferentId.id))
    }

    func testMealLogStoreReplaceRemoteDayReflectsExternalMutation() throws {
        let suiteName = "MealLogStoreTests.replaceRemoteDay"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let store = MealLogStore(defaults: defaults)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "Asia/Jerusalem"))
        let localDay = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 6, day: 25)))
        let nextLocalDay = try XCTUnwrap(calendar.date(byAdding: .day, value: 1, to: localDay))
        let staleMeal = MealLogEntry(
            id: UUID(uuidString: "11111111-2222-3333-4444-555555555555")!,
            loggedAt: try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 6, day: 25, hour: 12))),
            title: "Old local meal",
            note: "",
            totals: MacroTotals(calories: 400, proteinGrams: 20, carbsGrams: 30, fatGrams: 18, fiberGrams: 2),
            createdAt: localDay
        )
        let externalMeal = MealLogEntry(
            id: UUID(uuidString: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")!,
            loggedAt: try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 6, day: 25, hour: 23, minute: 30))),
            title: "External MCP correction",
            note: "",
            totals: MacroTotals(calories: 250, proteinGrams: 30, carbsGrams: 5, fatGrams: 9, fiberGrams: 1),
            createdAt: localDay
        )

        store.add(staleMeal)
        store.replaceRemote([externalMeal], from: localDay, to: nextLocalDay)

        XCTAssertEqual(store.meals(on: localDay, calendar: calendar).map(\.title), ["External MCP correction"])
        XCTAssertEqual(store.totals(on: localDay, calendar: calendar).calories, 250)
        XCTAssertTrue(store.meals(on: nextLocalDay, calendar: calendar).isEmpty)
    }

    func testMealLogStoreReplaceRemoteDayRemovesExternallyDeletedMeals() throws {
        let suiteName = "MealLogStoreTests.replaceRemoteDayDelete"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let store = MealLogStore(defaults: defaults)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "Asia/Jerusalem"))
        let localDay = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 6, day: 25)))
        let nextLocalDay = try XCTUnwrap(calendar.date(byAdding: .day, value: 1, to: localDay))
        let localMeal = MealLogEntry(
            id: UUID(uuidString: "99999999-8888-7777-6666-555555555555")!,
            loggedAt: try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 6, day: 25, hour: 9))),
            title: "Deleted on server",
            note: "",
            totals: MacroTotals(calories: 500, proteinGrams: 25, carbsGrams: 40, fatGrams: 20, fiberGrams: 3),
            createdAt: localDay
        )

        store.add(localMeal)
        store.replaceRemote([], from: localDay, to: nextLocalDay)

        XCTAssertTrue(store.meals(on: localDay, calendar: calendar).isEmpty)
        XCTAssertEqual(store.totals(on: localDay, calendar: calendar), .zero)
    }

    func testMealLogStoreRefreshMatchesServerDayExactly() throws {
        let suiteName = "MealLogStoreTests.replaceRemoteExactServerDay"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let store = MealLogStore(defaults: defaults)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "Asia/Jerusalem"))
        let localDay = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 6, day: 25)))
        let nextLocalDay = try XCTUnwrap(calendar.date(byAdding: .day, value: 1, to: localDay))
        let staleChicken = MealLogEntry(
            id: UUID(uuidString: "aaaaaaaa-1111-2222-3333-444444444444")!,
            loggedAt: try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 6, day: 25, hour: 20))),
            title: "150 grams cooked chicken breast",
            note: "",
            totals: MacroTotals(calories: 248, proteinGrams: 46, carbsGrams: 0, fatGrams: 5.4, fiberGrams: 0),
            createdAt: localDay
        )
        let serverMeals = [
            MealLogEntry(
                id: UUID(uuidString: "bbbbbbbb-1111-2222-3333-444444444444")!,
                loggedAt: try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 6, day: 25, hour: 21))),
                title: "דנונה PRO וירקות",
                note: "",
                totals: MacroTotals(calories: 450, proteinGrams: 40, carbsGrams: 20, fatGrams: 20, fiberGrams: 4),
                createdAt: localDay
            ),
            MealLogEntry(
                id: UUID(uuidString: "cccccccc-1111-2222-3333-444444444444")!,
                loggedAt: try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 6, day: 25, hour: 18))),
                title: "2 cups of beer and a handful",
                note: "",
                totals: MacroTotals(calories: 375, proteinGrams: 2, carbsGrams: 35, fatGrams: 16.5, fiberGrams: 2),
                createdAt: localDay
            ),
            MealLogEntry(
                id: UUID(uuidString: "dddddddd-1111-2222-3333-444444444444")!,
                loggedAt: try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 6, day: 25, hour: 12))),
                title: "בוקר צהריים וביניים",
                note: "",
                totals: MacroTotals(calories: 900, proteinGrams: 90, carbsGrams: 60, fatGrams: 35, fiberGrams: 5),
                createdAt: localDay
            ),
        ]

        store.add(staleChicken)
        store.replaceRemote(serverMeals, from: localDay, to: nextLocalDay)

        let refreshedMeals = store.meals(on: localDay, calendar: calendar)
        XCTAssertEqual(Set(refreshedMeals.map(\.title)), Set(serverMeals.map(\.title)))
        XCTAssertFalse(refreshedMeals.map(\.title).contains("150 grams cooked chicken breast"))
        XCTAssertEqual(store.totals(on: localDay, calendar: calendar), MacroTotals(
            calories: 1725,
            proteinGrams: 132,
            carbsGrams: 115,
            fatGrams: 71.5,
            fiberGrams: 11
        ))
        XCTAssertTrue(store.meals(on: nextLocalDay, calendar: calendar).isEmpty)
    }

    func testMealReminderSchedulesCoachSummaryBeforeSleep() {
        let profile = CoachProfile(
            goal: .loseWeight,
            weightKg: 87.5,
            estimatedStepsPerDay: 10_000,
            wakeTimeMinutes: 450,
            sleepTimeMinutes: 30,
            breakfastTimeMinutes: 540,
            lunchTimeMinutes: 780,
            snackTimeMinutes: 990,
            dinnerTimeMinutes: 1_200,
            mealRemindersEnabled: true,
            completedAt: Date(timeIntervalSince1970: 1_781_950_400)
        )

        XCTAssertEqual(MealReminderScheduler.coachSummaryTimeMinutes(for: profile), 1_425)
    }

    func testCoachProfileDraftKeepsMealRemindersQuietByDefault() {
        let profile = CoachProfile.draft(
            existingProfile: nil,
            healthDefaults: CoachHealthDefaults(),
            now: Date(timeIntervalSince1970: 1_781_950_400)
        )

        XCTAssertFalse(profile.mealRemindersEnabled)
        XCTAssertTrue(profile.effectiveMealSlots.allSatisfy { !$0.remindersEnabled })
    }

    func testCoachProfileCanDisableLocalReminders() {
        let profile = CoachProfile(
            goal: .loseWeight,
            weightKg: 87.5,
            estimatedStepsPerDay: 10_000,
            wakeTimeMinutes: 450,
            sleepTimeMinutes: 30,
            breakfastTimeMinutes: 540,
            lunchTimeMinutes: 780,
            snackTimeMinutes: 990,
            dinnerTimeMinutes: 1_200,
            mealRemindersEnabled: true,
            completedAt: Date(timeIntervalSince1970: 1_781_950_400)
        )
        let quiet = profile.disablingLocalReminders(
            now: Date(timeIntervalSince1970: 1_784_891_200)
        )

        XCTAssertFalse(quiet.mealRemindersEnabled)
        XCTAssertTrue(quiet.effectiveMealSlots.allSatisfy { !$0.remindersEnabled })
        XCTAssertEqual(quiet.completedAt, Date(timeIntervalSince1970: 1_784_891_200))
    }

    func testAnchoredSyncUsesPagedCheckpoints() {
        XCTAssertEqual(HealthKitStore.anchoredQueryPageLimit, 25_000)
        XCTAssertEqual(HealthKitStore.observerBackgroundPageBudget, 1)
        XCTAssertEqual(HealthKitStore.scheduledBackgroundPageBudget, 3)
        XCTAssertEqual(
            HealthKitStore.pageUploadDefaultsKey(
                for: "FitnessCoach.HealthKit.DailyAggregateAnchor.v1.heart_rate"
            ),
            "FitnessCoach.HealthKit.DailyAggregateAnchor.v1.heart_rate.PendingPageUploadId"
        )
        XCTAssertEqual(
            HealthKitStore.pageIdempotencyKey(
                metricName: "heart_rate",
                pageUploadId: "upload-page-id"
            ),
            "healthkit-daily-heart_rate-page-upload-page-id"
        )
    }

    func testEntitlementsEnableHealthKitBackgroundDelivery() throws {
        let entitlementsURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("FitnessCoach/FitnessCoach.entitlements")
        let data = try Data(contentsOf: entitlementsURL)
        let plist = try XCTUnwrap(
            PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        )

        XCTAssertEqual(plist["com.apple.developer.healthkit"] as? Bool, true)
        XCTAssertEqual(plist["com.apple.developer.healthkit.background-delivery"] as? Bool, true)
    }

    @MainActor
    func testBodyMassAnchoredQueryDescriptorUsesKilograms() throws {
        let descriptor = try XCTUnwrap(
            HealthKitStore.firstSliceReadDescriptors.first { $0.metricName == "weight" }
        )

        XCTAssertEqual(descriptor.quantityIdentifier, .bodyMass)
        XCTAssertEqual(descriptor.unit, HKUnit.gramUnit(with: .kilo))
        XCTAssertEqual(descriptor.normalizedUnit, "kg")
    }

    @MainActor
    func testQuantitySamplesAggregateToDailyTotals() throws {
        let stepsDescriptor = try XCTUnwrap(
            HealthKitStore.firstSliceReadDescriptors.first { $0.metricName == "steps" }
        )
        let stepsType = try XCTUnwrap(HKQuantityType.quantityType(forIdentifier: .stepCount))
        let timezone = TimeZone(identifier: "Asia/Jerusalem")!
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let firstSample = HKQuantitySample(
            type: stepsType,
            quantity: HKQuantity(unit: .count(), doubleValue: 1_234),
            start: start,
            end: start.addingTimeInterval(3_600)
        )
        let secondSample = HKQuantitySample(
            type: stepsType,
            quantity: HKQuantity(unit: .count(), doubleValue: 66),
            start: start.addingTimeInterval(7_200),
            end: start.addingTimeInterval(7_800)
        )

        let uploadSamples = HealthKitStore.dailyUploadSamples(
            from: [firstSample, secondSample],
            descriptor: stepsDescriptor,
            timezone: timezone
        )

        XCTAssertEqual(uploadSamples.count, 1)
        XCTAssertEqual(uploadSamples[0].metricName, "steps")
        XCTAssertEqual(uploadSamples[0].unit, "count")
        XCTAssertEqual(uploadSamples[0].value, 1_300)
        XCTAssertEqual(uploadSamples[0].timezone, "Asia/Jerusalem")
        XCTAssertEqual(uploadSamples[0].source, HealthKitStore.appleHealthDailySource)
        XCTAssertEqual(
            uploadSamples[0].sourceSampleId,
            "apple-health-daily:steps:2027-01-15:Asia_Jerusalem"
        )
    }

    @MainActor
    func testDailyHealthKitStatisticsOptionsMatchMetricSemantics() throws {
        let descriptors = Dictionary(
            uniqueKeysWithValues: HealthKitStore.firstSliceReadDescriptors.map {
                ($0.metricName, $0)
            }
        )

        XCTAssertEqual(
            HealthKitStore.dailyStatisticsOptions(for: try XCTUnwrap(descriptors["steps"])),
            .cumulativeSum
        )
        XCTAssertEqual(
            HealthKitStore.dailyStatisticsOptions(for: try XCTUnwrap(descriptors["active_energy"])),
            .cumulativeSum
        )
        XCTAssertEqual(
            HealthKitStore.dailyStatisticsOptions(for: try XCTUnwrap(descriptors["resting_energy"])),
            .cumulativeSum
        )
        XCTAssertEqual(
            HealthKitStore.dailyStatisticsOptions(for: try XCTUnwrap(descriptors["dietary_energy"])),
            .cumulativeSum
        )
        XCTAssertEqual(
            HealthKitStore.dailyStatisticsOptions(for: try XCTUnwrap(descriptors["protein"])),
            .cumulativeSum
        )
        XCTAssertEqual(
            HealthKitStore.dailyStatisticsOptions(for: try XCTUnwrap(descriptors["carbs"])),
            .cumulativeSum
        )
        XCTAssertEqual(
            HealthKitStore.dailyStatisticsOptions(for: try XCTUnwrap(descriptors["fat"])),
            .cumulativeSum
        )
        XCTAssertEqual(
            HealthKitStore.dailyStatisticsOptions(for: try XCTUnwrap(descriptors["fiber"])),
            .cumulativeSum
        )
        XCTAssertEqual(
            HealthKitStore.dailyStatisticsOptions(for: try XCTUnwrap(descriptors["heart_rate"])),
            .discreteAverage
        )
        XCTAssertEqual(
            HealthKitStore.dailyStatisticsOptions(for: try XCTUnwrap(descriptors["resting_heart_rate"])),
            .discreteAverage
        )
        XCTAssertEqual(
            HealthKitStore.dailyStatisticsOptions(for: try XCTUnwrap(descriptors["walking_heart_rate"])),
            .discreteAverage
        )
        XCTAssertNil(
            HealthKitStore.dailyStatisticsOptions(for: try XCTUnwrap(descriptors["weight"]))
        )
        XCTAssertNil(
            HealthKitStore.dailyStatisticsOptions(for: try XCTUnwrap(descriptors["sleep"]))
        )
    }

    @MainActor
    func testSleepSamplesAggregateOnlyAsleepTimeToDailyWakeDateMinutes() throws {
        let sleepDescriptor = try XCTUnwrap(
            HealthKitStore.firstSliceReadDescriptors.first { $0.metricName == "sleep" }
        )
        let sleepType = try XCTUnwrap(HKCategoryType.categoryType(forIdentifier: .sleepAnalysis))
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let asleep = HKCategorySample(
            type: sleepType,
            value: HKCategoryValueSleepAnalysis.asleepCore.rawValue,
            start: start,
            end: start.addingTimeInterval(90 * 60)
        )
        let awake = HKCategorySample(
            type: sleepType,
            value: HKCategoryValueSleepAnalysis.awake.rawValue,
            start: start.addingTimeInterval(90 * 60),
            end: start.addingTimeInterval(120 * 60)
        )

        let uploadSamples = HealthKitStore.dailyUploadSamples(
            from: [asleep, awake],
            descriptor: sleepDescriptor,
            timezone: TimeZone(identifier: "Asia/Jerusalem")!
        )

        XCTAssertEqual(uploadSamples.count, 1)
        XCTAssertEqual(uploadSamples[0].metricName, "sleep")
        XCTAssertEqual(uploadSamples[0].unit, "minute")
        XCTAssertEqual(uploadSamples[0].value, 90)
        XCTAssertEqual(uploadSamples[0].source, HealthKitStore.appleHealthDailySource)
    }

    @MainActor
    func testWeightSamplesAggregateByDailyModeWithLatestTieBreak() throws {
        let weightDescriptor = try XCTUnwrap(
            HealthKitStore.firstSliceReadDescriptors.first { $0.metricName == "weight" }
        )
        let bodyMassType = try XCTUnwrap(HKQuantityType.quantityType(forIdentifier: .bodyMass))
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let samples = [
            HKQuantitySample(
                type: bodyMassType,
                quantity: HKQuantity(unit: HKUnit.gramUnit(with: .kilo), doubleValue: 87.6),
                start: start,
                end: start
            ),
            HKQuantitySample(
                type: bodyMassType,
                quantity: HKQuantity(unit: HKUnit.gramUnit(with: .kilo), doubleValue: 87.4),
                start: start.addingTimeInterval(60),
                end: start.addingTimeInterval(60)
            ),
            HKQuantitySample(
                type: bodyMassType,
                quantity: HKQuantity(unit: HKUnit.gramUnit(with: .kilo), doubleValue: 87.4),
                start: start.addingTimeInterval(120),
                end: start.addingTimeInterval(120)
            ),
        ]

        let uploadSamples = HealthKitStore.dailyUploadSamples(
            from: samples,
            descriptor: weightDescriptor,
            timezone: TimeZone(identifier: "Asia/Jerusalem")!
        )

        XCTAssertEqual(uploadSamples.count, 1)
        XCTAssertEqual(uploadSamples[0].metricName, "weight")
        XCTAssertEqual(uploadSamples[0].unit, "kg")
        XCTAssertEqual(uploadSamples[0].value, 87.4)
        XCTAssertEqual(uploadSamples[0].source, HealthKitStore.appleHealthDailySource)
    }

    @MainActor
    func testHeartRateSamplesAggregateToDailyAverage() throws {
        let heartRateDescriptor = try XCTUnwrap(
            HealthKitStore.firstSliceReadDescriptors.first { $0.metricName == "heart_rate" }
        )
        let heartRateType = try XCTUnwrap(HKQuantityType.quantityType(forIdentifier: .heartRate))
        let heartRateUnit = HKUnit.count().unitDivided(by: .minute())
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let samples = [
            HKQuantitySample(
                type: heartRateType,
                quantity: HKQuantity(unit: heartRateUnit, doubleValue: 60),
                start: start,
                end: start
            ),
            HKQuantitySample(
                type: heartRateType,
                quantity: HKQuantity(unit: heartRateUnit, doubleValue: 70),
                start: start.addingTimeInterval(60),
                end: start.addingTimeInterval(60)
            ),
        ]

        let uploadSamples = HealthKitStore.dailyUploadSamples(
            from: samples,
            descriptor: heartRateDescriptor,
            timezone: TimeZone(identifier: "Asia/Jerusalem")!
        )

        XCTAssertEqual(uploadSamples.count, 1)
        XCTAssertEqual(uploadSamples[0].metricName, "heart_rate")
        XCTAssertEqual(uploadSamples[0].unit, "bpm")
        XCTAssertEqual(uploadSamples[0].value, 65)
    }

    @MainActor
    func testInitialAnchoredQueryReadsFullHealthHistory() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)

        XCTAssertNil(HealthKitStore.anchoredQueryPredicate(anchor: nil, now: now))
    }

    @MainActor
    func testInitialQuantityStatisticsMetricsUseFullHistoryStatisticsPlan() throws {
        let descriptors = Dictionary(
            uniqueKeysWithValues: HealthKitStore.firstSliceReadDescriptors.map {
                ($0.metricName, $0)
            }
        )

        XCTAssertTrue(
            HealthKitStore.shouldUseFullHistoryStatisticsPlan(
                for: try XCTUnwrap(descriptors["steps"]),
                startingAnchor: nil
            )
        )
        XCTAssertTrue(
            HealthKitStore.shouldUseFullHistoryStatisticsPlan(
                for: try XCTUnwrap(descriptors["active_energy"]),
                startingAnchor: nil
            )
        )
        XCTAssertTrue(
            HealthKitStore.shouldUseFullHistoryStatisticsPlan(
                for: try XCTUnwrap(descriptors["heart_rate"]),
                startingAnchor: nil
            )
        )
        XCTAssertFalse(
            HealthKitStore.shouldUseFullHistoryStatisticsPlan(
                for: try XCTUnwrap(descriptors["weight"]),
                startingAnchor: nil
            )
        )
        XCTAssertFalse(
            HealthKitStore.shouldUseFullHistoryStatisticsPlan(
                for: try XCTUnwrap(descriptors["sleep"]),
                startingAnchor: nil
            )
        )
        XCTAssertFalse(
            HealthKitStore.shouldUseFullHistoryStatisticsPlan(
                for: try XCTUnwrap(descriptors["steps"]),
                startingAnchor: HKQueryAnchor(fromValue: 1)
            )
        )
    }

    func testFullHistoryStatisticsStartDateCoversAppleWatchEra() {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)

        XCTAssertEqual(
            formatter.string(from: HealthKitStore.fullHistoryStatisticsStartDate),
            "2010-01-01"
        )
    }

    func testDailyAggregateAnchorNamespaceForcesFreshInitialSync() {
        XCTAssertEqual(
            HealthKitStore.dailyAggregateAnchorNamespace,
            "FitnessCoach.HealthKit.DailyAggregateAnchor.v2"
        )
    }

    func testUploadingProgressDisplayIncludesPercentSamplesAndEta() {
        let progress = HealthKitSyncProgress.uploading(
            HealthMetricUploadProgress(
                uploadedSamples: 50,
                totalSamples: 100,
                completedChunks: 2,
                totalChunks: 4,
                startedAt: Date(timeIntervalSince1970: 1_800_000_000),
                updatedAt: Date(timeIntervalSince1970: 1_800_000_040)
            )
        )

        XCTAssertEqual(progress.title, "Uploading HealthKit data")
        XCTAssertEqual(progress.detailText, "50% • 50 / 100 samples")
        XCTAssertEqual(progress.etaText, "ETA: less than 1 min")
        XCTAssertEqual(
            progress.accessibilityText,
            "Uploading HealthKit data, 50 percent, 50 of 100 samples, less than 1 minute left"
        )
    }

    func testPlanningProgressShowsDailySampleTotalsBeforeUpload() {
        let progress = HealthKitSyncProgress.planning(
            HealthKitSyncPlanProgress(
                metricName: "heart_rate",
                plannedItems: 1_250,
                readDeleted: 3
            )
        )

        XCTAssertEqual(progress.title, "Syncing Apple Health")
        XCTAssertEqual(progress.detailText, "Planning heart rate")
        XCTAssertEqual(
            progress.secondaryText,
            "1,250 daily rows ready"
        )
        XCTAssertNil(progress.etaText)
        XCTAssertNil(progress.fractionCompleted)
        XCTAssertEqual(
            progress.accessibilityText,
            "Syncing Apple Health, planning upload, 1,250 daily rows ready"
        )
    }

    func testOverallUploadingProgressShowsWholeSyncPercentAndEta() {
        let startedAt = Date(timeIntervalSince1970: 1_800_000_000)
        let updatedAt = Date(timeIntervalSince1970: 1_800_000_040)
        let progress = HealthKitSyncProgress.uploadingOverall(
            HealthKitSyncProgressContext(
                readSamples: 150_000,
                readDeleted: 31,
                uploadedItems: 75_000,
                totalItems: 150_000,
                startedAt: startedAt,
                updatedAt: updatedAt
            ),
            HealthMetricUploadProgress(
                uploadedSamples: 12_500,
                totalSamples: 25_000,
                completedChunks: 13,
                totalChunks: 25,
                startedAt: startedAt,
                updatedAt: updatedAt
            )
        )

        XCTAssertEqual(progress.title, "Syncing Apple Health")
        XCTAssertEqual(progress.detailText, "50% • 75,000 / 150,000 daily rows")
        XCTAssertEqual(
            progress.secondaryText,
            "150,000 daily rows planned"
        )
        XCTAssertEqual(progress.etaText, "ETA: less than 1 min")
        XCTAssertEqual(progress.fractionCompleted, 0.5)
        XCTAssertEqual(
            progress.accessibilityText,
            "Syncing Apple Health, 50 percent, 75,000 of 150,000 daily rows synced"
        )
    }

    func testUploadAuthorizationBlockerFailsSyncInsteadOfCompleting() {
        XCTAssertEqual(
            HealthKitStore.finalSyncResult(
                metrics: [
                    HealthKitMetricSyncSummary(
                        metricName: "steps",
                        samples: 2,
                        deleted: 1
                    ),
                ],
                uploadedCount: 0,
                skippedResult: .skippedMissingAuthToken
            ),
            .failed("Sign in with Google in Account settings to sync Apple Health.")
        )
    }

    func testHealthSyncNotificationContentSummarizesCompletedSync() {
        let content = HealthSyncNotificationContent.finished(
            for: .completed(
                metrics: [
                    HealthKitMetricSyncSummary(
                        metricName: "steps",
                        samples: 24,
                        deleted: 1
                    ),
                    HealthKitMetricSyncSummary(
                        metricName: "sleep",
                        samples: 3,
                        deleted: 0
                    ),
                ],
                upload: .uploaded(count: 27)
            )
        )

        XCTAssertEqual(content.title, "Health sync complete")
        XCTAssertEqual(content.body, "27 daily rows synced.")
    }

    func testHealthSyncNotificationContentSummarizesFailures() {
        let content = HealthSyncNotificationContent.finished(
            for: .failed("Backend rejected the upload.")
        )

        XCTAssertEqual(content.title, "Health sync failed")
        XCTAssertEqual(content.body, "Backend rejected the upload.")
    }

    func testHealthSyncNotificationContentSummarizesAlreadyRunning() {
        let content = HealthSyncNotificationContent.finished(for: .alreadyRunning)

        XCTAssertEqual(content.title, "Health sync already running")
        XCTAssertEqual(content.body, "Fitness Coach is using the current Apple Health sync.")
        XCTAssertFalse(HealthKitSyncResult.alreadyRunning.requiresGoogleSignIn)
    }

    func testHealthSyncNotificationsAreSuppressedWhileAppIsActive() {
        XCTAssertFalse(
            HealthSyncNotifier.shouldScheduleNotification(
                event: .started,
                applicationState: .background
            )
        )
        XCTAssertFalse(
            HealthSyncNotifier.shouldScheduleNotification(
                event: .finished,
                applicationState: .active
            )
        )
        XCTAssertFalse(
            HealthSyncNotifier.shouldScheduleNotification(
                event: .finished,
                applicationState: .inactive
            )
        )
        XCTAssertFalse(
            HealthSyncNotifier.shouldScheduleNotification(
                event: .finished,
                applicationState: .background
            )
        )
        XCTAssertTrue(
            HealthSyncNotifier.shouldScheduleNotification(
                event: .finished,
                applicationState: .background,
                completionNotificationsEnabled: true
            )
        )
    }

    func testHealthSyncNotificationPreferencesAvoidRoutineNoise() {
        XCTAssertFalse(
            HealthSyncNotifier.shouldScheduleNotification(
                event: .finished,
                applicationState: .background,
                completionNotificationsEnabled: false
            )
        )
        XCTAssertTrue(
            HealthSyncNotifier.shouldScheduleNotification(
                event: .staleReminder,
                applicationState: .active,
                staleReminderEnabled: true
            )
        )
        XCTAssertFalse(
            HealthSyncNotifier.shouldScheduleNotification(
                event: .staleReminder,
                applicationState: .background,
                staleReminderEnabled: false
            )
        )
        XCTAssertFalse(
            HealthSyncNotifier.shouldNotifyFinished(
                .completed(metrics: [], upload: .skippedEmptyBatch),
                syncDuration: HealthSyncNotifier.minimumFinishedNotificationDuration + 1
            )
        )
        XCTAssertFalse(
            HealthSyncNotifier.shouldNotifyFinished(
                .completed(
                    metrics: [HealthKitMetricSyncSummary(metricName: "steps", samples: 1, deleted: 0)],
                    upload: .uploaded(count: 1)
                ),
                syncDuration: HealthSyncNotifier.minimumFinishedNotificationDuration - 1
            )
        )
        XCTAssertFalse(
            HealthSyncNotifier.shouldNotifyFinished(
                .completed(
                    metrics: [HealthKitMetricSyncSummary(metricName: "steps", samples: 0, deleted: 1)],
                    upload: .skippedEmptyBatch
                ),
                syncDuration: HealthSyncNotifier.minimumFinishedNotificationDuration + 1
            )
        )
        XCTAssertFalse(
            HealthSyncNotifier.shouldNotifyFinished(
                .failed("Backend unavailable."),
                syncDuration: HealthSyncNotifier.minimumFinishedNotificationDuration + 1
            )
        )
        XCTAssertFalse(
            HealthSyncNotifier.shouldNotifyFinished(
                .alreadyRunning,
                syncDuration: HealthSyncNotifier.minimumFinishedNotificationDuration + 1
            )
        )
        XCTAssertTrue(
            HealthSyncNotifier.shouldNotifyFinished(
                .completed(
                    metrics: [HealthKitMetricSyncSummary(metricName: "steps", samples: 12, deleted: 0)],
                    upload: .uploaded(count: 12)
                ),
                syncDuration: HealthSyncNotifier.minimumFinishedNotificationDuration + 1
            )
        )
    }

    func testHomeMetricSummaryPrefersTodayStepsAndShowsSevenDayAverage() throws {
        let calendar = Self.gregorianCalendar()
        let now = try Self.date(year: 2026, month: 6, day: 17, calendar: calendar)
            .addingTimeInterval(12 * 60 * 60)
        let start = try Self.date(year: 2026, month: 6, day: 11, calendar: calendar)
        let points = (0..<7).map { offset in
            Self.chartPoint(
                calendar.date(byAdding: .day, value: offset, to: start)!,
                value: Double((offset + 1) * 1_000),
                unit: "count"
            )
        }
        let summary = HomeMetricAnalysis.summary(
            for: Self.metricDescriptor(
                metricName: "steps",
                normalizedUnit: "count",
                quantityIdentifier: .stepCount,
                unit: .count()
            ),
            points: points,
            now: now,
            calendar: calendar
        )

        XCTAssertEqual(summary.title, "Steps")
        XCTAssertEqual(summary.valueText, "7,000")
        XCTAssertEqual(summary.caption, "Today")
        XCTAssertEqual(summary.detailText, "1W avg 4,000")
    }

    func testHomeMetricSummaryShowsLatestWeightAndSevenDayDelta() throws {
        let calendar = Self.gregorianCalendar()
        let now = try Self.date(year: 2026, month: 6, day: 17, calendar: calendar)
        let points = [
            Self.chartPoint(
                calendar.date(byAdding: .day, value: -7, to: now)!,
                value: 88.5,
                unit: "kg"
            ),
            Self.chartPoint(now, value: 87, unit: "kg"),
        ]
        let summary = HomeMetricAnalysis.summary(
            for: Self.metricDescriptor(
                metricName: "weight",
                normalizedUnit: "kg",
                quantityIdentifier: .bodyMass,
                unit: .gramUnit(with: .kilo)
            ),
            points: points,
            now: now,
            calendar: calendar
        )

        XCTAssertEqual(summary.title, "Weight")
        XCTAssertEqual(summary.valueText, "87 kg")
        XCTAssertEqual(summary.detailText, "-1.5 kg vs 1W")
    }

    func testMetricChartRollingOneWeekAverageUsesTrailingWindow() throws {
        let calendar = Self.gregorianCalendar()
        let start = try Self.date(year: 2026, month: 6, day: 1, calendar: calendar)

        var points: [HealthMetricChartPoint] = []

        for offset in 0..<10 {
            let date = calendar.date(byAdding: .day, value: offset, to: start)!
            points.append(Self.chartPoint(date, value: Double(offset + 1)))
        }

        let rolling = MetricChartAnalysis.displayPoints(
            from: points,
            mode: .rollingSevenDay,
            calendar: calendar
        )

        XCTAssertEqual(rolling.count, 10)
        XCTAssertEqual(rolling[0].value, 1, accuracy: 0.001)
        XCTAssertEqual(rolling[6].value, 4, accuracy: 0.001)
        XCTAssertEqual(rolling[9].value, 7, accuracy: 0.001)
    }

    func testMetricChartRollingAverageModesUseSelectedWindows() throws {
        let calendar = Self.gregorianCalendar()
        let start = try Self.date(year: 2026, month: 1, day: 1, calendar: calendar)
        let points = (0..<120).map { offset in
            Self.chartPoint(
                calendar.date(byAdding: .day, value: offset, to: start)!,
                value: Double(offset + 1),
                unit: "count"
            )
        }

        let threeDay = MetricChartAnalysis.displayPoints(
            from: points,
            mode: .rollingThreeDay,
            calendar: calendar
        )
        let twoWeek = MetricChartAnalysis.displayPoints(
            from: points,
            mode: .rollingTwoWeek,
            calendar: calendar
        )
        let oneMonth = MetricChartAnalysis.displayPoints(
            from: points,
            mode: .rollingThirtyDay,
            calendar: calendar
        )
        let ninetyDay = MetricChartAnalysis.displayPoints(
            from: points,
            mode: .rollingNinetyDay,
            calendar: calendar
        )
        let sixMonth = MetricChartAnalysis.displayPoints(
            from: points,
            mode: .rollingSixMonth,
            calendar: calendar
        )
        let oneYear = MetricChartAnalysis.displayPoints(
            from: points,
            mode: .rollingOneYear,
            calendar: calendar
        )

        XCTAssertEqual(try XCTUnwrap(threeDay.last).value, 119, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(twoWeek.last).value, 113.5, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(oneMonth.last).value, 105.5, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(ninetyDay.last).value, 75.5, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(sixMonth.last).value, 60.5, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(oneYear.last).value, 60.5, accuracy: 0.001)
    }

    func testMetricChartTrailingRangeUsesLatestPointWindow() throws {
        let calendar = Self.gregorianCalendar()
        let start = try Self.date(year: 2026, month: 1, day: 1, calendar: calendar)
        let points = [
            Self.chartPoint(start, value: 90),
            Self.chartPoint(
                start.addingTimeInterval(TimeInterval(50 * 24 * 60 * 60)),
                value: 88
            ),
            Self.chartPoint(
                start.addingTimeInterval(TimeInterval(100 * 24 * 60 * 60)),
                value: 87
            ),
        ]

        let range = MetricChartAnalysis.trailingRange(
            in: points,
            days: 30,
            calendar: calendar
        )

        XCTAssertEqual(range.upperBound, points[2].date)
        XCTAssertEqual(
            calendar.dateComponents([.day], from: range.lowerBound, to: range.upperBound).day,
            30
        )
    }

    func testMetricChartProgressItemsShowHighAndRecentDeltas() throws {
        let calendar = Self.gregorianCalendar()
        let latestDate = try Self.date(year: 2026, month: 6, day: 16, calendar: calendar)
        let points = [
            Self.chartPoint(
                calendar.date(byAdding: .day, value: -30, to: latestDate)!,
                value: 90
            ),
            Self.chartPoint(
                calendar.date(byAdding: .day, value: -7, to: latestDate)!,
                value: 88
            ),
            Self.chartPoint(latestDate, value: 87.5),
        ]
        let descriptor = HealthKitMetricDescriptor(
            metricName: "weight",
            normalizedUnit: "kg",
            quantityIdentifier: .bodyMass,
            categoryIdentifier: nil,
            unit: .gramUnit(with: .kilo)
        )

        let items = MetricChartAnalysis.progressItems(
            visiblePoints: points,
            descriptor: descriptor,
            displayMode: .rollingSevenDay,
            calendar: calendar
        )

        XCTAssertEqual(items.map(\.title), ["Since High", "1W", "1M"])
        XCTAssertEqual(items.map(\.value), ["-2.5 kg", "-0.5 kg", "-2.5 kg"])
        XCTAssertTrue(items.allSatisfy { $0.caption.hasPrefix("1W Avg •") })
    }

    func testMetricChartProgressItemsStayVisibleWithoutVisibleData() {
        let calendar = Self.gregorianCalendar()
        let descriptor = HealthKitMetricDescriptor(
            metricName: "weight",
            normalizedUnit: "kg",
            quantityIdentifier: .bodyMass,
            categoryIdentifier: nil,
            unit: .gramUnit(with: .kilo)
        )

        let items = MetricChartAnalysis.progressItems(
            visiblePoints: [],
            descriptor: descriptor,
            displayMode: .rollingThirtyDay,
            calendar: calendar
        )

        XCTAssertEqual(items.map(\.title), ["Since High", "1W", "1M"])
        XCTAssertEqual(items.map(\.value), ["N/A", "N/A", "N/A"])
        XCTAssertTrue(items.allSatisfy { $0.caption == "1M Avg • No data in range" })
    }

    func testMetricChartFormatsSleepMinutesAsDurations() {
        XCTAssertEqual(MetricChartAnalysis.valueText(445, unit: "minute"), "7h 25m")
        XCTAssertEqual(MetricChartAnalysis.valueText(60, unit: "minute"), "1h")
        XCTAssertEqual(MetricChartAnalysis.valueText(27, unit: "minute"), "27m")
        XCTAssertEqual(
            MetricChartAnalysis.rangeValueText(min: 418, max: 445, unit: "minute"),
            "6h 58m - 7h 25m"
        )
    }

    func testShortRollingChartSeriesDefaultToOneMonthWindow() {
        XCTAssertEqual(MetricChartDisplayMode.rollingThreeDay.defaultWindowPreset, .thirtyDays)
        XCTAssertEqual(MetricChartDisplayMode.rollingSevenDay.defaultWindowPreset, .thirtyDays)
        XCTAssertNil(MetricChartDisplayMode.daily.defaultWindowPreset)
        XCTAssertNil(MetricChartDisplayMode.rollingThirtyDay.defaultWindowPreset)
    }

    func testMetricChartSleepProgressUsesCompactMinuteDeltas() throws {
        let calendar = Self.gregorianCalendar()
        let latestDate = try Self.date(year: 2026, month: 6, day: 16, calendar: calendar)
        let points = [
            Self.chartPoint(
                calendar.date(byAdding: .day, value: -30, to: latestDate)!,
                value: 500,
                unit: "minute"
            ),
            Self.chartPoint(
                calendar.date(byAdding: .day, value: -7, to: latestDate)!,
                value: 472,
                unit: "minute"
            ),
            Self.chartPoint(latestDate, value: 445, unit: "minute"),
        ]
        let descriptor = HealthKitMetricDescriptor(
            metricName: "sleep",
            normalizedUnit: "minute",
            quantityIdentifier: nil,
            categoryIdentifier: .sleepAnalysis,
            unit: .minute()
        )

        let items = MetricChartAnalysis.progressItems(
            visiblePoints: points,
            descriptor: descriptor,
            displayMode: .daily,
            calendar: calendar
        )

        XCTAssertEqual(items.map(\.value), ["-55m", "-27m", "-55m"])
    }

    func testMetricChartLineIncludesBoundaryPointsOutsideVisibleRange() throws {
        let calendar = Self.gregorianCalendar()
        let start = try Self.date(year: 2026, month: 5, day: 1, calendar: calendar)
        let points = [
            Self.chartPoint(start, value: 90),
            Self.chartPoint(
                calendar.date(byAdding: .day, value: 10, to: start)!,
                value: 89
            ),
            Self.chartPoint(
                calendar.date(byAdding: .day, value: 20, to: start)!,
                value: 88
            ),
            Self.chartPoint(
                calendar.date(byAdding: .day, value: 40, to: start)!,
                value: 87
            ),
        ]
        let visibleStart = calendar.date(byAdding: .day, value: 15, to: start)!
        let visibleEnd = calendar.date(byAdding: .day, value: 30, to: start)!
        let visibleRange = visibleStart...visibleEnd

        let linePoints = MetricChartAnalysis.linePoints(
            in: visibleRange,
            from: points
        )

        XCTAssertEqual(
            linePoints.map(\.date),
            [
                visibleStart,
                points[2].date,
                visibleEnd,
            ]
        )
        XCTAssertEqual(linePoints[0].value, 88.5, accuracy: 0.001)
        XCTAssertEqual(linePoints[2].value, 87.5, accuracy: 0.001)
    }

    func testMetricChartRollingAveragePointMarksAndFocusUseWeeklySamples() throws {
        let calendar = Self.gregorianCalendar()
        let start = try Self.date(year: 2026, month: 5, day: 1, calendar: calendar)
        let points = (0..<29).map { offset in
            Self.chartPoint(
                calendar.date(byAdding: .day, value: offset, to: start)!,
                value: Double(offset)
            )
        }
        let focusedPoint = points[10]

        let pointMarks = MetricChartAnalysis.pointMarkPoints(
            in: points,
            mode: .rollingSevenDay,
            focusedPoint: focusedPoint,
            calendar: calendar
        )

        XCTAssertEqual(
            pointMarks.map(\.date),
            [
                points[0].date,
                points[7].date,
                points[14].date,
                points[21].date,
                points[28].date,
            ].sorted()
        )

        let focusCandidates = MetricChartAnalysis.focusCandidatePoints(
            in: points,
            mode: .rollingSevenDay,
            calendar: calendar
        )

        XCTAssertFalse(focusCandidates.contains(focusedPoint))
        XCTAssertEqual(focusCandidates.map(\.date), pointMarks.map(\.date))
    }

    func testMetricChartLongRollingAveragePointMarksAndFocusUseMonthlySamples() throws {
        let calendar = Self.gregorianCalendar()
        let start = try Self.date(year: 2026, month: 1, day: 1, calendar: calendar)
        let points = (0..<91).map { offset in
            Self.chartPoint(
                calendar.date(byAdding: .day, value: offset, to: start)!,
                value: Double(offset)
            )
        }
        let focusedPoint = points[45]

        let pointMarks = MetricChartAnalysis.pointMarkPoints(
            in: points,
            mode: .rollingThirtyDay,
            focusedPoint: focusedPoint,
            calendar: calendar
        )

        XCTAssertEqual(
            pointMarks.map(\.date),
            [
                points[0].date,
                points[30].date,
                points[60].date,
                points[90].date,
            ].sorted()
        )

        let focusCandidates = MetricChartAnalysis.focusCandidatePoints(
            in: points,
            mode: .rollingNinetyDay,
            calendar: calendar
        )

        XCTAssertFalse(focusCandidates.contains(focusedPoint))
        XCTAssertEqual(focusCandidates.map(\.date), pointMarks.map(\.date))
    }

    func testMetricChartAllTimePresetUsesFullDomain() throws {
        let calendar = Self.gregorianCalendar()
        let start = try Self.date(year: 2025, month: 1, day: 1, calendar: calendar)
        let points = [
            Self.chartPoint(start, value: 91),
            Self.chartPoint(
                calendar.date(byAdding: .day, value: 400, to: start)!,
                value: 87
            ),
        ]

        let range = MetricChartAnalysis.presetRange(
            .allTime,
            in: points,
            calendar: calendar
        )

        XCTAssertEqual(range.lowerBound, points[0].date)
        XCTAssertEqual(range.upperBound, points[1].date)
    }

    func testMetricChartSparsePresetFallsBackToAllTime() throws {
        let calendar = Self.gregorianCalendar()
        let start = try Self.date(year: 2025, month: 1, day: 1, calendar: calendar)
        let points = [
            Self.chartPoint(start, value: 91),
            Self.chartPoint(
                calendar.date(byAdding: .day, value: 700, to: start)!,
                value: 87
            ),
        ]
        let requestedRange = MetricChartAnalysis.presetRange(
            .sixMonths,
            in: points,
            calendar: calendar
        )

        XCTAssertEqual(
            MetricChartAnalysis.normalizedPreset(
                .sixMonths,
                requestedRange: requestedRange,
                in: points
            ),
            .allTime
        )
    }

    func testMetricChartVisibleRangeTranslatesWithinDomain() throws {
        let calendar = Self.gregorianCalendar()
        let domainStart = try Self.date(year: 2026, month: 1, day: 1, calendar: calendar)
        let domainEnd = try Self.date(year: 2026, month: 4, day: 1, calendar: calendar)
        let visibleStart = try Self.date(year: 2026, month: 3, day: 2, calendar: calendar)
        let visibleEnd = try Self.date(year: 2026, month: 4, day: 1, calendar: calendar)

        let shifted = MetricChartAnalysis.translatedRange(
            visibleStart...visibleEnd,
            by: TimeInterval(-10 * 24 * 60 * 60),
            domain: domainStart...domainEnd,
            minimumDays: 7
        )

        XCTAssertEqual(
            calendar.dateComponents([.day], from: shifted.lowerBound, to: visibleStart).day,
            10
        )
        XCTAssertEqual(
            calendar.dateComponents([.day], from: shifted.upperBound, to: visibleEnd).day,
            10
        )
    }

    func testMetricChartVisibleRangeTranslationPreservesWindowAtEdges() throws {
        let calendar = Self.gregorianCalendar()
        let domainStart = try Self.date(year: 2026, month: 1, day: 1, calendar: calendar)
        let domainEnd = try Self.date(year: 2026, month: 4, day: 1, calendar: calendar)
        let visibleStart = try Self.date(year: 2026, month: 3, day: 2, calendar: calendar)
        let visibleEnd = try Self.date(year: 2026, month: 4, day: 1, calendar: calendar)

        let shifted = MetricChartAnalysis.translatedRange(
            visibleStart...visibleEnd,
            by: TimeInterval(10 * 24 * 60 * 60),
            domain: domainStart...domainEnd,
            minimumDays: 7
        )

        XCTAssertEqual(shifted.upperBound, domainEnd)
        XCTAssertEqual(
            calendar.dateComponents([.day], from: shifted.lowerBound, to: shifted.upperBound).day,
            30
        )
    }

    func testMetricChartVisibleRangePinchZoomsAroundFocusAndClamps() throws {
        let calendar = Self.gregorianCalendar()
        let domainStart = try Self.date(year: 2026, month: 1, day: 1, calendar: calendar)
        let domainEnd = try Self.date(year: 2026, month: 4, day: 1, calendar: calendar)
        let visibleStart = try Self.date(year: 2026, month: 3, day: 1, calendar: calendar)
        let visibleEnd = try Self.date(year: 2026, month: 3, day: 31, calendar: calendar)
        let focus = try Self.date(year: 2026, month: 3, day: 16, calendar: calendar)

        let zoomedIn = MetricChartAnalysis.zoomedRange(
            visibleStart...visibleEnd,
            magnification: 2,
            center: focus,
            domain: domainStart...domainEnd,
            minimumDays: 7
        )
        let zoomedOut = MetricChartAnalysis.zoomedRange(
            visibleStart...visibleEnd,
            magnification: 0.1,
            center: focus,
            domain: domainStart...domainEnd,
            minimumDays: 7
        )

        XCTAssertEqual(
            calendar.dateComponents([.day], from: zoomedIn.lowerBound, to: zoomedIn.upperBound).day,
            15
        )
        XCTAssertEqual(zoomedOut.lowerBound, domainStart)
        XCTAssertEqual(zoomedOut.upperBound, domainEnd)
    }

    private static func gregorianCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    private static func date(
        year: Int,
        month: Int,
        day: Int,
        calendar: Calendar
    ) throws -> Date {
        try XCTUnwrap(
            calendar.date(
                from: DateComponents(
                    calendar: calendar,
                    timeZone: calendar.timeZone,
                    year: year,
                    month: month,
                    day: day
                )
            )
        )
    }

    private static func chartPoint(
        _ date: Date,
        value: Double,
        unit: String = "kg"
    ) -> HealthMetricChartPoint {
        HealthMetricChartPoint(date: date, value: value, unit: unit)
    }

    private static func metricDescriptor(
        metricName: String,
        normalizedUnit: String,
        quantityIdentifier: HKQuantityTypeIdentifier,
        unit: HKUnit
    ) -> HealthKitMetricDescriptor {
        HealthKitMetricDescriptor(
            metricName: metricName,
            normalizedUnit: normalizedUnit,
            quantityIdentifier: quantityIdentifier,
            categoryIdentifier: nil,
            unit: unit
        )
    }
}

private struct LegacyCoachProfileFixture: Encodable {
    let goal: CoachGoal
    let weightKg: Double
    let estimatedStepsPerDay: Int
    let wakeTimeMinutes: Int
    let sleepTimeMinutes: Int
    let breakfastTimeMinutes: Int
    let lunchTimeMinutes: Int
    let snackTimeMinutes: Int
    let dinnerTimeMinutes: Int
    let mealRemindersEnabled: Bool
    let completedAt: Date
}
