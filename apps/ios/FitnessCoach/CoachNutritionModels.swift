import Foundation
import SwiftUI
@preconcurrency import UserNotifications

struct CoachHealthDefaults: Equatable {
    var weightKg: Double?
    var averageStepsPerDay: Double?
    var averageActiveCaloriesPerDay: Double?
    var averageRestingCaloriesPerDay: Double?
}

enum CoachGoal: String, CaseIterable, Codable, Identifiable {
    case loseWeight
    case maintain
    case gainMass

    var id: String { rawValue }

    var title: String {
        switch self {
        case .loseWeight:
            return "Lose"
        case .maintain:
            return "Maintain"
        case .gainMass:
            return "Gain"
        }
    }

    var displayName: String {
        switch self {
        case .loseWeight:
            return "Lose weight"
        case .maintain:
            return "Maintain"
        case .gainMass:
            return "Gain mass"
        }
    }

    var targetCaption: String {
        switch self {
        case .loseWeight:
            return "About 0.5 kg per week"
        case .maintain:
            return "Hold weight steady"
        case .gainMass:
            return "Slow lean gain"
        }
    }
}

struct CoachMealSlot: Codable, Equatable, Identifiable {
    let id: UUID
    var name: String
    var timeMinutes: Int
    var remindersEnabled: Bool

    var displayName: String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)

        return trimmed.isEmpty ? "Meal" : trimmed
    }

    static let breakfastId = UUID(uuidString: "10000000-0000-0000-0000-000000000001")!
    static let lunchId = UUID(uuidString: "10000000-0000-0000-0000-000000000002")!
    static let snackId = UUID(uuidString: "10000000-0000-0000-0000-000000000003")!
    static let dinnerId = UUID(uuidString: "10000000-0000-0000-0000-000000000004")!

    static let defaultSlots: [CoachMealSlot] = legacyDefaultSlots(
        breakfastTimeMinutes: 9 * 60,
        lunchTimeMinutes: 13 * 60,
        snackTimeMinutes: 16 * 60 + 30,
        dinnerTimeMinutes: 20 * 60,
        remindersEnabled: false
    )

    static func legacyDefaultSlots(
        breakfastTimeMinutes: Int,
        lunchTimeMinutes: Int,
        snackTimeMinutes: Int,
        dinnerTimeMinutes: Int,
        remindersEnabled: Bool = true
    ) -> [CoachMealSlot] {
        [
            CoachMealSlot(
                id: breakfastId,
                name: "Breakfast",
                timeMinutes: breakfastTimeMinutes,
                remindersEnabled: remindersEnabled
            ),
            CoachMealSlot(
                id: lunchId,
                name: "Lunch",
                timeMinutes: lunchTimeMinutes,
                remindersEnabled: remindersEnabled
            ),
            CoachMealSlot(
                id: snackId,
                name: "Snack",
                timeMinutes: snackTimeMinutes,
                remindersEnabled: remindersEnabled
            ),
            CoachMealSlot(
                id: dinnerId,
                name: "Dinner",
                timeMinutes: dinnerTimeMinutes,
                remindersEnabled: remindersEnabled
            ),
        ]
    }
}

struct CoachProfile: Codable, Equatable {
    var goal: CoachGoal
    var weightKg: Double
    var estimatedStepsPerDay: Int
    var estimatedActiveCaloriesPerDay: Double?
    var estimatedRestingCaloriesPerDay: Double?
    var wakeTimeMinutes: Int
    var sleepTimeMinutes: Int
    var breakfastTimeMinutes: Int
    var lunchTimeMinutes: Int
    var snackTimeMinutes: Int
    var dinnerTimeMinutes: Int
    var mealRemindersEnabled: Bool
    var mealSlots: [CoachMealSlot]
    var completedAt: Date

    var effectiveMealSlots: [CoachMealSlot] {
        let cleanedSlots = mealSlots
            .map { slot in
                CoachMealSlot(
                    id: slot.id,
                    name: slot.displayName,
                    timeMinutes: slot.timeMinutes,
                    remindersEnabled: slot.remindersEnabled
                )
            }
            .filter { !$0.displayName.isEmpty }

        if cleanedSlots.isEmpty {
            return CoachMealSlot.legacyDefaultSlots(
                breakfastTimeMinutes: breakfastTimeMinutes,
                lunchTimeMinutes: lunchTimeMinutes,
                snackTimeMinutes: snackTimeMinutes,
                dinnerTimeMinutes: dinnerTimeMinutes,
                remindersEnabled: mealRemindersEnabled
            )
        }

        return cleanedSlots
    }

    init(
        goal: CoachGoal,
        weightKg: Double,
        estimatedStepsPerDay: Int,
        estimatedActiveCaloriesPerDay: Double? = nil,
        estimatedRestingCaloriesPerDay: Double? = nil,
        wakeTimeMinutes: Int,
        sleepTimeMinutes: Int,
        breakfastTimeMinutes: Int,
        lunchTimeMinutes: Int,
        snackTimeMinutes: Int,
        dinnerTimeMinutes: Int,
        mealRemindersEnabled: Bool,
        mealSlots: [CoachMealSlot]? = nil,
        completedAt: Date
    ) {
        self.goal = goal
        self.weightKg = weightKg
        self.estimatedStepsPerDay = estimatedStepsPerDay
        self.estimatedActiveCaloriesPerDay = estimatedActiveCaloriesPerDay
        self.estimatedRestingCaloriesPerDay = estimatedRestingCaloriesPerDay
        self.wakeTimeMinutes = wakeTimeMinutes
        self.sleepTimeMinutes = sleepTimeMinutes
        self.breakfastTimeMinutes = breakfastTimeMinutes
        self.lunchTimeMinutes = lunchTimeMinutes
        self.snackTimeMinutes = snackTimeMinutes
        self.dinnerTimeMinutes = dinnerTimeMinutes
        self.mealRemindersEnabled = mealRemindersEnabled
        self.mealSlots = mealSlots ?? CoachMealSlot.legacyDefaultSlots(
            breakfastTimeMinutes: breakfastTimeMinutes,
            lunchTimeMinutes: lunchTimeMinutes,
            snackTimeMinutes: snackTimeMinutes,
            dinnerTimeMinutes: dinnerTimeMinutes,
            remindersEnabled: mealRemindersEnabled
        )
        self.completedAt = completedAt
    }

    enum CodingKeys: String, CodingKey {
        case goal
        case weightKg
        case estimatedStepsPerDay
        case estimatedActiveCaloriesPerDay
        case estimatedRestingCaloriesPerDay
        case wakeTimeMinutes
        case sleepTimeMinutes
        case breakfastTimeMinutes
        case lunchTimeMinutes
        case snackTimeMinutes
        case dinnerTimeMinutes
        case mealRemindersEnabled
        case mealSlots
        case completedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        goal = try container.decode(CoachGoal.self, forKey: .goal)
        weightKg = try container.decode(Double.self, forKey: .weightKg)
        estimatedStepsPerDay = try container.decode(Int.self, forKey: .estimatedStepsPerDay)
        estimatedActiveCaloriesPerDay = try container.decodeIfPresent(
            Double.self,
            forKey: .estimatedActiveCaloriesPerDay
        )
        estimatedRestingCaloriesPerDay = try container.decodeIfPresent(
            Double.self,
            forKey: .estimatedRestingCaloriesPerDay
        )
        wakeTimeMinutes = try container.decode(Int.self, forKey: .wakeTimeMinutes)
        sleepTimeMinutes = try container.decode(Int.self, forKey: .sleepTimeMinutes)
        breakfastTimeMinutes = try container.decode(Int.self, forKey: .breakfastTimeMinutes)
        lunchTimeMinutes = try container.decode(Int.self, forKey: .lunchTimeMinutes)
        snackTimeMinutes = try container.decode(Int.self, forKey: .snackTimeMinutes)
        dinnerTimeMinutes = try container.decode(Int.self, forKey: .dinnerTimeMinutes)
        mealRemindersEnabled = try container.decode(Bool.self, forKey: .mealRemindersEnabled)
        completedAt = try container.decode(Date.self, forKey: .completedAt)

        let decodedSlots = try container.decodeIfPresent(
            [CoachMealSlot].self,
            forKey: .mealSlots
        ) ?? []
        mealSlots = decodedSlots.isEmpty ? CoachMealSlot.legacyDefaultSlots(
            breakfastTimeMinutes: breakfastTimeMinutes,
            lunchTimeMinutes: lunchTimeMinutes,
            snackTimeMinutes: snackTimeMinutes,
            dinnerTimeMinutes: dinnerTimeMinutes,
            remindersEnabled: mealRemindersEnabled
        ) : decodedSlots
    }

    static func draft(
        existingProfile: CoachProfile?,
        healthDefaults: CoachHealthDefaults,
        now: Date = Date()
    ) -> CoachProfile {
        existingProfile ?? CoachProfile(
            goal: .loseWeight,
            weightKg: healthDefaults.weightKg ?? 87.5,
            estimatedStepsPerDay: Int(
                ((healthDefaults.averageStepsPerDay ?? 3_000) / 500).rounded()
            ) * 500,
            estimatedActiveCaloriesPerDay: healthDefaults.averageActiveCaloriesPerDay,
            estimatedRestingCaloriesPerDay: healthDefaults.averageRestingCaloriesPerDay,
            wakeTimeMinutes: 7 * 60 + 30,
            sleepTimeMinutes: 23 * 60 + 30,
            breakfastTimeMinutes: 9 * 60,
            lunchTimeMinutes: 13 * 60,
            snackTimeMinutes: 16 * 60 + 30,
            dinnerTimeMinutes: 20 * 60,
            mealRemindersEnabled: false,
            mealSlots: CoachMealSlot.defaultSlots,
            completedAt: now
        )
    }

    func disablingLocalReminders(now: Date = Date()) -> CoachProfile {
        CoachProfile(
            goal: goal,
            weightKg: weightKg,
            estimatedStepsPerDay: estimatedStepsPerDay,
            estimatedActiveCaloriesPerDay: estimatedActiveCaloriesPerDay,
            estimatedRestingCaloriesPerDay: estimatedRestingCaloriesPerDay,
            wakeTimeMinutes: wakeTimeMinutes,
            sleepTimeMinutes: sleepTimeMinutes,
            breakfastTimeMinutes: breakfastTimeMinutes,
            lunchTimeMinutes: lunchTimeMinutes,
            snackTimeMinutes: snackTimeMinutes,
            dinnerTimeMinutes: dinnerTimeMinutes,
            mealRemindersEnabled: false,
            mealSlots: effectiveMealSlots.map { slot in
                CoachMealSlot(
                    id: slot.id,
                    name: slot.displayName,
                    timeMinutes: slot.timeMinutes,
                    remindersEnabled: false
                )
            },
            completedAt: now
        )
    }
}

struct NutritionTargets: Equatable {
    let goal: CoachGoal
    let maintenanceCalories: Int
    let loseCalories: Int
    let maintainCalories: Int
    let gainCalories: Int
    let selectedCalories: Int
    let proteinGrams: Int
    let fatGrams: Int
    let carbGrams: Int
    let fiberGrams: Int

    var selectedGoalCalories: Int {
        switch goal {
        case .loseWeight:
            return loseCalories
        case .maintain:
            return maintainCalories
        case .gainMass:
            return gainCalories
        }
    }
}

enum NutritionTargetCalculator {
    static func targets(for profile: CoachProfile) -> NutritionTargets {
        let maintenance = maintenanceCalories(
            weightKg: profile.weightKg,
            stepsPerDay: profile.estimatedStepsPerDay,
            activeCaloriesPerDay: profile.estimatedActiveCaloriesPerDay,
            restingCaloriesPerDay: profile.estimatedRestingCaloriesPerDay
        )
        let lose = max(1_500, roundToNearest(maintenance - 500, interval: 50))
        let maintain = maintenance
        let gain = roundToNearest(maintenance + 400, interval: 50)
        let selected: Int

        switch profile.goal {
        case .loseWeight:
            selected = lose
        case .maintain:
            selected = maintain
        case .gainMass:
            selected = gain
        }

        let proteinMultiplier: Double = profile.goal == .maintain ? 1.6 : 1.8
        let protein = roundToNearest(
            Int((profile.weightKg * proteinMultiplier).rounded()),
            interval: 5
        )
        let fat = min(
            90,
            max(
                50,
                roundToNearest(Int((profile.weightKg * 0.7).rounded()), interval: 5)
            )
        )
        let fiber = 30
        let carbCalories = max(0, selected - (protein * 4) - (fat * 9))
        let carbs = max(80, roundToNearest(Int((Double(carbCalories) / 4).rounded()), interval: 5))

        return NutritionTargets(
            goal: profile.goal,
            maintenanceCalories: maintenance,
            loseCalories: lose,
            maintainCalories: maintain,
            gainCalories: gain,
            selectedCalories: selected,
            proteinGrams: protein,
            fatGrams: fat,
            carbGrams: carbs,
            fiberGrams: fiber
        )
    }

    static func maintenanceCalories(
        weightKg: Double,
        stepsPerDay: Int,
        activeCaloriesPerDay: Double? = nil,
        restingCaloriesPerDay: Double? = nil
    ) -> Int {
        let stepEstimate = stepBasedMaintenanceCalories(
            weightKg: weightKg,
            stepsPerDay: stepsPerDay
        )

        guard let activeCaloriesPerDay,
              let restingCaloriesPerDay,
              activeCaloriesPerDay >= 0,
              restingCaloriesPerDay > 0 else {
            return stepEstimate
        }

        let observed = min(4_200, max(1_600, activeCaloriesPerDay + restingCaloriesPerDay))
        let blended = Int((observed * 0.7 + Double(stepEstimate) * 0.3).rounded())

        return min(4_000, max(1_600, roundToNearest(blended, interval: 50)))
    }

    private static func stepBasedMaintenanceCalories(weightKg: Double, stepsPerDay: Int) -> Int {
        let base = weightKg * 22
        let stepBonus = max(0, Double(stepsPerDay - 3_000) / 1_000) * 55
        let estimate = Int((base + stepBonus).rounded())

        return min(3_800, max(1_600, roundToNearest(estimate, interval: 50)))
    }

    private static func roundToNearest(_ value: Int, interval: Int) -> Int {
        Int((Double(value) / Double(interval)).rounded()) * interval
    }
}

struct MacroTotals: Codable, Equatable {
    var calories: Double
    var proteinGrams: Double
    var carbsGrams: Double
    var fatGrams: Double
    var fiberGrams: Double

    static let zero = MacroTotals(
        calories: 0,
        proteinGrams: 0,
        carbsGrams: 0,
        fatGrams: 0,
        fiberGrams: 0
    )

    static func + (lhs: MacroTotals, rhs: MacroTotals) -> MacroTotals {
        MacroTotals(
            calories: lhs.calories + rhs.calories,
            proteinGrams: lhs.proteinGrams + rhs.proteinGrams,
            carbsGrams: lhs.carbsGrams + rhs.carbsGrams,
            fatGrams: lhs.fatGrams + rhs.fatGrams,
            fiberGrams: lhs.fiberGrams + rhs.fiberGrams
        )
    }

    static func * (lhs: MacroTotals, rhs: Double) -> MacroTotals {
        MacroTotals(
            calories: lhs.calories * rhs,
            proteinGrams: lhs.proteinGrams * rhs,
            carbsGrams: lhs.carbsGrams * rhs,
            fatGrams: lhs.fatGrams * rhs,
            fiberGrams: lhs.fiberGrams * rhs
        )
    }
}

enum MealEstimateStatus: String, Codable, Equatable {
    case manual
    case aiEstimated
    case estimationFailed

    var displayName: String {
        switch self {
        case .manual:
            return "Manual"
        case .aiEstimated:
            return "AI estimate"
        case .estimationFailed:
            return "Estimate failed"
        }
    }
}

struct MealPhotoAttachment: Codable, Equatable, Identifiable {
    let id: UUID
    var filename: String
    var createdAt: Date
}

struct MealIngredientEntry: Codable, Equatable, Identifiable {
    let id: UUID
    var name: String
    var quantity: Double
    var unit: String
    var baseQuantity: Double
    var baseUnit: String
    var baseGrams: Double?
    var baseTotals: MacroTotals

    init(
        id: UUID = UUID(),
        name: String,
        quantity: Double,
        unit: String,
        baseQuantity: Double,
        baseUnit: String,
        baseGrams: Double?,
        baseTotals: MacroTotals
    ) {
        self.id = id
        self.name = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "Ingredient"
            : name.trimmingCharacters(in: .whitespacesAndNewlines)
        self.quantity = max(0, quantity)
        self.unit = unit.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "serving"
            : unit.trimmingCharacters(in: .whitespacesAndNewlines)
        self.baseQuantity = max(0.1, baseQuantity)
        self.baseUnit = baseUnit.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? self.unit
            : baseUnit.trimmingCharacters(in: .whitespacesAndNewlines)
        self.baseGrams = baseGrams.map { max(0.1, $0) }
        self.baseTotals = baseTotals
    }

    var totals: MacroTotals {
        baseTotals * multiplier
    }

    var availableUnits: [String] {
        var units = [baseUnit]

        if baseGrams != nil, !units.contains("g") {
            units.append("g")
        }

        if !units.contains(unit) {
            units.append(unit)
        }

        return units
    }

    var quantityStep: Double {
        unit == "g" ? 10 : 0.25
    }

    mutating func changeUnit(to newUnit: String) {
        guard newUnit != unit else {
            return
        }

        let grams = currentGrams
        unit = newUnit

        if newUnit == "g", let grams {
            quantity = grams
        } else if newUnit == baseUnit,
                  let grams,
                  let baseGrams,
                  baseGrams > 0 {
            quantity = grams / baseGrams * baseQuantity
        }
    }

    private var multiplier: Double {
        if unit == "g", let baseGrams, baseGrams > 0 {
            return quantity / baseGrams
        }

        if unit == baseUnit, baseQuantity > 0 {
            return quantity / baseQuantity
        }

        return quantity / baseQuantity
    }

    private var currentGrams: Double? {
        if unit == "g" {
            return quantity
        }

        guard unit == baseUnit,
              let baseGrams,
              baseQuantity > 0 else {
            return nil
        }

        return quantity / baseQuantity * baseGrams
    }
}

struct FoodIngredientSuggestion: Equatable, Identifiable {
    let id: String
    var ingredient: MealIngredientEntry
    var lastUsedAt: Date
    var usageCount: Int

    var title: String {
        ingredient.name
    }

    var detail: String {
        "\(formatQuantity(ingredient.quantity)) \(ingredient.unit) · \(Int(ingredient.totals.calories.rounded())) kcal"
    }

    func entryForMeal() -> MealIngredientEntry {
        MealIngredientEntry(
            name: ingredient.name,
            quantity: ingredient.quantity,
            unit: ingredient.unit,
            baseQuantity: ingredient.baseQuantity,
            baseUnit: ingredient.baseUnit,
            baseGrams: ingredient.baseGrams,
            baseTotals: ingredient.baseTotals
        )
    }

    static func recent(
        meals: [MealLogEntry],
        templates: [SavedMealTemplate] = [],
        excluding existingIngredients: [MealIngredientEntry] = [],
        limit: Int = 20
    ) -> [FoodIngredientSuggestion] {
        var suggestionsByKey: [String: FoodIngredientSuggestion] = [:]
        var orderedKeys: [String] = []
        let excludedKeys = Set(existingIngredients.map { normalizedKey(for: $0) })

        func add(_ ingredient: MealIngredientEntry, usedAt: Date, usageCount: Int = 1) {
            let key = normalizedKey(for: ingredient)
            guard !excludedKeys.contains(key) else {
                return
            }

            if var existing = suggestionsByKey[key] {
                existing.usageCount += max(1, usageCount)
                if usedAt > existing.lastUsedAt {
                    existing.lastUsedAt = usedAt
                    existing.ingredient = ingredient
                }
                suggestionsByKey[key] = existing
                return
            }

            suggestionsByKey[key] = FoodIngredientSuggestion(
                id: key,
                ingredient: ingredient,
                lastUsedAt: usedAt,
                usageCount: max(1, usageCount)
            )
            orderedKeys.append(key)
        }

        for meal in meals.sorted(by: { $0.loggedAt > $1.loggedAt }) {
            for ingredient in meal.ingredients {
                add(ingredient, usedAt: meal.loggedAt)
            }
        }

        for template in templates.sorted(by: { $0.lastUsedAt > $1.lastUsedAt }) {
            for ingredient in template.ingredients {
                add(
                    ingredient,
                    usedAt: template.lastUsedAt,
                    usageCount: max(1, template.usageCount)
                )
            }
        }

        return orderedKeys
            .compactMap { suggestionsByKey[$0] }
            .sorted {
                if $0.lastUsedAt == $1.lastUsedAt {
                    return $0.usageCount > $1.usageCount
                }

                return $0.lastUsedAt > $1.lastUsedAt
            }
            .prefix(limit)
            .map { $0 }
    }

    private static func normalizedKey(for ingredient: MealIngredientEntry) -> String {
        let normalizedName = ingredient.name
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(
                of: #"\s+"#,
                with: " ",
                options: .regularExpression
            )
        let normalizedUnit = ingredient.baseUnit
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        return "\(normalizedName)|\(normalizedUnit)"
    }

    private func formatQuantity(_ value: Double) -> String {
        if value.rounded() == value {
            return Int(value).formatted(.number)
        }

        return String(format: "%.2f", value)
            .replacingOccurrences(
                of: #"(\.\d*?[1-9])0+$"#,
                with: "$1",
                options: .regularExpression
            )
            .replacingOccurrences(
                of: #"\.0+$"#,
                with: "",
                options: .regularExpression
            )
    }
}

struct MealLogEntry: Codable, Equatable, Identifiable {
    let id: UUID
    var loggedAt: Date
    var mealType: String
    var title: String
    var note: String
    var totals: MacroTotals
    var ingredients: [MealIngredientEntry]
    var photoAttachments: [MealPhotoAttachment]
    var estimateStatus: MealEstimateStatus
    var estimateConfidence: Double?
    var createdAt: Date

    var dayId: Date {
        Calendar.current.startOfDay(for: loggedAt)
    }

    static func shortTitle(from text: String, fallback: String = "Meal") -> String {
        let cleaned = text
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(
                of: #"\s+"#,
                with: " ",
                options: .regularExpression
            )

        guard !cleaned.isEmpty else {
            return fallback.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? "Meal"
                : fallback.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        let words = cleaned.split(separator: " ").prefix(7)
        var title = words.joined(separator: " ")
        if title.count > 42 {
            title = String(title.prefix(39)).trimmingCharacters(in: .whitespacesAndNewlines) + "..."
        }

        return title
    }

    static func isGenericTitle(_ title: String) -> Bool {
        let normalized = title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        return normalized.isEmpty || normalized == "meal" || normalized == "saved meal"
    }

    static func promptSections(from text: String, titleFallback: String = "Meal") -> [MealPromptSection] {
        MealPromptSection.parse(text, titleFallback: titleFallback)
    }

    init(
        id: UUID,
        loggedAt: Date,
        mealType: String = "Meal",
        title: String,
        note: String,
        totals: MacroTotals,
        ingredients: [MealIngredientEntry] = [],
        photoAttachments: [MealPhotoAttachment] = [],
        estimateStatus: MealEstimateStatus = .manual,
        estimateConfidence: Double? = nil,
        createdAt: Date
    ) {
        self.id = id
        self.loggedAt = loggedAt
        self.mealType = mealType.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "Meal"
            : mealType.trimmingCharacters(in: .whitespacesAndNewlines)
        self.title = title
        self.note = note
        self.totals = totals
        self.ingredients = ingredients
        self.photoAttachments = photoAttachments
        self.estimateStatus = estimateStatus
        self.estimateConfidence = estimateConfidence
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case loggedAt
        case mealType
        case title
        case note
        case totals
        case ingredients
        case photoAttachments
        case estimateStatus
        case estimateConfidence
        case createdAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        loggedAt = try container.decode(Date.self, forKey: .loggedAt)
        mealType = try container.decodeIfPresent(String.self, forKey: .mealType) ?? "Meal"
        title = try container.decode(String.self, forKey: .title)
        note = try container.decode(String.self, forKey: .note)
        totals = try container.decode(MacroTotals.self, forKey: .totals)
        ingredients = try container.decodeIfPresent(
            [MealIngredientEntry].self,
            forKey: .ingredients
        ) ?? []
        photoAttachments = try container.decodeIfPresent(
            [MealPhotoAttachment].self,
            forKey: .photoAttachments
        ) ?? []
        estimateStatus = try container.decodeIfPresent(
            MealEstimateStatus.self,
            forKey: .estimateStatus
        ) ?? .manual
        estimateConfidence = try container.decodeIfPresent(
            Double.self,
            forKey: .estimateConfidence
        )
        createdAt = try container.decode(Date.self, forKey: .createdAt)
    }
}

struct MealPromptSection: Equatable, Identifiable {
    let id = UUID()
    var title: String
    var prompt: String

    static func parse(_ text: String, titleFallback: String = "Meal") -> [MealPromptSection] {
        let lines = text
            .split(whereSeparator: \.isNewline)
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        guard !lines.isEmpty else {
            return []
        }

        var sections: [MealPromptSection] = []
        var currentTitle: String?
        var currentLines: [String] = []

        func flush() {
            let prompt = currentLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !prompt.isEmpty || currentTitle != nil else {
                return
            }

            let titleSource = currentTitle ?? prompt
            sections.append(
                MealPromptSection(
                    title: MealLogEntry.shortTitle(from: titleSource, fallback: titleFallback),
                    prompt: prompt.isEmpty ? titleSource : prompt
                )
            )
            currentTitle = nil
            currentLines = []
        }

        for line in lines {
            if let prefixed = prefixedSection(from: line) {
                flush()
                currentTitle = prefixed.title
                if !prefixed.remaining.isEmpty {
                    currentLines.append(prefixed.remaining)
                }
                continue
            }

            currentLines.append(line)
        }

        flush()

        return sections.isEmpty
            ? [MealPromptSection(title: MealLogEntry.shortTitle(from: text, fallback: titleFallback), prompt: text)]
            : sections
    }

    private static func prefixedSection(from line: String) -> (title: String, remaining: String)? {
        let prefixes = [
            "בוקר",
            "ארוחת בוקר",
            "צהריים",
            "ארוחת צהריים",
            "ערב",
            "ארוחת ערב",
            "נשנוש",
            "חטיף",
            "לילה",
            "breakfast",
            "lunch",
            "dinner",
            "snack",
            "morning",
            "noon",
            "evening",
        ]

        for prefix in prefixes.sorted(by: { $0.count > $1.count }) {
            if line == prefix {
                return (prefix, "")
            }

            if line.lowercased().hasPrefix(prefix.lowercased() + " ") {
                let remaining = String(line.dropFirst(prefix.count))
                    .trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: "-:–—")))
                return (prefix, remaining)
            }
        }

        return nil
    }

}

struct NutritionDaySummary: Identifiable, Equatable {
    let date: Date
    let totals: MacroTotals

    var id: Date { date }
}

final class CoachProfileStore: ObservableObject {
    static let defaultsKey = "FitnessCoach.CoachProfile.v1"

    @Published private(set) var profile: CoachProfile?

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        profile = Self.load(defaults: defaults)
    }

    func save(_ profile: CoachProfile) {
        self.profile = profile

        guard let data = try? JSONEncoder().encode(profile) else {
            return
        }

        defaults.set(data, forKey: Self.defaultsKey)
    }

    func clear() {
        profile = nil
        defaults.removeObject(forKey: Self.defaultsKey)
    }

    private static func load(defaults: UserDefaults) -> CoachProfile? {
        guard let data = defaults.data(forKey: Self.defaultsKey) else {
            return nil
        }

        return try? JSONDecoder().decode(CoachProfile.self, from: data)
    }
}

final class MealLogStore: ObservableObject {
    static let defaultsKey = "FitnessCoach.MealLogs.v1" // gitleaks:allow -- UserDefaults key
    static let deletedMealIdsKey = "FitnessCoach.DeletedMealIds.v1"
    static let deletedMealTombstonesKey = "FitnessCoach.DeletedMealTombstones.v1"
    static let photoDirectoryName = "MealPhotos"

    @Published private(set) var meals: [MealLogEntry]
    @Published private(set) var pendingDeletedMealIds: Set<UUID>
    @Published private(set) var deletedMealTombstones: [DeletedMealTombstone]

    private let defaults: UserDefaults
    private let fileManager: FileManager

    init(defaults: UserDefaults = .standard, fileManager: FileManager = .default) {
        self.defaults = defaults
        self.fileManager = fileManager
        meals = Self.load(defaults: defaults)
        pendingDeletedMealIds = Self.loadDeletedMealIds(defaults: defaults)
        deletedMealTombstones = Self.loadDeletedMealTombstones(defaults: defaults)
    }

    @discardableResult
    func add(_ meal: MealLogEntry, photoData: [Data] = []) -> MealLogEntry {
        var mealWithPhotos = meal
        if !photoData.isEmpty {
            mealWithPhotos.photoAttachments = savePhotoData(
                photoData,
                createdAt: meal.createdAt
            )
        }

        meals.append(mealWithPhotos)
        meals.sort { $0.loggedAt > $1.loggedAt }
        persist()

        return mealWithPhotos
    }

    func delete(_ meal: MealLogEntry) {
        pendingDeletedMealIds.insert(meal.id)
        addDeletedMealTombstone(for: meal)
        for attachment in meal.photoAttachments {
            try? fileManager.removeItem(at: photoURL(for: attachment))
        }

        meals.removeAll { $0.id == meal.id }
        persist()
        persistDeletedMealIds()
    }

    func markRemoteDeleteCompleted(mealId: UUID) {
        guard pendingDeletedMealIds.remove(mealId) != nil else {
            return
        }

        persistDeletedMealIds()
    }

    @discardableResult
    func update(_ meal: MealLogEntry, photoData: [Data]) -> MealLogEntry {
        guard let index = meals.firstIndex(where: { $0.id == meal.id }) else {
            return add(meal, photoData: photoData)
        }

        let previousAttachments = meals[index].photoAttachments
        var updatedMeal = meal
        updatedMeal.photoAttachments = savePhotoData(
            photoData,
            createdAt: Date()
        )
        meals[index] = updatedMeal
        meals.sort { $0.loggedAt > $1.loggedAt }
        persist()

        for attachment in previousAttachments {
            try? fileManager.removeItem(at: photoURL(for: attachment))
        }

        return updatedMeal
    }

    @discardableResult
    func updateMetadata(_ meal: MealLogEntry) -> MealLogEntry {
        guard let index = meals.firstIndex(where: { $0.id == meal.id }) else {
            return add(meal)
        }

        var updatedMeal = meal
        updatedMeal.photoAttachments = meals[index].photoAttachments
        meals[index] = updatedMeal
        meals.sort { $0.loggedAt > $1.loggedAt }
        persist()

        return updatedMeal
    }

    @discardableResult
    func reorderMeals(_ orderedMeals: [MealLogEntry], on date: Date, calendar: Calendar = .current) -> [MealLogEntry] {
        let day = calendar.startOfDay(for: date)
        let orderedIds = orderedMeals.map(\.id)
        guard !orderedIds.isEmpty else {
            return []
        }

        var changedMeals: [MealLogEntry] = []
        let latestVisibleSecond = (23 * 60 * 60) + (59 * 60)

        for (orderIndex, mealId) in orderedIds.enumerated() {
            guard let index = meals.firstIndex(where: { $0.id == mealId }) else {
                continue
            }

            var updatedMeal = meals[index]
            let secondsFromStart = latestVisibleSecond - (orderIndex * 60)
            let reorderedDate = calendar.date(
                byAdding: .second,
                value: max(0, secondsFromStart),
                to: day
            ) ?? updatedMeal.loggedAt

            guard updatedMeal.loggedAt != reorderedDate else {
                continue
            }

            updatedMeal.loggedAt = reorderedDate
            meals[index] = updatedMeal
            changedMeals.append(updatedMeal)
        }

        if !changedMeals.isEmpty {
            meals.sort { $0.loggedAt > $1.loggedAt }
            persist()
        }

        return changedMeals
    }

    @discardableResult
    func reorderIngredients(_ orderedIngredients: [MealIngredientEntry], in meal: MealLogEntry) -> MealLogEntry {
        var updatedMeal = meal
        updatedMeal.ingredients = orderedIngredients

        return updateMetadata(updatedMeal)
    }

    @discardableResult
    func moveIngredient(_ ingredientID: UUID, to targetMealID: UUID) -> [MealLogEntry] {
        guard let sourceIndex = meals.firstIndex(where: { meal in
            meal.ingredients.contains { $0.id == ingredientID }
        }),
              let ingredientIndex = meals[sourceIndex].ingredients.firstIndex(where: { $0.id == ingredientID }),
              let targetIndex = meals.firstIndex(where: { $0.id == targetMealID }),
              sourceIndex != targetIndex else {
            return []
        }

        let sourceMealID = meals[sourceIndex].id
        let targetMealID = meals[targetIndex].id
        let movedIngredient = meals[sourceIndex].ingredients.remove(at: ingredientIndex)
        meals[targetIndex].ingredients.append(movedIngredient)
        meals[sourceIndex].totals = meals[sourceIndex].ingredients.map(\.totals).reduce(.zero, +)
        meals[targetIndex].totals = meals[targetIndex].ingredients.map(\.totals).reduce(.zero, +)
        meals[sourceIndex].estimateStatus = meals[sourceIndex].ingredients.isEmpty
            ? .manual
            : meals[sourceIndex].estimateStatus
        meals[targetIndex].estimateStatus = .manual
        meals[sourceIndex].estimateConfidence = meals[sourceIndex].ingredients.isEmpty
            ? nil
            : meals[sourceIndex].estimateConfidence
        meals[targetIndex].estimateConfidence = nil
        meals.sort { $0.loggedAt > $1.loggedAt }
        persist()

        return [sourceMealID, targetMealID].compactMap { changedMealID in
            meals.first { $0.id == changedMealID }
        }
    }

    func mergeRemote(_ remoteMeals: [MealLogEntry]) {
        guard !remoteMeals.isEmpty else {
            return
        }

        pruneDeletedMealTombstones()
        var mergedById = Dictionary(uniqueKeysWithValues: meals.map { ($0.id, $0) })

        for remoteMeal in remoteMeals {
            if pendingDeletedMealIds.contains(remoteMeal.id) || isDeletedMeal(remoteMeal) {
                pendingDeletedMealIds.insert(remoteMeal.id)
                mergedById.removeValue(forKey: remoteMeal.id)
                continue
            }

            if let existingMeal = mergedById[remoteMeal.id] {
                var mergedMeal = remoteMeal
                mergedMeal.photoAttachments = existingMeal.photoAttachments
                mergedById[remoteMeal.id] = mergedMeal
            } else {
                mergedById[remoteMeal.id] = remoteMeal
            }
        }

        meals = mergedById.values.sorted { $0.loggedAt > $1.loggedAt }
        persist()
        persistDeletedMealIds()
        persistDeletedMealTombstones()
    }

    func replaceRemote(
        _ remoteMeals: [MealLogEntry],
        from startDate: Date,
        to endDate: Date
    ) {
        pruneDeletedMealTombstones()
        var mergedById = Dictionary(
            uniqueKeysWithValues: meals
                .filter { meal in
                    meal.loggedAt < startDate || meal.loggedAt >= endDate
                }
                .map { ($0.id, $0) }
        )

        for remoteMeal in remoteMeals {
            if pendingDeletedMealIds.contains(remoteMeal.id) || isDeletedMeal(remoteMeal) {
                pendingDeletedMealIds.insert(remoteMeal.id)
                mergedById.removeValue(forKey: remoteMeal.id)
                continue
            }

            if let existingMeal = meals.first(where: { $0.id == remoteMeal.id }) {
                var mergedMeal = remoteMeal
                mergedMeal.photoAttachments = existingMeal.photoAttachments
                mergedById[remoteMeal.id] = mergedMeal
            } else {
                mergedById[remoteMeal.id] = remoteMeal
            }
        }

        meals = mergedById.values.sorted { $0.loggedAt > $1.loggedAt }
        persist()
        persistDeletedMealIds()
        persistDeletedMealTombstones()
    }

    func photoURL(for attachment: MealPhotoAttachment) -> URL {
        photoDirectoryURL().appendingPathComponent(attachment.filename)
    }

    func photoData(for meal: MealLogEntry) -> [Data] {
        meal.photoAttachments.compactMap { attachment in
            try? Data(contentsOf: photoURL(for: attachment))
        }
    }

    func thumbnailData(for meal: MealLogEntry) -> Data? {
        guard let attachment = meal.photoAttachments.first else {
            return nil
        }

        return try? Data(contentsOf: photoURL(for: attachment))
    }

    func meals(on date: Date = Date(), calendar: Calendar = .current) -> [MealLogEntry] {
        meals
            .filter { calendar.isDate($0.loggedAt, inSameDayAs: date) }
            .sorted { $0.loggedAt > $1.loggedAt }
    }

    func totals(on date: Date = Date(), calendar: Calendar = .current) -> MacroTotals {
        meals(on: date, calendar: calendar)
            .map(\.totals)
            .reduce(.zero, +)
    }

    func dailySummaries(
        days: Int,
        endingAt date: Date = Date(),
        calendar: Calendar = .current
    ) -> [NutritionDaySummary] {
        let end = calendar.startOfDay(for: date)

        return (0..<max(1, days)).compactMap { offset in
            guard let day = calendar.date(
                byAdding: .day,
                value: -(days - 1 - offset),
                to: end
            ) else {
                return nil
            }

            return NutritionDaySummary(
                date: day,
                totals: totals(on: day, calendar: calendar)
            )
        }
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(meals) else {
            return
        }

        defaults.set(data, forKey: Self.defaultsKey)
    }

    private func persistDeletedMealIds() {
        let ids = pendingDeletedMealIds.map(\.uuidString)
        defaults.set(ids, forKey: Self.deletedMealIdsKey)
    }

    private func addDeletedMealTombstone(for meal: MealLogEntry) {
        let tombstone = DeletedMealTombstone(meal: meal)
        deletedMealTombstones.removeAll { $0.signature == tombstone.signature }
        deletedMealTombstones.append(tombstone)
        pruneDeletedMealTombstones()
        persistDeletedMealTombstones()
    }

    private func isDeletedMeal(_ meal: MealLogEntry) -> Bool {
        let signature = DeletedMealTombstone.signature(for: meal)

        return deletedMealTombstones.contains { tombstone in
            tombstone.signature == signature && tombstone.mealId != meal.id
        }
    }

    private func pruneDeletedMealTombstones(now: Date = Date()) {
        let maxAge = 90.0 * 24.0 * 60.0 * 60.0
        deletedMealTombstones.removeAll { now.timeIntervalSince($0.deletedAt) > maxAge }
    }

    private func persistDeletedMealTombstones() {
        guard let data = try? JSONEncoder().encode(deletedMealTombstones) else {
            return
        }

        defaults.set(data, forKey: Self.deletedMealTombstonesKey)
    }

    private func savePhotoData(
        _ photoData: [Data],
        createdAt: Date
    ) -> [MealPhotoAttachment] {
        let directoryURL = photoDirectoryURL()
        try? fileManager.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: true
        )

        return photoData.compactMap { data in
            let id = UUID()
            let filename = "\(id.uuidString).jpg"
            let url = directoryURL.appendingPathComponent(filename)

            do {
                try data.write(to: url, options: [.atomic])
                return MealPhotoAttachment(
                    id: id,
                    filename: filename,
                    createdAt: createdAt
                )
            } catch {
                return nil
            }
        }
    }

    private func photoDirectoryURL() -> URL {
        let rootURL = fileManager.urls(
            for: .documentDirectory,
            in: .userDomainMask
        )[0]

        return rootURL.appendingPathComponent(Self.photoDirectoryName, isDirectory: true)
    }

    private static func load(defaults: UserDefaults) -> [MealLogEntry] {
        guard let data = defaults.data(forKey: Self.defaultsKey),
              let meals = try? JSONDecoder().decode([MealLogEntry].self, from: data) else {
            return []
        }

        return meals.sorted { $0.loggedAt > $1.loggedAt }
    }

    private static func loadDeletedMealIds(defaults: UserDefaults) -> Set<UUID> {
        let ids = defaults.stringArray(forKey: Self.deletedMealIdsKey) ?? []

        return Set(ids.compactMap(UUID.init(uuidString:)))
    }

    private static func loadDeletedMealTombstones(defaults: UserDefaults) -> [DeletedMealTombstone] {
        guard let data = defaults.data(forKey: Self.deletedMealTombstonesKey),
              let tombstones = try? JSONDecoder().decode([DeletedMealTombstone].self, from: data) else {
            return []
        }

        return tombstones
    }
}

struct DeletedMealTombstone: Codable, Equatable {
    var mealId: UUID?
    var signature: String
    var deletedAt: Date

    init(meal: MealLogEntry, deletedAt: Date = Date()) {
        mealId = meal.id
        signature = Self.signature(for: meal)
        self.deletedAt = deletedAt
    }

    static func signature(for meal: MealLogEntry, calendar: Calendar = .current) -> String {
        let day = Int(calendar.startOfDay(for: meal.loggedAt).timeIntervalSince1970.rounded())
        let calories = Int(meal.totals.calories.rounded())
        let ingredients = meal.ingredients
            .map { normalize($0.name) }
            .joined(separator: ",")

        return [
            "\(day)",
            normalize(meal.mealType),
            normalize(meal.title),
            normalize(meal.note),
            "\(calories)",
            ingredients,
        ].joined(separator: "|")
    }

    private static func normalize(_ value: String) -> String {
        value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(
                of: #"\s+"#,
                with: " ",
                options: .regularExpression
            )
    }
}

struct SavedMealTemplate: Codable, Equatable, Identifiable {
    let id: UUID
    var title: String
    var mealType: String
    var note: String
    var totals: MacroTotals
    var ingredients: [MealIngredientEntry]
    var createdAt: Date
    var lastUsedAt: Date
    var usageCount: Int

    init(
        id: UUID = UUID(),
        title: String,
        mealType: String,
        note: String,
        totals: MacroTotals,
        ingredients: [MealIngredientEntry],
        createdAt: Date = Date(),
        lastUsedAt: Date = Date(),
        usageCount: Int = 0
    ) {
        self.id = id
        self.title = title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "Saved meal"
            : title.trimmingCharacters(in: .whitespacesAndNewlines)
        self.mealType = mealType
        self.note = note
        self.totals = totals
        self.ingredients = ingredients
        self.createdAt = createdAt
        self.lastUsedAt = lastUsedAt
        self.usageCount = max(0, usageCount)
    }

    init(meal: MealLogEntry, now: Date = Date()) {
        self.init(
            title: meal.title,
            mealType: meal.mealType,
            note: meal.note,
            totals: meal.totals,
            ingredients: meal.ingredients,
            createdAt: now,
            lastUsedAt: now
        )
    }

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case mealType
        case note
        case totals
        case ingredients
        case createdAt
        case lastUsedAt
        case usageCount
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        mealType = try container.decode(String.self, forKey: .mealType)
        note = try container.decode(String.self, forKey: .note)
        totals = try container.decode(MacroTotals.self, forKey: .totals)
        ingredients = try container.decode(
            [MealIngredientEntry].self,
            forKey: .ingredients
        )
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        lastUsedAt = try container.decode(Date.self, forKey: .lastUsedAt)
        usageCount = try container.decodeIfPresent(
            Int.self,
            forKey: .usageCount
        ) ?? 0
    }
}

final class SavedMealStore: ObservableObject {
    static let defaultsKey = "FitnessCoach.SavedMeals.v1" // gitleaks:allow -- UserDefaults key

    @Published private(set) var templates: [SavedMealTemplate]

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        templates = Self.load(defaults: defaults)
    }

    @discardableResult
    func saveTemplate(from meal: MealLogEntry, now: Date = Date()) -> SavedMealTemplate {
        let template = SavedMealTemplate(meal: meal, now: now)
        let normalizedTitle = template.title.lowercased()

        let previousUsageCount = templates.first {
            $0.title.lowercased() == normalizedTitle &&
                $0.mealType == template.mealType
        }?.usageCount ?? 0
        templates.removeAll {
            $0.title.lowercased() == normalizedTitle &&
                $0.mealType == template.mealType
        }
        var storedTemplate = template
        storedTemplate.usageCount = previousUsageCount
        templates.insert(storedTemplate, at: 0)
        templates = Array(templates.prefix(30))
        persist()

        return storedTemplate
    }

    func markUsed(_ template: SavedMealTemplate, now: Date = Date()) {
        guard let index = templates.firstIndex(where: { $0.id == template.id }) else {
            return
        }

        templates[index].lastUsedAt = now
        templates[index].usageCount += 1
        templates.sort { $0.lastUsedAt > $1.lastUsedAt }
        persist()
    }

    func delete(_ template: SavedMealTemplate) {
        templates.removeAll { $0.id == template.id }
        persist()
    }

    func mergeRemote(_ remoteTemplates: [SavedMealTemplate]) {
        guard !remoteTemplates.isEmpty else {
            return
        }

        var mergedById = Dictionary(uniqueKeysWithValues: templates.map { ($0.id, $0) })

        for remoteTemplate in remoteTemplates {
            if let existingTemplate = mergedById[remoteTemplate.id],
               existingTemplate.lastUsedAt > remoteTemplate.lastUsedAt {
                continue
            }

            mergedById[remoteTemplate.id] = remoteTemplate
        }

        templates = Array(
            mergedById.values
                .sorted { $0.lastUsedAt > $1.lastUsedAt }
                .prefix(30)
        )
        persist()
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(templates) else {
            return
        }

        defaults.set(data, forKey: Self.defaultsKey)
    }

    private static func load(defaults: UserDefaults) -> [SavedMealTemplate] {
        guard let data = defaults.data(forKey: Self.defaultsKey),
              let templates = try? JSONDecoder().decode(
                  [SavedMealTemplate].self,
                  from: data
              ) else {
            return []
        }

        return templates.sorted { $0.lastUsedAt > $1.lastUsedAt }
    }
}

enum MealReminderScheduler {
    static let legacyIdentifiers = [
        "FitnessCoach.MealReminder.breakfast",
        "FitnessCoach.MealReminder.lunch",
        "FitnessCoach.MealReminder.snack",
        "FitnessCoach.MealReminder.dinner",
    ]
    static let coachSummaryIdentifier = "FitnessCoach.MealReminder.coachSummary"
    static let coachSummaryLeadMinutes = 45

    static func cancelAllReminders() {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { requests in
            let identifiers = requests
                .map(\.identifier)
                .filter { $0.hasPrefix("FitnessCoach.MealReminder.") }

            center.removePendingNotificationRequests(
                withIdentifiers: Array(Set(legacyIdentifiers + identifiers))
            )
        }
    }

    static func scheduleReminders(for profile: CoachProfile) {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { requests in
            let identifiers = requests
                .map(\.identifier)
                .filter { $0.hasPrefix("FitnessCoach.MealReminder.") }

            center.removePendingNotificationRequests(
                withIdentifiers: Array(Set(legacyIdentifiers + identifiers))
            )

            guard profile.mealRemindersEnabled else {
                return
            }

            center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
                guard granted else {
                    return
                }

                for slot in profile.effectiveMealSlots where slot.remindersEnabled {
                    let content = UNMutableNotificationContent()
                    content.title = "Log \(slot.displayName)"
                    content.body = "Add what you ate when convenient."
                    content.sound = .default

                    var components = DateComponents()
                    components.hour = slot.timeMinutes / 60
                    components.minute = slot.timeMinutes % 60

                    center.add(
                        UNNotificationRequest(
                            identifier: identifier(for: slot),
                            content: content,
                            trigger: UNCalendarNotificationTrigger(
                                dateMatching: components,
                                repeats: true
                            )
                        )
                    )
                }

                let content = UNMutableNotificationContent()
                content.title = "Before sleep check-in"
                content.body = "Review today's meals and adjust anything you missed."
                content.sound = .default

                var components = DateComponents()
                let summaryTime = coachSummaryTimeMinutes(for: profile)
                components.hour = summaryTime / 60
                components.minute = summaryTime % 60

                center.add(
                    UNNotificationRequest(
                        identifier: coachSummaryIdentifier,
                        content: content,
                        trigger: UNCalendarNotificationTrigger(
                            dateMatching: components,
                            repeats: true
                        )
                    )
                )
            }
        }
    }

    static func coachSummaryTimeMinutes(for profile: CoachProfile) -> Int {
        (profile.sleepTimeMinutes - coachSummaryLeadMinutes + 24 * 60) % (24 * 60)
    }

    private static func identifier(for slot: CoachMealSlot) -> String {
        "FitnessCoach.MealReminder.\(slot.id.uuidString)"
    }
}
