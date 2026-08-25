import Combine
import Foundation

struct DailyMealPlanResponse: Codable, Equatable {
    let plan: DailyMealPlanDTO
    let plannedTotals: MacroTotals
    let effectiveTargets: MacroTotals?
    let plannedRemaining: MacroTotals?
}

struct DailyMealPlanDTO: Codable, Equatable, Identifiable {
    let id: String
    let profileId: String
    let localFoodDate: String
    let timezone: String
    let status: String
    let title: String?
    let note: String?
    let meals: [PlannedMealDTO]
    let version: Int
}

struct PlannedMealDTO: Codable, Equatable, Identifiable {
    let id: String
    let mealType: String
    let plannedTime: String?
    let title: String
    let description: String
    let instructions: String
    let status: String
    let linkedMealLogId: String?
    let ingredients: [PlannedMealIngredientDTO]
    let sortOrder: Int
    let version: Int

    var calories: Double {
        ingredients.reduce(0) { $0 + $1.totals.calories }
    }

    var displayStatus: String {
        if linkedMealLogId != nil && ["confirmed", "eaten_as_planned"].contains(status) {
            return "Confirmed · Logged"
        }
        if linkedMealLogId != nil && ["partially_eaten", "replaced"].contains(status) {
            return "Changed · Logged"
        }
        if status == "skipped" {
            return "Skipped · Not logged"
        }
        if ["unconfirmed", "not_confirmed"].contains(status) {
            return "Unconfirmed · Not logged"
        }
        return "Planned · Not logged"
    }
}

struct PlannedMealIngredientDTO: Codable, Equatable, Identifiable {
    let id: String
    let displayName: String
    let quantity: Double
    let unit: String
    let grams: Double?
    let totals: MacroTotals
}

enum MealPlanClientError: LocalizedError {
    case missingSession
    case missingMealWriteScope
    case missingAccessToken
    case rejected(statusCode: Int, message: String?)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .missingSession:
            return "Sign in with Google in Settings to load meal plans."
        case .missingMealWriteScope:
            return "Sign in again to enable meal-plan access."
        case .missingAccessToken:
            return "Meal-plan authorization is missing. Sign in again."
        case .rejected(let statusCode, let message):
            return "Meal-plan request failed (HTTP \(statusCode))\(message.map { ": \($0)" } ?? "")."
        case .invalidResponse:
            return "The server returned an invalid meal plan."
        }
    }
}

struct MealPlanClient: Sendable {
    private let sessionStore: HealthSyncSessionStore
    private let sessionManager: HealthSyncSessionManager
    private let urlSession: URLSession

    init(
        sessionStore: HealthSyncSessionStore = HealthSyncSessionStore(),
        urlSession: URLSession = .shared
    ) {
        self.sessionStore = sessionStore
        sessionManager = HealthSyncSessionManager(store: sessionStore)
        self.urlSession = urlSession
    }

    func dailyPlan(localFoodDate: String, timezone: String) async throws -> DailyMealPlanResponse? {
        let session = try authorizedSession()
        var components = URLComponents(
            url: session.backendURL.appendingPathComponent("api/meals/plans"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "date", value: localFoodDate),
            URLQueryItem(name: "timezone", value: timezone)
        ]
        guard let url = components?.url else { throw MealPlanClientError.invalidResponse }
        let response = try await request(url: url, method: "GET", body: Optional<String>.none)
        if response.statusCode == 404 { return nil }
        return try decode(DailyMealPlanResponse.self, data: response.data, statusCode: response.statusCode)
    }

    func markSkipped(plan: DailyMealPlanDTO, meal: PlannedMealDTO) async throws -> DailyMealPlanResponse {
        try await mutate(
            path: "api/meals/planned/\(meal.id)/status",
            body: StatusRequest(
                status: "skipped",
                expectedPlanVersion: plan.version,
                expectedMealVersion: meal.version
            )
        )
    }

    func updateTime(
        plan: DailyMealPlanDTO,
        meal: PlannedMealDTO,
        plannedTime: String?
    ) async throws -> DailyMealPlanResponse {
        try await mutate(
            path: "api/meals/planned/\(meal.id)",
            method: "PATCH",
            body: PlannedMealPatchRequest(
                expectedPlanVersion: plan.version,
                expectedMealVersion: meal.version,
                patch: PlannedMealPatch(plannedTime: plannedTime)
            )
        )
    }

    func replaceWithOpenMeal(
        plan: DailyMealPlanDTO,
        meal: PlannedMealDTO,
        title: String,
        reason: String?
    ) async throws -> DailyMealPlanResponse {
        try await mutate(
            path: "api/meals/planned/\(meal.id)/replace",
            body: ReplacePlannedMealRequest(
                expectedPlanVersion: plan.version,
                expectedMealVersion: meal.version,
                replacement: PlannedMealRequest(
                    mealType: meal.mealType,
                    plannedTime: meal.plannedTime,
                    title: title,
                    description: "Open replacement",
                    instructions: "",
                    status: "planned",
                    sortOrder: meal.sortOrder,
                    ingredients: []
                ),
                reason: reason,
                confirmReplace: true
            )
        )
    }

    func convert(
        plan: DailyMealPlanDTO,
        meal: PlannedMealDTO,
        fraction: Double
    ) async throws -> DailyMealPlanResponse {
        let adjusted = fraction >= 1 ? nil : meal.ingredients.map { ingredient in
            PlannedIngredientRequest(
                displayName: ingredient.displayName,
                quantity: ingredient.quantity * fraction,
                unit: ingredient.unit,
                grams: ingredient.grams.map { $0 * fraction },
                totals: ingredient.totals.scaled(by: fraction)
            )
        }
        return try await mutate(
            path: "api/meals/planned/\(meal.id)/convert",
            body: ConversionRequest(
                status: fraction >= 1 ? "confirmed" : "partially_eaten",
                expectedPlanVersion: plan.version,
                expectedMealVersion: meal.version,
                actualIngredients: adjusted,
                idempotencyKey: "ios-plan-convert-\(meal.id)-\(meal.version)-\(fraction)",
                origin: "ios"
            )
        )
    }

    func convert(
        plan: DailyMealPlanDTO,
        meal: PlannedMealDTO,
        actualIngredients: [PlannedMealIngredientDTO],
        status: String
    ) async throws -> DailyMealPlanResponse {
        try await mutate(
            path: "api/meals/planned/\(meal.id)/convert",
            body: ConversionRequest(
                status: status,
                expectedPlanVersion: plan.version,
                expectedMealVersion: meal.version,
                actualIngredients: actualIngredients.map(PlannedIngredientRequest.init),
                idempotencyKey: "ios-plan-convert-\(meal.id)-\(meal.version)-custom",
                origin: "ios"
            )
        )
    }

    func addOpenPlaceholder(
        existing response: DailyMealPlanResponse?,
        localFoodDate: String,
        timezone: String,
        mealType: String,
        plannedTime: String?,
        title: String,
        note: String?
    ) async throws -> DailyMealPlanResponse {
        let existingPlan = response?.plan
        var meals = existingPlan?.meals.map(PlannedMealRequest.init) ?? []
        let sortOrder = (meals.map(\.sortOrder).max() ?? -1) + 1
        meals.append(
            PlannedMealRequest(
                mealType: mealType,
                plannedTime: plannedTime,
                title: title,
                description: note ?? "Open meal",
                instructions: "",
                status: "planned",
                sortOrder: sortOrder,
                ingredients: []
            )
        )
        return try await mutate(
            path: "api/meals/plans",
            body: UpsertMealPlanRequest(
                localFoodDate: localFoodDate,
                timezone: timezone,
                status: existingPlan?.status ?? "active",
                title: existingPlan?.title ?? "Today",
                note: existingPlan?.note,
                meals: meals,
                idempotencyKey: "ios-plan-open-\(localFoodDate)-\(UUID().uuidString)",
                expectedVersion: existingPlan?.version,
                confirmReplace: true
            )
        )
    }

    func copyDailyPlan(
        sourceLocalFoodDate: String,
        destinationLocalFoodDate: String,
        timezone: String,
        expectedDestinationVersion: Int?
    ) async throws -> DailyMealPlanResponse {
        try await mutate(
            path: "api/meals/plans/copy",
            body: CopyDailyPlanRequest(
                sourceLocalFoodDate: sourceLocalFoodDate,
                destinationLocalFoodDate: destinationLocalFoodDate,
                timezone: timezone,
                idempotencyKey: "ios-plan-copy-\(sourceLocalFoodDate)-\(destinationLocalFoodDate)-\(UUID().uuidString)",
                confirmReplace: true,
                expectedDestinationVersion: expectedDestinationVersion
            )
        )
    }

    private func mutate<Body: Encodable>(
        path: String,
        method: String = "POST",
        body: Body
    ) async throws -> DailyMealPlanResponse {
        let session = try authorizedSession()
        let response = try await request(
            url: session.backendURL.appendingPathComponent(path),
            method: method,
            body: body
        )
        let envelope = try decode(
            MealPlanMutationEnvelope.self,
            data: response.data,
            statusCode: response.statusCode
        )
        return DailyMealPlanResponse(
            plan: envelope.plan,
            plannedTotals: envelope.plan.plannedTotals,
            effectiveTargets: nil,
            plannedRemaining: nil
        )
    }

    private func authorizedSession() throws -> HealthSyncSession {
        guard let session = sessionStore.loadSession() else { throw MealPlanClientError.missingSession }
        guard session.scope?.split(separator: " ").contains("meal:write") == true else {
            throw MealPlanClientError.missingMealWriteScope
        }
        return session
    }

    private func request<Body: Encodable>(url: URL, method: String, body: Body?) async throws -> (data: Data, statusCode: Int) {
        guard let token = try await sessionManager.bearerToken(forceRefresh: false) else {
            throw MealPlanClientError.missingAccessToken
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await urlSession.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw MealPlanClientError.invalidResponse }
        return (data, http.statusCode)
    }

    private func decode<Value: Decodable>(_ type: Value.Type, data: Data, statusCode: Int) throws -> Value {
        guard (200..<300).contains(statusCode) else {
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw MealPlanClientError.rejected(
                statusCode: statusCode,
                message: object?["message"] as? String ?? object?["error"] as? String
            )
        }
        guard let value = try? HealthSyncTokenJSON.decoder.decode(type, from: data) else {
            throw MealPlanClientError.invalidResponse
        }
        return value
    }
}

@MainActor
final class DailyMealPlanStore: ObservableObject {
    @Published private(set) var response: DailyMealPlanResponse?
    @Published private(set) var isLoading = false
    @Published private(set) var message: String?
    private let client: MealPlanClient

    init(client: MealPlanClient = MealPlanClient()) {
        self.client = client
    }

    func refresh(date: Date = Date(), timezone: TimeZone = .current) async {
        isLoading = true
        response = nil
        defer { isLoading = false }
        do {
            response = try await client.dailyPlan(
                localFoodDate: Self.localFoodDate(date, timezone: timezone),
                timezone: timezone.identifier
            )
            message = response == nil ? "No meal plan for today." : nil
        } catch {
            message = error.localizedDescription
        }
    }

    func consume(_ meal: PlannedMealDTO, fraction: Double) async {
        guard let plan = response?.plan else { return }
        await update { try await client.convert(plan: plan, meal: meal, fraction: fraction) }
    }

    func consume(
        _ meal: PlannedMealDTO,
        actualIngredients: [PlannedMealIngredientDTO],
        status: String
    ) async {
        guard let plan = response?.plan else { return }
        await update {
            try await client.convert(
                plan: plan,
                meal: meal,
                actualIngredients: actualIngredients,
                status: status
            )
        }
    }

    func skip(_ meal: PlannedMealDTO) async {
        guard let plan = response?.plan else { return }
        await update { try await client.markSkipped(plan: plan, meal: meal) }
    }

    func moveTime(_ meal: PlannedMealDTO, plannedTime: String?) async {
        guard let plan = response?.plan else { return }
        await update {
            try await client.updateTime(
                plan: plan,
                meal: meal,
                plannedTime: plannedTime
            )
        }
    }

    func replaceWithOpenMeal(_ meal: PlannedMealDTO, title: String, reason: String?) async {
        guard let plan = response?.plan else { return }
        await update {
            try await client.replaceWithOpenMeal(
                plan: plan,
                meal: meal,
                title: title,
                reason: reason
            )
        }
    }

    func addOpenPlaceholder(
        date: Date,
        timezone: TimeZone = .current,
        mealType: String,
        plannedTime: String?,
        title: String,
        note: String?
    ) async {
        let localFoodDate = Self.localFoodDate(date, timezone: timezone)
        await update {
            try await client.addOpenPlaceholder(
                existing: response,
                localFoodDate: localFoodDate,
                timezone: timezone.identifier,
                mealType: mealType,
                plannedTime: plannedTime,
                title: title,
                note: note
            )
        }
    }

    func copyYesterday(to date: Date, timezone: TimeZone = .current) async {
        guard let source = Calendar.current.date(byAdding: .day, value: -1, to: date) else {
            return
        }
        await update {
            try await client.copyDailyPlan(
                sourceLocalFoodDate: Self.localFoodDate(source, timezone: timezone),
                destinationLocalFoodDate: Self.localFoodDate(date, timezone: timezone),
                timezone: timezone.identifier,
                expectedDestinationVersion: response?.plan.version
            )
        }
    }

    private func update(_ operation: () async throws -> DailyMealPlanResponse) async {
        isLoading = true
        defer { isLoading = false }
        do {
            response = try await operation()
            message = nil
        } catch {
            message = error.localizedDescription
        }
    }

    private static func localFoodDate(_ date: Date, timezone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timezone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

private struct StatusRequest: Encodable {
    let status: String
    let expectedPlanVersion: Int
    let expectedMealVersion: Int
}

private struct MealPlanMutationEnvelope: Decodable {
    let plan: DailyMealPlanDTO
}

private struct ConversionRequest: Encodable {
    let status: String
    let expectedPlanVersion: Int
    let expectedMealVersion: Int
    let actualIngredients: [PlannedIngredientRequest]?
    let idempotencyKey: String?
    let origin: String
}

private struct PlannedIngredientRequest: Encodable {
    let displayName: String
    let quantity: Double
    let unit: String
    let grams: Double?
    let totals: MacroTotals

    init(
        displayName: String,
        quantity: Double,
        unit: String,
        grams: Double?,
        totals: MacroTotals
    ) {
        self.displayName = displayName
        self.quantity = quantity
        self.unit = unit
        self.grams = grams
        self.totals = totals
    }

    init(_ ingredient: PlannedMealIngredientDTO) {
        displayName = ingredient.displayName
        quantity = ingredient.quantity
        unit = ingredient.unit
        grams = ingredient.grams
        totals = ingredient.totals
    }
}

private struct PlannedMealPatchRequest: Encodable {
    let expectedPlanVersion: Int
    let expectedMealVersion: Int
    let patch: PlannedMealPatch
}

private struct PlannedMealPatch: Encodable {
    let plannedTime: String?
}

private struct ReplacePlannedMealRequest: Encodable {
    let expectedPlanVersion: Int
    let expectedMealVersion: Int
    let replacement: PlannedMealRequest
    let reason: String?
    let confirmReplace: Bool
}

private struct UpsertMealPlanRequest: Encodable {
    let localFoodDate: String
    let timezone: String
    let status: String
    let title: String?
    let note: String?
    let meals: [PlannedMealRequest]
    let idempotencyKey: String
    let expectedVersion: Int?
    let confirmReplace: Bool
}

private struct CopyDailyPlanRequest: Encodable {
    let sourceLocalFoodDate: String
    let destinationLocalFoodDate: String
    let timezone: String
    let idempotencyKey: String
    let confirmReplace: Bool
    let expectedDestinationVersion: Int?
}

private struct PlannedMealRequest: Encodable {
    let mealType: String
    let plannedTime: String?
    let title: String
    let description: String
    let instructions: String
    let status: String
    let sortOrder: Int
    let ingredients: [PlannedIngredientRequest]

    init(
        mealType: String,
        plannedTime: String?,
        title: String,
        description: String,
        instructions: String,
        status: String,
        sortOrder: Int,
        ingredients: [PlannedIngredientRequest]
    ) {
        self.mealType = mealType
        self.plannedTime = plannedTime
        self.title = title
        self.description = description
        self.instructions = instructions
        self.status = status
        self.sortOrder = sortOrder
        self.ingredients = ingredients
    }

    init(_ meal: PlannedMealDTO) {
        mealType = meal.mealType
        plannedTime = meal.plannedTime
        title = meal.title
        description = meal.description
        instructions = meal.instructions
        status = meal.status
        sortOrder = meal.sortOrder
        ingredients = meal.ingredients.map(PlannedIngredientRequest.init)
    }
}

private extension DailyMealPlanDTO {
    var plannedTotals: MacroTotals {
        meals.flatMap(\.ingredients).reduce(.zero) { result, ingredient in
            result.adding(ingredient.totals)
        }
    }
}

private extension MacroTotals {
    func scaled(by factor: Double) -> MacroTotals {
        MacroTotals(
            calories: calories * factor,
            proteinGrams: proteinGrams * factor,
            carbsGrams: carbsGrams * factor,
            fatGrams: fatGrams * factor,
            fiberGrams: fiberGrams * factor
        )
    }

    func adding(_ other: MacroTotals) -> MacroTotals {
        MacroTotals(
            calories: calories + other.calories,
            proteinGrams: proteinGrams + other.proteinGrams,
            carbsGrams: carbsGrams + other.carbsGrams,
            fatGrams: fatGrams + other.fatGrams,
            fiberGrams: fiberGrams + other.fiberGrams
        )
    }
}

enum EatingContextChoice: String, Codable, CaseIterable, Identifiable {
    case physicalHunger = "physical_hunger"
    case emotionalEating = "emotional_eating"
    case habit
    case social
    case boredom
    case stress
    case fatigue
    case screenEating = "screen_eating"
    case unknown

    var id: String { rawValue }

    var title: String {
        switch self {
        case .physicalHunger:
            return "Physical hunger"
        case .emotionalEating:
            return "Emotional eating"
        case .habit:
            return "Habit"
        case .social:
            return "Social"
        case .boredom:
            return "Boredom"
        case .stress:
            return "Stress"
        case .fatigue:
            return "Fatigue"
        case .screenEating:
            return "Watching TV"
        case .unknown:
            return "Not sure"
        }
    }

    static func from(title: String) -> EatingContextChoice {
        switch title {
        case "Physical hunger", "Hungry":
            return .physicalHunger
        case "Habit":
            return .habit
        case "Watching TV", "Screen eating":
            return .screenEating
        case "Stress", "Work stress":
            return .stress
        case "Bored", "Boredom":
            return .boredom
        case "Tired", "Poor sleep":
            return .fatigue
        case "Social pressure", "Family meal", "Restaurant":
            return .social
        case "Emotional eating", "Sad", "Frustrated", "Reward-seeking":
            return .emotionalEating
        default:
            return .unknown
        }
    }
}

enum EatingCheckInSyncState: String, Codable, Equatable {
    case pending
    case synced
    case failed
}

struct EatingCheckInRecord: Codable, Equatable, Identifiable {
    var id: String
    var occurredAt: Date
    var timezone: String
    var linkedMealId: String?
    var linkedPlannedMealId: String?
    var hungerBefore: Int?
    var fullnessAfter: Int?
    var urgeIntensity: Int?
    var emotionIntensity: Int?
    var emotions: [String]
    var triggers: [String]
    var automaticThought: String?
    var balancedResponse: String?
    var eatingContext: EatingContextChoice?
    var lossOfControl: Bool
    var ateUntilPain: Bool
    var ateWithScreen: Bool
    var ateFromPackage: Bool
    var tookSecondServing: Bool
    var copingAction: String?
    var urgeDelayMinutes: Int?
    var outcome: String?
    var note: String?
    var idempotencyKey: String?
    var syncState: EatingCheckInSyncState
    var syncError: String?
    var createdAt: Date
    var updatedAt: Date

    var title: String {
        if let urgeIntensity, urgeIntensity >= 7 {
            return "Strong urge"
        }
        if lossOfControl || ateUntilPain {
            return "Recovery note"
        }
        if let hungerBefore {
            return "Hunger \(hungerBefore)/10"
        }
        return "Check-in"
    }

    var summaryText: String {
        var parts: [String] = []
        if let hungerBefore {
            parts.append("Hunger \(hungerBefore)/10")
        }
        if let urgeIntensity {
            parts.append("Urge \(urgeIntensity)/10")
        }
        if let fullnessAfter {
            parts.append("Fullness \(fullnessAfter)/10")
        }
        if let firstEmotion = emotions.first {
            parts.append(firstEmotion)
        }
        if ateWithScreen {
            parts.append("Screen")
        }
        if tookSecondServing {
            parts.append("Second serving")
        }
        if lossOfControl {
            parts.append("Loss of control")
        }

        return parts.isEmpty ? "Quick eating check-in" : parts.joined(separator: " · ")
    }

    var isSynced: Bool {
        syncState == .synced
    }

    static func local(draft: EatingCheckInDraft, id: String, now: Date = Date()) -> EatingCheckInRecord {
        EatingCheckInRecord(
            id: id,
            occurredAt: draft.occurredAt,
            timezone: draft.timezone,
            linkedMealId: draft.linkedMealId,
            linkedPlannedMealId: draft.linkedPlannedMealId,
            hungerBefore: draft.hungerBefore,
            fullnessAfter: draft.fullnessAfter,
            urgeIntensity: draft.urgeIntensity,
            emotionIntensity: draft.emotionIntensity,
            emotions: draft.emotions,
            triggers: draft.triggers,
            automaticThought: draft.automaticThought,
            balancedResponse: draft.balancedResponse,
            eatingContext: draft.eatingContext,
            lossOfControl: draft.lossOfControl,
            ateUntilPain: draft.ateUntilPain,
            ateWithScreen: draft.ateWithScreen,
            ateFromPackage: draft.ateFromPackage,
            tookSecondServing: draft.tookSecondServing,
            copingAction: draft.copingAction,
            urgeDelayMinutes: draft.urgeDelayMinutes,
            outcome: draft.outcome,
            note: draft.note,
            idempotencyKey: draft.idempotencyKey,
            syncState: .pending,
            syncError: nil,
            createdAt: now,
            updatedAt: now
        )
    }

    static func fromDTO(_ dto: EatingCheckInDTO) -> EatingCheckInRecord {
        EatingCheckInRecord(
            id: dto.id,
            occurredAt: EatingCheckInDate.parse(dto.occurredAt),
            timezone: dto.timezone,
            linkedMealId: dto.linkedMealId,
            linkedPlannedMealId: dto.linkedPlannedMealId,
            hungerBefore: dto.hungerBefore,
            fullnessAfter: dto.fullnessAfter,
            urgeIntensity: dto.urgeIntensity,
            emotionIntensity: dto.emotionIntensity,
            emotions: dto.emotions ?? [],
            triggers: dto.triggers ?? [],
            automaticThought: dto.automaticThought,
            balancedResponse: dto.balancedResponse,
            eatingContext: dto.eatingContext.flatMap(EatingContextChoice.init(rawValue:)),
            lossOfControl: dto.lossOfControl ?? false,
            ateUntilPain: dto.ateUntilPain ?? false,
            ateWithScreen: dto.ateWithScreen ?? false,
            ateFromPackage: dto.ateFromPackage ?? false,
            tookSecondServing: dto.tookSecondServing ?? false,
            copingAction: dto.copingAction,
            urgeDelayMinutes: dto.urgeDelayMinutes,
            outcome: dto.outcome,
            note: dto.note,
            idempotencyKey: dto.idempotencyKey,
            syncState: .synced,
            syncError: nil,
            createdAt: EatingCheckInDate.parse(dto.createdAt),
            updatedAt: EatingCheckInDate.parse(dto.updatedAt)
        )
    }

    func retryDraft() -> EatingCheckInDraft {
        EatingCheckInDraft(
            occurredAt: occurredAt,
            timezone: timezone,
            idempotencyKey: idempotencyKey ?? id,
            linkedMealId: linkedMealId,
            linkedPlannedMealId: linkedPlannedMealId,
            hungerBefore: hungerBefore,
            fullnessAfter: fullnessAfter,
            urgeIntensity: urgeIntensity,
            emotionIntensity: emotionIntensity,
            emotions: emotions,
            triggers: triggers,
            automaticThought: automaticThought,
            balancedResponse: balancedResponse,
            eatingContext: eatingContext,
            lossOfControl: lossOfControl,
            ateUntilPain: ateUntilPain,
            ateWithScreen: ateWithScreen,
            ateFromPackage: ateFromPackage,
            tookSecondServing: tookSecondServing,
            copingAction: copingAction,
            urgeDelayMinutes: urgeDelayMinutes,
            outcome: outcome,
            note: note
        )
    }
}

struct EatingCheckInDraft: Equatable {
    var occurredAt: Date = Date()
    var timezone: String = TimeZone.current.identifier
    var idempotencyKey: String?
    var linkedMealId: String?
    var linkedPlannedMealId: String?
    var hungerBefore: Int?
    var fullnessAfter: Int?
    var urgeIntensity: Int?
    var emotionIntensity: Int?
    var emotions: [String] = []
    var triggers: [String] = []
    var automaticThought: String?
    var balancedResponse: String?
    var eatingContext: EatingContextChoice?
    var lossOfControl = false
    var ateUntilPain = false
    var ateWithScreen = false
    var ateFromPackage = false
    var tookSecondServing = false
    var copingAction: String?
    var urgeDelayMinutes: Int?
    var outcome: String?
    var note: String?
}

enum EatingCheckInClientError: LocalizedError {
    case missingSession
    case missingCoachWriteScope
    case missingAccessToken
    case rejected(statusCode: Int, message: String?)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .missingSession:
            return "Sign in with Google in Settings to sync check-ins."
        case .missingCoachWriteScope:
            return "Sign in again to enable coach check-ins."
        case .missingAccessToken:
            return "Check-in authorization is missing. Sign in again."
        case .rejected(let statusCode, let message):
            return "Check-in sync failed (HTTP \(statusCode))\(message.map { ": \($0)" } ?? "")."
        case .invalidResponse:
            return "The server returned an invalid check-in."
        }
    }
}

struct EatingCheckInClient: Sendable {
    private let sessionStore: HealthSyncSessionStore
    private let sessionManager: HealthSyncSessionManager
    private let urlSession: URLSession

    init(
        sessionStore: HealthSyncSessionStore = HealthSyncSessionStore(),
        urlSession: URLSession = .shared
    ) {
        self.sessionStore = sessionStore
        sessionManager = HealthSyncSessionManager(store: sessionStore)
        self.urlSession = urlSession
    }

    func list(from: Date, to: Date, limit: Int = 100) async throws -> [EatingCheckInDTO] {
        let session = try authorizedSession()
        var components = URLComponents(
            url: session.backendURL.appendingPathComponent("api/eating-checkins"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "from", value: EatingCheckInDate.string(from)),
            URLQueryItem(name: "to", value: EatingCheckInDate.string(to)),
            URLQueryItem(name: "limit", value: "\(limit)")
        ]
        guard let url = components?.url else { throw EatingCheckInClientError.invalidResponse }
        let response = try await request(url: url, method: "GET", body: Optional<String>.none)
        return try decode(EatingCheckInListResponse.self, data: response.data, statusCode: response.statusCode).checkIns
    }

    func latest() async throws -> EatingCheckInDTO? {
        let session = try authorizedSession()
        let response = try await request(
            url: session.backendURL.appendingPathComponent("api/eating-checkins/latest"),
            method: "GET",
            body: Optional<String>.none
        )
        return try decode(EatingCheckInLatestResponse.self, data: response.data, statusCode: response.statusCode).checkIn
    }

    func create(_ draft: EatingCheckInDraft) async throws -> EatingCheckInMutationResponse {
        let session = try authorizedSession()
        let response = try await request(
            url: session.backendURL.appendingPathComponent("api/eating-checkins"),
            method: "POST",
            body: EatingCheckInRequest(draft: draft)
        )
        return try decode(EatingCheckInMutationResponse.self, data: response.data, statusCode: response.statusCode)
    }

    private func authorizedSession() throws -> HealthSyncSession {
        guard let session = sessionStore.loadSession() else { throw EatingCheckInClientError.missingSession }
        guard session.scope?.split(separator: " ").contains("coach:write") == true else {
            throw EatingCheckInClientError.missingCoachWriteScope
        }
        return session
    }

    private func request<Body: Encodable>(url: URL, method: String, body: Body?) async throws -> (data: Data, statusCode: Int) {
        guard let token = try await sessionManager.bearerToken(forceRefresh: false) else {
            throw EatingCheckInClientError.missingAccessToken
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await urlSession.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw EatingCheckInClientError.invalidResponse }
        return (data, http.statusCode)
    }

    private func decode<Value: Decodable>(_ type: Value.Type, data: Data, statusCode: Int) throws -> Value {
        guard (200..<300).contains(statusCode) else {
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw EatingCheckInClientError.rejected(
                statusCode: statusCode,
                message: object?["message"] as? String ?? object?["error"] as? String
            )
        }
        guard let value = try? HealthSyncTokenJSON.decoder.decode(type, from: data) else {
            throw EatingCheckInClientError.invalidResponse
        }
        return value
    }
}

@MainActor
final class EatingCheckInStore: ObservableObject {
    static let defaultsKey = "FitnessCoach.EatingCheckIns.v1"
    static let lastSyncedDefaultsKey = "FitnessCoach.EatingCheckIns.LastSyncedAt.v1"

    @Published private(set) var checkIns: [EatingCheckInRecord]
    @Published private(set) var isSyncing = false
    @Published private(set) var message: String?
    @Published private(set) var lastSyncedAt: Date?

    private let defaults: UserDefaults
    private let client: EatingCheckInClient

    init(
        defaults: UserDefaults = .standard,
        client: EatingCheckInClient = EatingCheckInClient()
    ) {
        self.defaults = defaults
        self.client = client
        checkIns = Self.load(defaults: defaults)
        lastSyncedAt = defaults.object(forKey: Self.lastSyncedDefaultsKey) as? Date
    }

    func refresh(days: Int = 14, now: Date = Date()) async {
        guard !isSyncing else {
            return
        }
        isSyncing = true
        defer { isSyncing = false }
        do {
            let calendar = Calendar.current
            let start = calendar.date(byAdding: .day, value: -max(1, days), to: now) ?? now.addingTimeInterval(-14 * 24 * 60 * 60)
            let end = calendar.date(byAdding: .day, value: 1, to: now) ?? now.addingTimeInterval(24 * 60 * 60)
            let remote = try await client.list(from: start, to: end, limit: 250).map(EatingCheckInRecord.fromDTO)
            merge(remote)
            lastSyncedAt = Date()
            defaults.set(lastSyncedAt, forKey: Self.lastSyncedDefaultsKey)
            message = nil
        } catch {
            message = error.localizedDescription
        }
    }

    @discardableResult
    func save(_ draft: EatingCheckInDraft) async -> EatingCheckInRecord {
        var draft = draft
        let key = draft.idempotencyKey ?? "ios-checkin-\(UUID().uuidString)"
        draft.idempotencyKey = key
        let local = EatingCheckInRecord.local(draft: draft, id: key)
        upsert(local)
        do {
            let response = try await client.create(draft)
            var synced = EatingCheckInRecord.fromDTO(response.checkIn)
            synced.syncState = .synced
            replace(localId: local.id, with: synced)
            lastSyncedAt = Date()
            defaults.set(lastSyncedAt, forKey: Self.lastSyncedDefaultsKey)
            message = response.operation == "unchanged" ? "Check-in already synced." : "Check-in synced."
            return synced
        } catch {
            var failed = local
            failed.syncState = .failed
            failed.syncError = error.localizedDescription
            replace(localId: local.id, with: failed)
            message = "Check-in saved locally. \(error.localizedDescription)"
            return failed
        }
    }

    func retryPending() async {
        let pending = checkIns.filter { $0.syncState != .synced }
        guard !pending.isEmpty else {
            return
        }
        for checkIn in pending {
            await save(checkIn.retryDraft())
        }
    }

    func checkIns(on date: Date, calendar: Calendar = .current) -> [EatingCheckInRecord] {
        checkIns
            .filter { calendar.isDate($0.occurredAt, inSameDayAs: date) }
            .sorted { $0.occurredAt < $1.occurredAt }
    }

    func latest(on date: Date, calendar: Calendar = .current) -> EatingCheckInRecord? {
        checkIns(on: date, calendar: calendar).last
    }

    func checkIns(linkedToMeal mealId: UUID) -> [EatingCheckInRecord] {
        let id = mealId.uuidString.lowercased()
        return checkIns.filter { $0.linkedMealId?.lowercased() == id }
    }

    func weeklyInsights(endingAt date: Date = Date(), calendar: Calendar = .current) -> EatingWeeklyInsights {
        let start = calendar.date(byAdding: .day, value: -6, to: calendar.startOfDay(for: date)) ?? date
        let end = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: date)) ?? date
        let week = checkIns.filter { $0.occurredAt >= start && $0.occurredAt < end }
        return EatingWeeklyInsights(checkIns: week)
    }

    private func merge(_ remote: [EatingCheckInRecord]) {
        var byId = Dictionary(uniqueKeysWithValues: checkIns.map { ($0.id, $0) })
        var pending = checkIns.filter { $0.syncState != .synced }
        for record in remote {
            byId[record.id] = record
            if let key = record.idempotencyKey {
                pending.removeAll { $0.idempotencyKey == key || $0.id == key }
            }
        }
        for record in pending {
            byId[record.id] = record
        }
        checkIns = byId.values.sorted { $0.occurredAt > $1.occurredAt }
        persist()
    }

    private func upsert(_ record: EatingCheckInRecord) {
        if let index = checkIns.firstIndex(where: { $0.id == record.id }) {
            checkIns[index] = record
        } else {
            checkIns.append(record)
        }
        checkIns.sort { $0.occurredAt > $1.occurredAt }
        persist()
    }

    private func replace(localId: String, with record: EatingCheckInRecord) {
        checkIns.removeAll { $0.id == localId || ($0.idempotencyKey != nil && $0.idempotencyKey == record.idempotencyKey) }
        checkIns.append(record)
        checkIns.sort { $0.occurredAt > $1.occurredAt }
        persist()
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(checkIns) else {
            return
        }
        defaults.set(data, forKey: Self.defaultsKey)
    }

    private static func load(defaults: UserDefaults) -> [EatingCheckInRecord] {
        guard let data = defaults.data(forKey: defaultsKey) else {
            return []
        }
        return (try? JSONDecoder().decode([EatingCheckInRecord].self, from: data)) ?? []
    }
}

struct EatingWeeklyInsights: Equatable {
    let checkInCount: Int
    let averageHunger: Double?
    let averageFullness: Double?
    let strongUrges: Int
    let urgesDelayed: Int
    let screenEating: Int
    let secondServings: Int
    let ateUntilPain: Int
    let lossOfControl: Int
    let mostCommonTrigger: String?
    let mostCommonTime: String?
    let mostEffectiveCopingAction: String?

    init(checkIns: [EatingCheckInRecord]) {
        checkInCount = checkIns.count
        averageHunger = Self.average(checkIns.compactMap(\.hungerBefore))
        averageFullness = Self.average(checkIns.compactMap(\.fullnessAfter))
        strongUrges = checkIns.filter { ($0.urgeIntensity ?? 0) >= 7 }.count
        urgesDelayed = checkIns.filter { ($0.urgeDelayMinutes ?? 0) > 0 && $0.outcome?.localizedCaseInsensitiveContains("passed") == true }.count
        screenEating = checkIns.filter(\.ateWithScreen).count
        secondServings = checkIns.filter(\.tookSecondServing).count
        ateUntilPain = checkIns.filter(\.ateUntilPain).count
        lossOfControl = checkIns.filter(\.lossOfControl).count
        mostCommonTrigger = Self.mode(checkIns.flatMap(\.triggers))
        mostCommonTime = Self.commonTime(checkIns)
        mostEffectiveCopingAction = Self.mode(
            checkIns
                .filter { $0.outcome?.localizedCaseInsensitiveContains("passed") == true }
                .compactMap(\.copingAction)
        )
    }

    var hasEnoughData: Bool {
        checkInCount >= 3
    }

    private static func average(_ values: [Int]) -> Double? {
        guard !values.isEmpty else {
            return nil
        }
        return Double(values.reduce(0, +)) / Double(values.count)
    }

    private static func mode(_ values: [String]) -> String? {
        let counts = Dictionary(grouping: values.filter { !$0.isEmpty }, by: { $0 })
            .mapValues(\.count)
        return counts.max { lhs, rhs in
            lhs.value == rhs.value ? lhs.key > rhs.key : lhs.value < rhs.value
        }?.key
    }

    private static func commonTime(_ checkIns: [EatingCheckInRecord]) -> String? {
        let calendar = Calendar.current
        let buckets = checkIns.reduce(into: [String: Int]()) { result, checkIn in
            let hour = calendar.component(.hour, from: checkIn.occurredAt)
            let bucket: String
            switch hour {
            case 5..<11:
                bucket = "Morning"
            case 11..<16:
                bucket = "Midday"
            case 16..<20:
                bucket = "Evening"
            default:
                bucket = "Late evening"
            }
            result[bucket, default: 0] += 1
        }
        return buckets.max { lhs, rhs in
            lhs.value == rhs.value ? lhs.key > rhs.key : lhs.value < rhs.value
        }?.key
    }
}

struct EatingCheckInDTO: Codable, Equatable {
    let id: String
    let idempotencyKey: String?
    let occurredAt: String
    let timezone: String
    let linkedMealId: String?
    let linkedPlannedMealId: String?
    let hungerBefore: Int?
    let fullnessAfter: Int?
    let urgeIntensity: Int?
    let emotionIntensity: Int?
    let emotions: [String]?
    let triggers: [String]?
    let automaticThought: String?
    let balancedResponse: String?
    let eatingContext: String?
    let lossOfControl: Bool?
    let ateUntilPain: Bool?
    let ateWithScreen: Bool?
    let ateFromPackage: Bool?
    let tookSecondServing: Bool?
    let copingAction: String?
    let urgeDelayMinutes: Int?
    let outcome: String?
    let note: String?
    let createdAt: String
    let updatedAt: String
}

struct EatingCheckInMutationResponse: Codable, Equatable {
    let checkIn: EatingCheckInDTO
    let operation: String
}

private struct EatingCheckInListResponse: Decodable {
    let checkIns: [EatingCheckInDTO]
}

private struct EatingCheckInLatestResponse: Decodable {
    let checkIn: EatingCheckInDTO?
}

private struct EatingCheckInRequest: Encodable {
    let occurredAt: String
    let timezone: String
    let idempotencyKey: String?
    let linkedMealId: String?
    let linkedPlannedMealId: String?
    let hungerBefore: Int?
    let fullnessAfter: Int?
    let urgeIntensity: Int?
    let emotionIntensity: Int?
    let emotions: [String]
    let triggers: [String]
    let automaticThought: String?
    let balancedResponse: String?
    let eatingContext: String?
    let lossOfControl: Bool
    let ateUntilPain: Bool
    let ateWithScreen: Bool
    let ateFromPackage: Bool
    let tookSecondServing: Bool
    let copingAction: String?
    let urgeDelayMinutes: Int?
    let outcome: String?
    let note: String?

    init(draft: EatingCheckInDraft) {
        occurredAt = EatingCheckInDate.string(draft.occurredAt)
        timezone = draft.timezone
        idempotencyKey = draft.idempotencyKey
        linkedMealId = draft.linkedMealId
        linkedPlannedMealId = draft.linkedPlannedMealId
        hungerBefore = draft.hungerBefore
        fullnessAfter = draft.fullnessAfter
        urgeIntensity = draft.urgeIntensity
        emotionIntensity = draft.emotionIntensity
        emotions = draft.emotions
        triggers = draft.triggers
        automaticThought = draft.automaticThought
        balancedResponse = draft.balancedResponse
        eatingContext = draft.eatingContext?.rawValue
        lossOfControl = draft.lossOfControl
        ateUntilPain = draft.ateUntilPain
        ateWithScreen = draft.ateWithScreen
        ateFromPackage = draft.ateFromPackage
        tookSecondServing = draft.tookSecondServing
        copingAction = draft.copingAction
        urgeDelayMinutes = draft.urgeDelayMinutes
        outcome = draft.outcome
        note = draft.note
    }
}

enum EatingCheckInDate {
    static func string(_ date: Date) -> String {
        fractionalFormatter.string(from: date)
    }

    static func parse(_ text: String) -> Date {
        fractionalFormatter.date(from: text) ?? plainFormatter.date(from: text) ?? Date()
    }

    private static var fractionalFormatter: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }

    private static var plainFormatter: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }
}
