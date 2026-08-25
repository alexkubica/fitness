import Foundation

struct MealEstimateRequest: Encodable, Equatable {
    let mealType: String
    let description: String
    let note: String?
    let photos: [MealEstimatePhotoRequest]
}

struct MealEstimatePhotoRequest: Encodable, Equatable {
    let mediaType: String
    let base64: String
}

struct MealEstimateResponse: Decodable, Equatable {
    let totals: MacroTotals
    let ingredients: [MealEstimateIngredientResponse]
    let confidence: Double
    let summary: String
    let provider: String
    let model: String

    enum CodingKeys: String, CodingKey {
        case totals
        case ingredients
        case confidence
        case summary
        case provider
        case model
    }

    init(
        totals: MacroTotals,
        ingredients: [MealEstimateIngredientResponse] = [],
        confidence: Double,
        summary: String,
        provider: String,
        model: String
    ) {
        self.totals = totals
        self.ingredients = ingredients
        self.confidence = confidence
        self.summary = summary
        self.provider = provider
        self.model = model
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        totals = try container.decode(MacroTotals.self, forKey: .totals)
        ingredients = try container.decodeIfPresent(
            [MealEstimateIngredientResponse].self,
            forKey: .ingredients
        ) ?? []
        confidence = try container.decode(Double.self, forKey: .confidence)
        summary = try container.decode(String.self, forKey: .summary)
        provider = try container.decode(String.self, forKey: .provider)
        model = try container.decode(String.self, forKey: .model)
    }
}

struct MealEstimateIngredientResponse: Decodable, Equatable {
    let name: String
    let quantity: Double
    let unit: String
    let grams: Double?
    let totals: MacroTotals

    func mealIngredientEntry() -> MealIngredientEntry {
        MealIngredientEntry(
            name: name,
            quantity: quantity,
            unit: unit,
            baseQuantity: quantity,
            baseUnit: unit,
            baseGrams: grams,
            baseTotals: totals
        )
    }
}

enum MealEstimateClientError: LocalizedError, Equatable {
    case missingSession
    case missingMealWriteScope
    case missingAccessToken
    case rejected(statusCode: Int?, message: String?)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .missingSession:
            return "Sign in with Google in Settings to estimate meals."
        case .missingMealWriteScope:
            return "Sign in with Google again in Settings to enable meal estimates."
        case .missingAccessToken:
            return "Meal estimate authorization is missing. Sign in with Google again."
        case .rejected(let statusCode, let message):
            let statusText = statusCode.map { "HTTP \($0)" } ?? "non-HTTP response"
            let messageText = message.map { ": \($0)" } ?? ""

            return "Backend rejected the meal estimate (\(statusText)\(messageText))."
        case .invalidResponse:
            return "Backend returned an invalid meal estimate."
        }
    }

    var needsSignIn: Bool {
        switch self {
        case .missingSession, .missingMealWriteScope, .missingAccessToken:
            return true
        case .rejected, .invalidResponse:
            return false
        }
    }
}

protocol MealEstimateTransport: Sendable {
    func estimate(
        backendURL: URL,
        bearerToken: String,
        request: MealEstimateRequest
    ) async throws -> MealEstimateResponse
}

struct MealEstimateClient: Sendable {
    private let sessionStore: HealthSyncSessionStore
    private let sessionManager: HealthSyncSessionManager
    private let transport: any MealEstimateTransport

    init(
        sessionStore: HealthSyncSessionStore = HealthSyncSessionStore(),
        transport: any MealEstimateTransport = URLSessionMealEstimateTransport()
    ) {
        self.sessionStore = sessionStore
        self.sessionManager = HealthSyncSessionManager(store: sessionStore)
        self.transport = transport
    }

    func estimate(
        mealType: String,
        description: String,
        note: String,
        photoData: [Data]
    ) async throws -> MealEstimateResponse {
        guard let session = sessionStore.loadSession() else {
            throw MealEstimateClientError.missingSession
        }

        guard hasScope("meal:write", in: session.scope) else {
            throw MealEstimateClientError.missingMealWriteScope
        }

        guard let bearerToken = try await sessionManager.bearerToken(forceRefresh: false) else {
            throw MealEstimateClientError.missingAccessToken
        }

        guard hasScope("meal:write", in: sessionStore.loadSession()?.scope) else {
            throw MealEstimateClientError.missingMealWriteScope
        }

        return try await transport.estimate(
            backendURL: session.backendURL,
            bearerToken: bearerToken,
            request: MealEstimateRequest(
                mealType: mealType,
                description: description,
                note: note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : note,
                photos: photoData.prefix(6).map { data in
                    MealEstimatePhotoRequest(
                        mediaType: "image/jpeg",
                        base64: data.base64EncodedString()
                    )
                }
            )
        )
    }

    private func hasScope(_ scope: String, in scopeText: String?) -> Bool {
        scopeText?.split(separator: " ").contains { $0 == scope } == true
    }
}

struct URLSessionMealEstimateTransport: MealEstimateTransport, Sendable {
    func estimate(
        backendURL: URL,
        bearerToken: String,
        request: MealEstimateRequest
    ) async throws -> MealEstimateResponse {
        let requestURL = backendURL.appendingPathComponent("api/meals/estimate")
        var urlRequest = URLRequest(url: requestURL)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "content-type")
        urlRequest.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "authorization")
        urlRequest.httpBody = try JSONEncoder().encode(request)

        let (data, response) = try await URLSession.shared.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            throw MealEstimateClientError.rejected(
                statusCode: (response as? HTTPURLResponse)?.statusCode,
                message: rejectionMessage(from: data)
            )
        }

        do {
            return try HealthSyncTokenJSON.decoder.decode(MealEstimateResponse.self, from: data)
        } catch {
            throw MealEstimateClientError.invalidResponse
        }
    }

    private func rejectionMessage(from data: Data) -> String? {
        guard !data.isEmpty else {
            return nil
        }

        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let message = json["message"] as? String {
                return message
            }

            if let error = json["error"] as? String {
                return error
            }
        }

        return String(data: data, encoding: .utf8)
    }
}

struct MealPersistenceIngredientRequest: Encodable, Equatable {
    let clientIngredientId: String
    let name: String
    let quantity: Double
    let unit: String
    let grams: Double?
    let totals: MacroTotals
}

struct MealPersistenceMealRequest: Encodable, Equatable {
    let clientMealId: String
    let occurredAt: String
    let timezone: String
    let title: String
    let mealType: String
    let note: String
    let totals: MacroTotals
    let ingredients: [MealPersistenceIngredientRequest]
    let photoCount: Int
    let estimateStatus: String
    let estimateConfidence: Double?
    let estimateSummary: String?
}

struct MealPersistenceTemplateRequest: Encodable, Equatable {
    let clientTemplateId: String
    let title: String
    let mealType: String
    let note: String
    let totals: MacroTotals
    let ingredients: [MealPersistenceIngredientRequest]
    let usageCount: Int
    let lastUsedAt: String
}

private struct MealPersistenceMealResponse: Decodable {
    let meal: RemoteMealLog
}

private struct MealPersistenceMealsResponse: Decodable {
    let meals: [RemoteMealLog]
}

private struct MealPersistenceTemplateResponse: Decodable {
    let template: RemoteSavedMealTemplate
}

private struct MealPersistenceTemplatesResponse: Decodable {
    let templates: [RemoteSavedMealTemplate]
}

struct RemoteMealLog: Decodable, Equatable {
    let id: String
    let clientMealId: String?
    let occurredAt: String
    let timezone: String
    let title: String
    let mealType: String
    let note: String
    let totals: MacroTotals
    let ingredients: [RemoteMealIngredient]
    let photoCount: Int
    let estimateStatus: String
    let estimateConfidence: Double?
    let estimateSummary: String?
    let createdAt: String

    func mealLogEntry() -> MealLogEntry? {
        guard let loggedAt = MealPersistenceDate.isoDate(occurredAt),
              let createdDate = MealPersistenceDate.isoDate(createdAt) else {
            return nil
        }
        let stableId = UUID(uuidString: clientMealId ?? "") ??
            UUID(uuidString: id) ??
            deterministicUUID(from: id)

        return MealLogEntry(
            id: stableId,
            loggedAt: loggedAt,
            mealType: mealType,
            title: title,
            note: note,
            totals: totals,
            ingredients: ingredients.map { $0.mealIngredientEntry() },
            photoAttachments: [],
            estimateStatus: MealEstimateStatus(apiValue: estimateStatus),
            estimateConfidence: estimateConfidence,
            createdAt: createdDate
        )
    }

    private func deterministicUUID(from value: String) -> UUID {
        var hash: UInt64 = 0xcbf29ce484222325

        for byte in value.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x100000001b3
        }

        let partA = UInt32(truncatingIfNeeded: hash >> 32)
        let partB = UInt16(truncatingIfNeeded: hash >> 16)
        let partC = UInt16(truncatingIfNeeded: (hash & 0x0fff) | 0x4000)
        let partD = UInt16(truncatingIfNeeded: ((hash >> 48) & 0x3fff) | 0x8000)
        let partE = UInt64(truncatingIfNeeded: hash) & 0x0000ffffffffffff
        let uuidString = String(
            format: "%08x-%04x-%04x-%04x-%012llx",
            partA,
            partB,
            partC,
            partD,
            partE
        )

        return UUID(uuidString: uuidString) ?? UUID()
    }
}

struct RemoteMealIngredient: Decodable, Equatable {
    let id: String?
    let clientIngredientId: String?
    let name: String
    let quantity: Double
    let unit: String
    let grams: Double?
    let totals: MacroTotals

    func mealIngredientEntry() -> MealIngredientEntry {
        MealIngredientEntry(
            id: UUID(uuidString: clientIngredientId ?? id ?? "") ?? UUID(),
            name: name,
            quantity: quantity,
            unit: unit,
            baseQuantity: max(0.1, quantity),
            baseUnit: unit,
            baseGrams: grams,
            baseTotals: totals
        )
    }
}

struct RemoteSavedMealTemplate: Decodable, Equatable {
    let id: String
    let clientTemplateId: String
    let title: String
    let mealType: String
    let note: String
    let totals: MacroTotals
    let ingredients: [RemoteMealIngredient]
    let usageCount: Int
    let lastUsedAt: String
    let createdAt: String

    func savedMealTemplate() -> SavedMealTemplate? {
        guard let templateId = UUID(uuidString: clientTemplateId),
              let createdDate = MealPersistenceDate.isoDate(createdAt),
              let lastUsedDate = MealPersistenceDate.isoDate(lastUsedAt) else {
            return nil
        }

        return SavedMealTemplate(
            id: templateId,
            title: title,
            mealType: mealType,
            note: note,
            totals: totals,
            ingredients: ingredients.map { $0.mealIngredientEntry() },
            createdAt: createdDate,
            lastUsedAt: lastUsedDate,
            usageCount: usageCount
        )
    }
}

enum MealPersistenceClientError: LocalizedError, Equatable {
    case missingSession
    case missingMealWriteScope
    case missingAccessToken
    case rejected(statusCode: Int?, message: String?)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .missingSession:
            return "Sign in with Google in Settings to sync meals."
        case .missingMealWriteScope:
            return "Sign in with Google again in Settings to enable meal sync."
        case .missingAccessToken:
            return "Meal sync authorization is missing. Sign in with Google again."
        case .rejected(let statusCode, let message):
            let statusText = statusCode.map { "HTTP \($0)" } ?? "non-HTTP response"
            let messageText = message.map { ": \($0)" } ?? ""

            return "Backend rejected meal sync (\(statusText)\(messageText))."
        case .invalidResponse:
            return "Backend returned invalid meal sync data."
        }
    }
}

protocol MealPersistenceTransport: Sendable {
    func upsertMeal(
        backendURL: URL,
        bearerToken: String,
        request: MealPersistenceMealRequest
    ) async throws -> RemoteMealLog

    func deleteMeal(
        backendURL: URL,
        bearerToken: String,
        mealId: UUID
    ) async throws

    func listMeals(
        backendURL: URL,
        bearerToken: String,
        from: Date,
        to: Date
    ) async throws -> [RemoteMealLog]

    func listMeals(
        backendURL: URL,
        bearerToken: String,
        localDate: String,
        timezone: String
    ) async throws -> [RemoteMealLog]

    func upsertTemplate(
        backendURL: URL,
        bearerToken: String,
        request: MealPersistenceTemplateRequest
    ) async throws -> RemoteSavedMealTemplate

    func listTemplates(
        backendURL: URL,
        bearerToken: String
    ) async throws -> [RemoteSavedMealTemplate]
}

struct MealPersistenceClient: Sendable {
    private let sessionStore: HealthSyncSessionStore
    private let sessionManager: HealthSyncSessionManager
    private let transport: any MealPersistenceTransport

    init(
        sessionStore: HealthSyncSessionStore = HealthSyncSessionStore(),
        transport: any MealPersistenceTransport = URLSessionMealPersistenceTransport()
    ) {
        self.sessionStore = sessionStore
        self.sessionManager = HealthSyncSessionManager(store: sessionStore)
        self.transport = transport
    }

    func upsertMeal(_ meal: MealLogEntry) async throws {
        let auth = try await mealWriteAuth()
        _ = try await transport.upsertMeal(
            backendURL: auth.backendURL,
            bearerToken: auth.bearerToken,
            request: meal.persistenceRequest()
        )
    }

    func deleteMeal(_ meal: MealLogEntry) async throws {
        try await deleteMeal(id: meal.id)
    }

    func deleteMeal(id mealId: UUID) async throws {
        let auth = try await mealWriteAuth()
        try await transport.deleteMeal(
            backendURL: auth.backendURL,
            bearerToken: auth.bearerToken,
            mealId: mealId
        )
    }

    func listRecentMeals(days: Int = 30) async throws -> [MealLogEntry] {
        let auth = try await mealWriteAuth()
        let to = Date()
        let from = Calendar.current.date(
            byAdding: .day,
            value: -max(1, days),
            to: to
        ) ?? to.addingTimeInterval(-30 * 24 * 60 * 60)

        return try await transport.listMeals(
            backendURL: auth.backendURL,
            bearerToken: auth.bearerToken,
            from: from,
            to: to
        ).compactMap { $0.mealLogEntry() }
    }

    func listMeals(
        on day: Date,
        calendar: Calendar = .current,
        timezone: TimeZone = .current
    ) async throws -> [MealLogEntry] {
        let auth = try await mealWriteAuth()
        let localDate = MealPersistenceDate.localDateString(
            day,
            calendar: calendar
        )
        let timezoneIdentifier = timezone.identifier.isEmpty
            ? "Asia/Jerusalem"
            : timezone.identifier

        return try await transport.listMeals(
            backendURL: auth.backendURL,
            bearerToken: auth.bearerToken,
            localDate: localDate,
            timezone: timezoneIdentifier
        ).compactMap { $0.mealLogEntry() }
    }

    func listMeals(from: Date, to: Date) async throws -> [MealLogEntry] {
        let auth = try await mealWriteAuth()

        return try await transport.listMeals(
            backendURL: auth.backendURL,
            bearerToken: auth.bearerToken,
            from: from,
            to: to
        ).compactMap { $0.mealLogEntry() }
    }

    func upsertTemplate(_ template: SavedMealTemplate) async throws {
        let auth = try await mealWriteAuth()
        _ = try await transport.upsertTemplate(
            backendURL: auth.backendURL,
            bearerToken: auth.bearerToken,
            request: template.persistenceRequest()
        )
    }

    func listTemplates() async throws -> [SavedMealTemplate] {
        let auth = try await mealWriteAuth()

        return try await transport.listTemplates(
            backendURL: auth.backendURL,
            bearerToken: auth.bearerToken
        ).compactMap { $0.savedMealTemplate() }
    }

    private func mealWriteAuth() async throws -> (backendURL: URL, bearerToken: String) {
        guard let session = sessionStore.loadSession() else {
            throw MealPersistenceClientError.missingSession
        }

        guard hasScope("meal:write", in: session.scope) else {
            throw MealPersistenceClientError.missingMealWriteScope
        }

        guard let bearerToken = try await sessionManager.bearerToken(forceRefresh: false) else {
            throw MealPersistenceClientError.missingAccessToken
        }

        guard hasScope("meal:write", in: sessionStore.loadSession()?.scope) else {
            throw MealPersistenceClientError.missingMealWriteScope
        }

        return (session.backendURL, bearerToken)
    }

    private func hasScope(_ scope: String, in scopeText: String?) -> Bool {
        scopeText?.split(separator: " ").contains { $0 == scope } == true
    }
}

struct URLSessionMealPersistenceTransport: MealPersistenceTransport, Sendable {
    func upsertMeal(
        backendURL: URL,
        bearerToken: String,
        request: MealPersistenceMealRequest
    ) async throws -> RemoteMealLog {
        let data = try await sendJSONRequest(
            backendURL: backendURL,
            bearerToken: bearerToken,
            path: "api/meals/logs",
            method: "POST",
            body: request
        )

        do {
            return try HealthSyncTokenJSON.decoder.decode(
                MealPersistenceMealResponse.self,
                from: data
            ).meal
        } catch {
            throw MealPersistenceClientError.invalidResponse
        }
    }

    func deleteMeal(
        backendURL: URL,
        bearerToken: String,
        mealId: UUID
    ) async throws {
        _ = try await sendRequest(
            backendURL: backendURL,
            bearerToken: bearerToken,
            path: "api/meals/logs/\(mealId.uuidString)",
            method: "DELETE"
        )
    }

    func listMeals(
        backendURL: URL,
        bearerToken: String,
        from: Date,
        to: Date
    ) async throws -> [RemoteMealLog] {
        let query = "from=\(MealPersistenceDate.escape(MealPersistenceDate.isoString(from)))&to=\(MealPersistenceDate.escape(MealPersistenceDate.isoString(to)))&limit=120"
        let data = try await sendRequest(
            backendURL: backendURL,
            bearerToken: bearerToken,
            path: "api/meals/logs?\(query)",
            method: "GET"
        )

        do {
            return try HealthSyncTokenJSON.decoder.decode(
                MealPersistenceMealsResponse.self,
                from: data
            ).meals
        } catch {
            throw MealPersistenceClientError.invalidResponse
        }
    }

    func listMeals(
        backendURL: URL,
        bearerToken: String,
        localDate: String,
        timezone: String
    ) async throws -> [RemoteMealLog] {
        let query = "date=\(MealPersistenceDate.escape(localDate))&timezone=\(MealPersistenceDate.escape(timezone))&limit=120"
        let data = try await sendRequest(
            backendURL: backendURL,
            bearerToken: bearerToken,
            path: "api/meals/logs?\(query)",
            method: "GET"
        )

        do {
            return try HealthSyncTokenJSON.decoder.decode(
                MealPersistenceMealsResponse.self,
                from: data
            ).meals
        } catch {
            throw MealPersistenceClientError.invalidResponse
        }
    }

    func upsertTemplate(
        backendURL: URL,
        bearerToken: String,
        request: MealPersistenceTemplateRequest
    ) async throws -> RemoteSavedMealTemplate {
        let data = try await sendJSONRequest(
            backendURL: backendURL,
            bearerToken: bearerToken,
            path: "api/meals/templates",
            method: "POST",
            body: request
        )

        do {
            return try HealthSyncTokenJSON.decoder.decode(
                MealPersistenceTemplateResponse.self,
                from: data
            ).template
        } catch {
            throw MealPersistenceClientError.invalidResponse
        }
    }

    func listTemplates(
        backendURL: URL,
        bearerToken: String
    ) async throws -> [RemoteSavedMealTemplate] {
        let data = try await sendRequest(
            backendURL: backendURL,
            bearerToken: bearerToken,
            path: "api/meals/templates?limit=30",
            method: "GET"
        )

        do {
            return try HealthSyncTokenJSON.decoder.decode(
                MealPersistenceTemplatesResponse.self,
                from: data
            ).templates
        } catch {
            throw MealPersistenceClientError.invalidResponse
        }
    }

    private func sendJSONRequest<Body: Encodable>(
        backendURL: URL,
        bearerToken: String,
        path: String,
        method: String,
        body: Body
    ) async throws -> Data {
        var request = URLRequest(url: endpointURL(backendURL: backendURL, path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(body)

        return try await send(request, bearerToken: bearerToken)
    }

    private func sendRequest(
        backendURL: URL,
        bearerToken: String,
        path: String,
        method: String
    ) async throws -> Data {
        var request = URLRequest(url: endpointURL(backendURL: backendURL, path: path))
        request.httpMethod = method

        return try await send(request, bearerToken: bearerToken)
    }

    private func send(
        _ request: URLRequest,
        bearerToken: String
    ) async throws -> Data {
        var request = request
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            throw MealPersistenceClientError.rejected(
                statusCode: (response as? HTTPURLResponse)?.statusCode,
                message: rejectionMessage(from: data)
            )
        }

        return data
    }

    private func rejectionMessage(from data: Data) -> String? {
        guard !data.isEmpty else {
            return nil
        }

        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let message = json["message"] as? String {
                return message
            }

            if let error = json["error"] as? String {
                return error
            }
        }

        return String(data: data, encoding: .utf8)
    }

    private func endpointURL(backendURL: URL, path: String) -> URL {
        URL(string: path, relativeTo: backendURL)?.absoluteURL ??
            backendURL.appendingPathComponent(path)
    }
}

enum MealPersistenceDate {
    static func localDateString(_ date: Date, calendar: Calendar = .current) -> String {
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        let year = components.year ?? 1970
        let month = components.month ?? 1
        let day = components.day ?? 1

        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    static func isoString(_ date: Date) -> String {
        isoFormatter().string(from: date)
    }

    static func isoDate(_ value: String) -> Date? {
        isoFormatter().date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    static func escape(_ value: String) -> String {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: ":#[]@!$&'()*+,;=")

        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    private static func isoFormatter() -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }
}

struct CoachProfilePersistenceRequest: Encodable, Equatable {
    let goal: String
    let weightKg: Double
    let estimatedStepsPerDay: Int
    let estimatedActiveCaloriesPerDay: Double?
    let estimatedRestingCaloriesPerDay: Double?
    let wakeTimeMinutes: Int
    let sleepTimeMinutes: Int
    let mealRemindersEnabled: Bool
    let mealSlots: [CoachProfileMealSlotRequest]
    let completedAt: String
    let source: String
}

struct CoachProfileMealSlotRequest: Encodable, Equatable {
    let id: String
    let name: String
    let timeMinutes: Int
    let remindersEnabled: Bool
}

private struct CoachProfilePersistenceResponse: Decodable {
    let profile: RemoteCoachProfile?
}

struct RemoteCoachProfile: Decodable, Equatable {
    let goal: String
    let weightKg: Double
    let estimatedStepsPerDay: Int
    let estimatedActiveCaloriesPerDay: Double?
    let estimatedRestingCaloriesPerDay: Double?
    let wakeTimeMinutes: Int
    let sleepTimeMinutes: Int
    let mealRemindersEnabled: Bool
    let mealSlots: [RemoteCoachMealSlot]
    let completedAt: String
    let updatedAt: String

    func coachProfile() -> CoachProfile? {
        guard let goal = CoachGoal(apiValue: goal),
              let completedDate = MealPersistenceDate.isoDate(completedAt) else {
            return nil
        }

        return CoachProfile(
            goal: goal,
            weightKg: weightKg,
            estimatedStepsPerDay: estimatedStepsPerDay,
            estimatedActiveCaloriesPerDay: estimatedActiveCaloriesPerDay,
            estimatedRestingCaloriesPerDay: estimatedRestingCaloriesPerDay,
            wakeTimeMinutes: wakeTimeMinutes,
            sleepTimeMinutes: sleepTimeMinutes,
            breakfastTimeMinutes: mealSlots.first { $0.name.caseInsensitiveCompare("Breakfast") == .orderedSame }?.timeMinutes ?? 9 * 60,
            lunchTimeMinutes: mealSlots.first { $0.name.caseInsensitiveCompare("Lunch") == .orderedSame }?.timeMinutes ?? 13 * 60,
            snackTimeMinutes: mealSlots.first { $0.name.caseInsensitiveCompare("Snack") == .orderedSame }?.timeMinutes ?? 16 * 60 + 30,
            dinnerTimeMinutes: mealSlots.first { $0.name.caseInsensitiveCompare("Dinner") == .orderedSame }?.timeMinutes ?? 20 * 60,
            mealRemindersEnabled: mealRemindersEnabled,
            mealSlots: mealSlots.map { $0.coachMealSlot() },
            completedAt: completedDate
        )
    }

    var updatedDate: Date? {
        MealPersistenceDate.isoDate(updatedAt)
    }
}

struct RemoteCoachMealSlot: Decodable, Equatable {
    let id: String
    let name: String
    let timeMinutes: Int
    let remindersEnabled: Bool

    func coachMealSlot() -> CoachMealSlot {
        CoachMealSlot(
            id: UUID(uuidString: id) ?? fallbackId(for: name),
            name: name,
            timeMinutes: timeMinutes,
            remindersEnabled: remindersEnabled
        )
    }

    private func fallbackId(for name: String) -> UUID {
        switch name.lowercased() {
        case "breakfast":
            return CoachMealSlot.breakfastId
        case "lunch":
            return CoachMealSlot.lunchId
        case "snack":
            return CoachMealSlot.snackId
        case "dinner":
            return CoachMealSlot.dinnerId
        default:
            return UUID(uuidString: "10000000-0000-0000-0000-000000000099")!
        }
    }
}

enum CoachProfilePersistenceClientError: LocalizedError, Equatable {
    case missingSession
    case missingCoachWriteScope
    case missingAccessToken
    case rejected(statusCode: Int?, message: String?)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .missingSession:
            return "Sign in with Google in Settings to sync your coach profile."
        case .missingCoachWriteScope:
            return "Sign in with Google again in Settings to enable coach profile sync."
        case .missingAccessToken:
            return "Coach profile authorization is missing. Sign in with Google again."
        case .rejected(let statusCode, let message):
            let statusText = statusCode.map { "HTTP \($0)" } ?? "non-HTTP response"
            let messageText = message.map { ": \($0)" } ?? ""

            return "Backend rejected coach profile sync (\(statusText)\(messageText))."
        case .invalidResponse:
            return "Backend returned invalid coach profile data."
        }
    }
}

protocol CoachProfilePersistenceTransport: Sendable {
    func upsertProfile(
        backendURL: URL,
        bearerToken: String,
        request: CoachProfilePersistenceRequest
    ) async throws -> RemoteCoachProfile

    func getProfile(
        backendURL: URL,
        bearerToken: String
    ) async throws -> RemoteCoachProfile?
}

struct CoachProfilePersistenceClient: Sendable {
    private let sessionStore: HealthSyncSessionStore
    private let sessionManager: HealthSyncSessionManager
    private let transport: any CoachProfilePersistenceTransport

    init(
        sessionStore: HealthSyncSessionStore = HealthSyncSessionStore(),
        transport: any CoachProfilePersistenceTransport = URLSessionCoachProfilePersistenceTransport()
    ) {
        self.sessionStore = sessionStore
        self.sessionManager = HealthSyncSessionManager(store: sessionStore)
        self.transport = transport
    }

    func upsertProfile(_ profile: CoachProfile) async throws -> RemoteCoachProfile {
        let auth = try await coachWriteAuth()

        return try await transport.upsertProfile(
            backendURL: auth.backendURL,
            bearerToken: auth.bearerToken,
            request: profile.persistenceRequest()
        )
    }

    func getProfile() async throws -> RemoteCoachProfile? {
        let auth = try await coachWriteAuth()

        return try await transport.getProfile(
            backendURL: auth.backendURL,
            bearerToken: auth.bearerToken
        )
    }

    private func coachWriteAuth() async throws -> (backendURL: URL, bearerToken: String) {
        guard let session = sessionStore.loadSession() else {
            throw CoachProfilePersistenceClientError.missingSession
        }

        guard hasScope("coach:write", in: session.scope) else {
            throw CoachProfilePersistenceClientError.missingCoachWriteScope
        }

        guard let bearerToken = try await sessionManager.bearerToken(forceRefresh: false) else {
            throw CoachProfilePersistenceClientError.missingAccessToken
        }

        guard hasScope("coach:write", in: sessionStore.loadSession()?.scope) else {
            throw CoachProfilePersistenceClientError.missingCoachWriteScope
        }

        return (session.backendURL, bearerToken)
    }

    private func hasScope(_ scope: String, in scopeText: String?) -> Bool {
        scopeText?.split(separator: " ").contains { $0 == scope } == true
    }
}

struct URLSessionCoachProfilePersistenceTransport: CoachProfilePersistenceTransport, Sendable {
    func upsertProfile(
        backendURL: URL,
        bearerToken: String,
        request: CoachProfilePersistenceRequest
    ) async throws -> RemoteCoachProfile {
        let data = try await sendJSONRequest(
            backendURL: backendURL,
            bearerToken: bearerToken,
            path: "api/coach/profile",
            method: "PUT",
            body: request
        )

        do {
            guard let profile = try HealthSyncTokenJSON.decoder.decode(
                CoachProfilePersistenceResponse.self,
                from: data
            ).profile else {
                throw CoachProfilePersistenceClientError.invalidResponse
            }

            return profile
        } catch let error as CoachProfilePersistenceClientError {
            throw error
        } catch {
            throw CoachProfilePersistenceClientError.invalidResponse
        }
    }

    func getProfile(
        backendURL: URL,
        bearerToken: String
    ) async throws -> RemoteCoachProfile? {
        let data = try await sendRequest(
            backendURL: backendURL,
            bearerToken: bearerToken,
            path: "api/coach/profile",
            method: "GET"
        )

        do {
            return try HealthSyncTokenJSON.decoder.decode(
                CoachProfilePersistenceResponse.self,
                from: data
            ).profile
        } catch {
            throw CoachProfilePersistenceClientError.invalidResponse
        }
    }

    private func sendJSONRequest<Body: Encodable>(
        backendURL: URL,
        bearerToken: String,
        path: String,
        method: String,
        body: Body
    ) async throws -> Data {
        var request = URLRequest(url: endpointURL(backendURL: backendURL, path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(body)

        return try await send(request, bearerToken: bearerToken)
    }

    private func sendRequest(
        backendURL: URL,
        bearerToken: String,
        path: String,
        method: String
    ) async throws -> Data {
        var request = URLRequest(url: endpointURL(backendURL: backendURL, path: path))
        request.httpMethod = method

        return try await send(request, bearerToken: bearerToken)
    }

    private func send(
        _ request: URLRequest,
        bearerToken: String
    ) async throws -> Data {
        var request = request
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            throw CoachProfilePersistenceClientError.rejected(
                statusCode: (response as? HTTPURLResponse)?.statusCode,
                message: rejectionMessage(from: data)
            )
        }

        return data
    }

    private func rejectionMessage(from data: Data) -> String? {
        guard !data.isEmpty else {
            return nil
        }

        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let message = json["message"] as? String {
                return message
            }

            if let error = json["error"] as? String {
                return error
            }
        }

        return String(data: data, encoding: .utf8)
    }

    private func endpointURL(backendURL: URL, path: String) -> URL {
        URL(string: path, relativeTo: backendURL)?.absoluteURL ??
            backendURL.appendingPathComponent(path)
    }
}

private extension CoachProfile {
    func persistenceRequest() -> CoachProfilePersistenceRequest {
        CoachProfilePersistenceRequest(
            goal: goal.apiValue,
            weightKg: weightKg,
            estimatedStepsPerDay: estimatedStepsPerDay,
            estimatedActiveCaloriesPerDay: estimatedActiveCaloriesPerDay,
            estimatedRestingCaloriesPerDay: estimatedRestingCaloriesPerDay,
            wakeTimeMinutes: wakeTimeMinutes,
            sleepTimeMinutes: sleepTimeMinutes,
            mealRemindersEnabled: mealRemindersEnabled,
            mealSlots: effectiveMealSlots.map { $0.persistenceRequest() },
            completedAt: MealPersistenceDate.isoString(completedAt),
            source: "ios"
        )
    }
}

private extension CoachMealSlot {
    func persistenceRequest() -> CoachProfileMealSlotRequest {
        CoachProfileMealSlotRequest(
            id: id.uuidString,
            name: displayName,
            timeMinutes: timeMinutes,
            remindersEnabled: remindersEnabled
        )
    }
}

private extension CoachGoal {
    var apiValue: String {
        switch self {
        case .loseWeight:
            return "lose_weight"
        case .maintain:
            return "maintain"
        case .gainMass:
            return "gain_mass"
        }
    }

    init?(apiValue: String) {
        switch apiValue {
        case "lose_weight", "loseWeight":
            self = .loseWeight
        case "maintain":
            self = .maintain
        case "gain_mass", "gainMass":
            self = .gainMass
        default:
            return nil
        }
    }
}

private extension MealLogEntry {
    func persistenceRequest() -> MealPersistenceMealRequest {
        MealPersistenceMealRequest(
            clientMealId: id.uuidString,
            occurredAt: MealPersistenceDate.isoString(loggedAt),
            timezone: TimeZone.current.identifier,
            title: title,
            mealType: mealType,
            note: note,
            totals: totals,
            ingredients: ingredients.map { $0.persistenceRequest() },
            photoCount: photoAttachments.count,
            estimateStatus: estimateStatus.apiValue,
            estimateConfidence: estimateConfidence,
            estimateSummary: nil
        )
    }
}

private extension MealIngredientEntry {
    func persistenceRequest() -> MealPersistenceIngredientRequest {
        MealPersistenceIngredientRequest(
            clientIngredientId: id.uuidString,
            name: name,
            quantity: quantity,
            unit: unit,
            grams: unit == "g" ? quantity : nil,
            totals: totals
        )
    }
}

private extension SavedMealTemplate {
    func persistenceRequest() -> MealPersistenceTemplateRequest {
        MealPersistenceTemplateRequest(
            clientTemplateId: id.uuidString,
            title: title,
            mealType: mealType,
            note: note,
            totals: totals,
            ingredients: ingredients.map { $0.persistenceRequest() },
            usageCount: usageCount,
            lastUsedAt: MealPersistenceDate.isoString(lastUsedAt)
        )
    }
}

private extension MealEstimateStatus {
    var apiValue: String {
        switch self {
        case .manual:
            return "manual"
        case .aiEstimated:
            return "ai_estimated"
        case .estimationFailed:
            return "estimation_failed"
        }
    }

    init(apiValue: String) {
        switch apiValue {
        case "ai_estimated":
            self = .aiEstimated
        case "estimation_failed":
            self = .estimationFailed
        default:
            self = .manual
        }
    }
}
