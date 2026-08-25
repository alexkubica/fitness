import XCTest
@testable import FitnessCoach

final class MealPlanClientTests: XCTestCase {
    func testPlannedStatusNeverClaimsActualConsumptionWithoutLink() {
        let meal = plannedMeal(status: "planned", linkedMealLogId: nil)

        XCTAssertEqual(meal.displayStatus, "Planned · Not logged")
        XCTAssertEqual(meal.calories, 180)
    }

    func testLinkedPartialMealIsClearlyChangedAndLogged() {
        let meal = plannedMeal(status: "partially_eaten", linkedMealLogId: "actual-1")

        XCTAssertEqual(meal.displayStatus, "Changed · Logged")
    }

    func testConfirmedMealIsClearlyLogged() {
        let meal = plannedMeal(status: "confirmed", linkedMealLogId: "actual-1")

        XCTAssertEqual(meal.displayStatus, "Confirmed · Logged")
    }

    func testDailyPlanResponseDecodesVersionsAndNutritionSnapshot() throws {
        let data = Data(
            """
            {
              "plan": {
                "id": "plan-1",
                "profileId": "profile-1",
                "localFoodDate": "2026-07-15",
                "timezone": "Asia/Jerusalem",
                "status": "active",
                "meals": [{
                  "id": "meal-1",
                  "mealType": "Breakfast",
                  "plannedTime": "09:00",
                  "title": "Yogurt",
                  "description": "",
                  "instructions": "",
                  "status": "planned",
                  "ingredients": [{
                    "id": "ingredient-1",
                    "displayName": "Yogurt",
                    "quantity": 200,
                    "unit": "g",
                    "grams": 200,
                    "totals": {"calories": 180, "proteinGrams": 20, "carbsGrams": 16, "fatGrams": 4, "fiberGrams": 0}
                  }],
                  "sortOrder": 0,
                  "version": 3
                }],
                "version": 5
              },
              "plannedTotals": {"calories": 180, "proteinGrams": 20, "carbsGrams": 16, "fatGrams": 4, "fiberGrams": 0}
            }
            """.utf8
        )

        let response = try JSONDecoder().decode(DailyMealPlanResponse.self, from: data)

        XCTAssertEqual(response.plan.version, 5)
        XCTAssertEqual(response.plan.meals.first?.version, 3)
        XCTAssertEqual(response.plan.meals.first?.ingredients.first?.totals.proteinGrams, 20)
    }

    func testLocalEatingCheckInPreservesSyncMetadataForRetry() {
        let occurredAt = Date(timeIntervalSince1970: 1_800_123_456)
        let draft = EatingCheckInDraft(
            occurredAt: occurredAt,
            timezone: "Asia/Jerusalem",
            idempotencyKey: "ios-checkin-1",
            linkedMealId: "actual-meal-1",
            linkedPlannedMealId: "planned-meal-1",
            hungerBefore: 7,
            fullnessAfter: 6,
            urgeIntensity: 8,
            emotionIntensity: 5,
            emotions: ["Stressed"],
            triggers: ["Work stress"],
            automaticThought: "I need to eat now",
            balancedResponse: "I can pause and decide",
            eatingContext: .stress,
            lossOfControl: false,
            ateUntilPain: false,
            ateWithScreen: true,
            ateFromPackage: false,
            tookSecondServing: false,
            copingAction: "10-minute pause",
            urgeDelayMinutes: 10,
            outcome: "Urge passed",
            note: "Short note"
        )

        let record = EatingCheckInRecord.local(
            draft: draft,
            id: "ios-checkin-1",
            now: occurredAt
        )

        XCTAssertEqual(record.syncState, .pending)
        XCTAssertEqual(record.summaryText, "Hunger 7/10 · Urge 8/10 · Fullness 6/10 · Stressed · Screen")
        XCTAssertEqual(record.retryDraft(), draft)
    }

    func testWeeklyInsightsCountsBehaviorPatternsWithoutJudgment() {
        let base = Date(timeIntervalSince1970: 1_800_000_000)
        let insights = EatingWeeklyInsights(checkIns: [
            eatingCheckIn(
                id: "checkin-1",
                occurredAt: base,
                hungerBefore: 8,
                fullnessAfter: 7,
                urgeIntensity: 8,
                triggers: ["late evening"],
                ateWithScreen: true,
                copingAction: "planned snack",
                urgeDelayMinutes: 10,
                outcome: "Urge passed"
            ),
            eatingCheckIn(
                id: "checkin-2",
                occurredAt: base.addingTimeInterval(3_600),
                hungerBefore: 6,
                fullnessAfter: 8,
                urgeIntensity: 5,
                triggers: ["late evening"],
                tookSecondServing: true
            ),
            eatingCheckIn(
                id: "checkin-3",
                occurredAt: base.addingTimeInterval(7_200),
                hungerBefore: 9,
                urgeIntensity: 9,
                ateUntilPain: true,
                lossOfControl: true
            ),
        ])

        XCTAssertTrue(insights.hasEnoughData)
        XCTAssertEqual(insights.checkInCount, 3)
        XCTAssertEqual(insights.averageHunger, 7.666666666666667)
        XCTAssertEqual(insights.strongUrges, 2)
        XCTAssertEqual(insights.urgesDelayed, 1)
        XCTAssertEqual(insights.screenEating, 1)
        XCTAssertEqual(insights.secondServings, 1)
        XCTAssertEqual(insights.ateUntilPain, 1)
        XCTAssertEqual(insights.lossOfControl, 1)
        XCTAssertEqual(insights.mostCommonTrigger, "late evening")
        XCTAssertEqual(insights.mostEffectiveCopingAction, "planned snack")
    }

    private func plannedMeal(status: String, linkedMealLogId: String?) -> PlannedMealDTO {
        PlannedMealDTO(
            id: "meal-1",
            mealType: "Breakfast",
            plannedTime: "09:00",
            title: "Yogurt",
            description: "",
            instructions: "",
            status: status,
            linkedMealLogId: linkedMealLogId,
            ingredients: [
                PlannedMealIngredientDTO(
                    id: "ingredient-1",
                    displayName: "Yogurt",
                    quantity: 200,
                    unit: "g",
                    grams: 200,
                    totals: MacroTotals(
                        calories: 180,
                        proteinGrams: 20,
                        carbsGrams: 16,
                        fatGrams: 4,
                        fiberGrams: 0
                    )
                )
            ],
            sortOrder: 0,
            version: 1
        )
    }

    private func eatingCheckIn(
        id: String,
        occurredAt: Date,
        hungerBefore: Int? = nil,
        fullnessAfter: Int? = nil,
        urgeIntensity: Int? = nil,
        triggers: [String] = [],
        ateWithScreen: Bool = false,
        tookSecondServing: Bool = false,
        ateUntilPain: Bool = false,
        lossOfControl: Bool = false,
        copingAction: String? = nil,
        urgeDelayMinutes: Int? = nil,
        outcome: String? = nil
    ) -> EatingCheckInRecord {
        EatingCheckInRecord(
            id: id,
            occurredAt: occurredAt,
            timezone: "Asia/Jerusalem",
            linkedMealId: nil,
            linkedPlannedMealId: nil,
            hungerBefore: hungerBefore,
            fullnessAfter: fullnessAfter,
            urgeIntensity: urgeIntensity,
            emotionIntensity: nil,
            emotions: [],
            triggers: triggers,
            automaticThought: nil,
            balancedResponse: nil,
            eatingContext: nil,
            lossOfControl: lossOfControl,
            ateUntilPain: ateUntilPain,
            ateWithScreen: ateWithScreen,
            ateFromPackage: false,
            tookSecondServing: tookSecondServing,
            copingAction: copingAction,
            urgeDelayMinutes: urgeDelayMinutes,
            outcome: outcome,
            note: nil,
            idempotencyKey: nil,
            syncState: .synced,
            syncError: nil,
            createdAt: occurredAt,
            updatedAt: occurredAt
        )
    }
}
