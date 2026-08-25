import Foundation
import Security

struct HealthSyncSession: Equatable, Sendable {
    let backendURL: URL
    let userId: String
    let allowLiveHealthData: Bool
    let allowHostedBackend: Bool
    let clientId: String
    let scope: String?
    let accessToken: String?
    let refreshToken: String?
    let accessTokenExpiresAt: Date?

    init(
        backendURL: URL,
        userId: String,
        allowLiveHealthData: Bool,
        allowHostedBackend: Bool,
        clientId: String,
        scope: String? = nil,
        accessToken: String?,
        refreshToken: String?,
        accessTokenExpiresAt: Date?
    ) {
        self.backendURL = backendURL
        self.userId = userId
        self.allowLiveHealthData = allowLiveHealthData
        self.allowHostedBackend = allowHostedBackend
        self.clientId = clientId
        self.scope = scope
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.accessTokenExpiresAt = accessTokenExpiresAt
    }
}

struct HealthSyncTokenResponse: Decodable, Equatable, Sendable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: TimeInterval
    let scope: String
}

protocol HealthSyncSecretStore: Sendable {
    func string(for key: String) throws -> String?
    func set(_ value: String, for key: String) throws
    func deleteString(for key: String) throws
}

protocol HealthSyncTokenTransport: Sendable {
    func refresh(
        backendURL: URL,
        clientId: String,
        refreshToken: String
    ) async throws -> HealthSyncTokenResponse
}

enum HealthSyncSessionError: LocalizedError, Sendable {
    case invalidBackendURL
    case missingStoredSession
    case missingRefreshToken
    case invalidRefreshGrant
    case tokenRefreshRejected(statusCode: Int?, message: String?)
    case invalidRefreshResponse

    var errorDescription: String? {
        switch self {
        case .invalidBackendURL:
            return "Health sync backend URL is invalid."
        case .missingStoredSession:
            return "Sign in with Google in Account settings to sync Apple Health."
        case .missingRefreshToken:
            return "Sign in with Google in Account settings to sync Apple Health."
        case .invalidRefreshGrant:
            return "Your Health sync session expired. Sign in with Google again in Account settings."
        case .tokenRefreshRejected(let statusCode, let message):
            let statusText = statusCode.map { "HTTP \($0)" } ?? "non-HTTP response"
            let messageText = message.map { ": \($0)" } ?? ""

            return "Backend rejected the HealthKit token refresh (\(statusText)\(messageText))."
        case .invalidRefreshResponse:
            return "Backend returned an invalid HealthKit token refresh response."
        }
    }

    var isInvalidRefreshGrant: Bool {
        switch self {
        case .invalidRefreshGrant:
            return true
        case .tokenRefreshRejected(let statusCode, let message):
            return statusCode == 400 && message == "invalid_grant"
        case .invalidBackendURL,
             .missingStoredSession,
             .missingRefreshToken,
             .invalidRefreshResponse:
            return false
        }
    }
}

final class HealthSyncSessionStore: @unchecked Sendable {
    static let backendURLDefaultsKey = "FitnessCoach.HealthSyncSession.BackendURL"
    static let userIdDefaultsKey = "FitnessCoach.HealthSyncSession.UserID"
    static let allowLiveHealthDataDefaultsKey =
        "FitnessCoach.HealthSyncSession.AllowLiveHealthData"
    static let allowHostedBackendDefaultsKey =
        "FitnessCoach.HealthSyncSession.AllowHostedBackend"
    static let clientIdDefaultsKey = "FitnessCoach.HealthSyncSession.ClientID"
    static let scopeDefaultsKey = "FitnessCoach.HealthSyncSession.Scope"
    static let accessTokenExpiresAtDefaultsKey =
        "FitnessCoach.HealthSyncSession.AccessTokenExpiresAt"

    private static let accessTokenSecretKey = "FitnessCoach.HealthSyncSession.AccessToken"
    private static let refreshTokenSecretKey = "FitnessCoach.HealthSyncSession.RefreshToken"
    private static let defaultUserId = "user_alex"
    private static let defaultClientId = "fitness-ios-bootstrap"

    private let defaults: UserDefaults
    private let secretStore: any HealthSyncSecretStore

    init(
        defaults: UserDefaults = .standard,
        secretStore: any HealthSyncSecretStore = KeychainHealthSyncSecretStore()
    ) {
        self.defaults = defaults
        self.secretStore = secretStore
    }

    func bootstrapFromEnvironment(
        _ environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws {
        guard let accessToken = trimmed(environment["FITNESS_HEALTH_SYNC_TOKEN"]) else {
            return
        }

        guard let backendURLString = trimmed(environment["FITNESS_BACKEND_URL"]),
              let backendURL = URL(string: backendURLString) else {
            throw HealthSyncSessionError.invalidBackendURL
        }

        try save(
            HealthSyncSession(
                backendURL: backendURL,
                userId: trimmed(environment["FITNESS_HEALTH_USER_ID"]) ?? Self.defaultUserId,
                allowLiveHealthData: environment["ALLOW_LIVE_HEALTH_DATA"] == "1",
                allowHostedBackend: environment["ALLOW_HOSTED_HEALTH_BACKEND"] == "1",
                clientId: trimmed(environment["FITNESS_HEALTH_OAUTH_CLIENT_ID"]) ??
                    Self.defaultClientId,
                scope: trimmed(environment["FITNESS_HEALTH_TOKEN_SCOPE"]) ??
                    "health:sync meal:write coach:write",
                accessToken: accessToken,
                refreshToken: trimmed(environment["FITNESS_HEALTH_REFRESH_TOKEN"]),
                accessTokenExpiresAt: Self.accessTokenExpiresAt(from: environment)
            )
        )
    }

    func save(_ session: HealthSyncSession) throws {
        defaults.set(session.backendURL.absoluteString, forKey: Self.backendURLDefaultsKey)
        defaults.set(session.userId, forKey: Self.userIdDefaultsKey)
        defaults.set(session.allowLiveHealthData, forKey: Self.allowLiveHealthDataDefaultsKey)
        defaults.set(session.allowHostedBackend, forKey: Self.allowHostedBackendDefaultsKey)
        defaults.set(session.clientId, forKey: Self.clientIdDefaultsKey)
        if let scope = trimmed(session.scope) {
            defaults.set(scope, forKey: Self.scopeDefaultsKey)
        } else {
            defaults.removeObject(forKey: Self.scopeDefaultsKey)
        }

        if let accessTokenExpiresAt = session.accessTokenExpiresAt {
            defaults.set(
                accessTokenExpiresAt.timeIntervalSince1970,
                forKey: Self.accessTokenExpiresAtDefaultsKey
            )
        } else {
            defaults.removeObject(forKey: Self.accessTokenExpiresAtDefaultsKey)
        }

        try setOrDeleteSecret(session.accessToken, for: Self.accessTokenSecretKey)
        try setOrDeleteSecret(session.refreshToken, for: Self.refreshTokenSecretKey)
    }

    func clearTokens() throws {
        defaults.removeObject(forKey: Self.accessTokenExpiresAtDefaultsKey)
        try secretStore.deleteString(for: Self.accessTokenSecretKey)
        try secretStore.deleteString(for: Self.refreshTokenSecretKey)
    }

    func clearTokens(ifRefreshTokenMatches refreshToken: String) throws {
        guard trimmed(loadSession()?.refreshToken) == trimmed(refreshToken) else {
            return
        }

        try clearTokens()
    }

    func loadSession() -> HealthSyncSession? {
        guard let backendURLString = defaults.string(forKey: Self.backendURLDefaultsKey),
              let backendURL = URL(string: backendURLString) else {
            return nil
        }

        let expirySeconds = defaults.object(forKey: Self.accessTokenExpiresAtDefaultsKey) as? Double

        return HealthSyncSession(
            backendURL: backendURL,
            userId: defaults.string(forKey: Self.userIdDefaultsKey) ?? Self.defaultUserId,
            allowLiveHealthData: defaults.bool(forKey: Self.allowLiveHealthDataDefaultsKey),
            allowHostedBackend: defaults.bool(forKey: Self.allowHostedBackendDefaultsKey),
            clientId: defaults.string(forKey: Self.clientIdDefaultsKey) ?? Self.defaultClientId,
            scope: defaults.string(forKey: Self.scopeDefaultsKey),
            accessToken: try? secretStore.string(for: Self.accessTokenSecretKey),
            refreshToken: try? secretStore.string(for: Self.refreshTokenSecretKey),
            accessTokenExpiresAt: expirySeconds.map(Date.init(timeIntervalSince1970:))
        )
    }

    private func setOrDeleteSecret(_ value: String?, for key: String) throws {
        guard let value = trimmed(value) else {
            try secretStore.deleteString(for: key)
            return
        }

        try secretStore.set(value, for: key)
    }

    private static func accessTokenExpiresAt(from environment: [String: String]) -> Date? {
        guard let value = trimmed(environment["FITNESS_HEALTH_TOKEN_EXPIRES_AT"]),
              let seconds = TimeInterval(value) else {
            return nil
        }

        return Date(timeIntervalSince1970: seconds)
    }
}

struct HealthSyncSessionManager: Sendable {
    private let store: HealthSyncSessionStore
    private let tokenTransport: any HealthSyncTokenTransport
    private let now: @Sendable () -> Date

    init(
        store: HealthSyncSessionStore = HealthSyncSessionStore(),
        tokenTransport: any HealthSyncTokenTransport = URLSessionHealthSyncTokenTransport(),
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.store = store
        self.tokenTransport = tokenTransport
        self.now = now
    }

    func uploader(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        uploadTransport: any HealthMetricTransport = URLSessionHealthMetricTransport()
    ) async throws -> HealthMetricUploader {
        if store.loadSession() == nil {
            try store.bootstrapFromEnvironment(environment)
        }

        guard let session = store.loadSession() else {
            guard trimmed(environment["FITNESS_BACKEND_URL"]) != nil ||
                trimmed(environment["FITNESS_HEALTH_SYNC_TOKEN"]) != nil else {
                throw HealthSyncSessionError.missingStoredSession
            }

            return HealthMetricUploader.fromProcessEnvironment(
                environment: environment,
                transport: uploadTransport
            )
        }

        return HealthMetricUploader.fromSession(
            try await usableSession(session),
            authorizationProvider: self,
            transport: uploadTransport
        )
    }

    func bootstrapFromEnvironment(
        _ environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws {
        try store.bootstrapFromEnvironment(environment)
    }

    private func usableSession(
        _ session: HealthSyncSession,
        forceRefresh: Bool = false
    ) async throws
        -> HealthSyncSession {
        if trimmed(session.accessToken) == nil {
            guard trimmed(session.refreshToken) != nil else {
                throw HealthSyncSessionError.missingRefreshToken
            }

            return try await HealthSyncSessionRefreshGate.shared.refreshedSession(
                session: session,
                store: store,
                tokenTransport: tokenTransport,
                forceRefresh: true,
                now: now
            )
        }

        guard forceRefresh || shouldRefresh(session) else {
            return session
        }

        return try await HealthSyncSessionRefreshGate.shared.refreshedSession(
            session: session,
            store: store,
            tokenTransport: tokenTransport,
            forceRefresh: forceRefresh,
            now: now
        )
    }

    fileprivate static func refreshedSession(
        _ session: HealthSyncSession,
        store: HealthSyncSessionStore,
        tokenTransport: any HealthSyncTokenTransport,
        now: @escaping @Sendable () -> Date
    ) async throws -> HealthSyncSession {
        guard let refreshToken = trimmed(session.refreshToken) else {
            throw HealthSyncSessionError.missingRefreshToken
        }

        let response: HealthSyncTokenResponse

        do {
            response = try await tokenTransport.refresh(
                backendURL: session.backendURL,
                clientId: session.clientId,
                refreshToken: refreshToken
            )
        } catch let error as HealthSyncSessionError where error.isInvalidRefreshGrant {
            try? store.clearTokens(ifRefreshTokenMatches: refreshToken)
            throw HealthSyncSessionError.invalidRefreshGrant
        }

        guard response.scope.split(separator: " ").contains("health:sync"),
              trimmed(response.accessToken) != nil,
              trimmed(response.refreshToken) != nil,
              response.expiresIn > 0 else {
            throw HealthSyncSessionError.invalidRefreshResponse
        }

        let refreshed = HealthSyncSession(
            backendURL: session.backendURL,
            userId: session.userId,
            allowLiveHealthData: session.allowLiveHealthData,
            allowHostedBackend: session.allowHostedBackend,
            clientId: session.clientId,
            scope: response.scope,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            accessTokenExpiresAt: now().addingTimeInterval(response.expiresIn)
        )

        try store.save(refreshed)

        return refreshed
    }

    fileprivate static func shouldRefresh(
        _ session: HealthSyncSession,
        now: @escaping @Sendable () -> Date
    ) -> Bool {
        guard let accessTokenExpiresAt = session.accessTokenExpiresAt else {
            return false
        }

        return accessTokenExpiresAt.timeIntervalSince(now()) <= 60
    }

    private func shouldRefresh(_ session: HealthSyncSession) -> Bool {
        Self.shouldRefresh(session, now: now)
    }
}

extension HealthSyncSessionManager: HealthMetricAuthorizationProvider {
    func bearerToken(forceRefresh: Bool) async throws -> String? {
        guard let session = store.loadSession() else {
            return nil
        }

        return try await usableSession(
            session,
            forceRefresh: forceRefresh
        ).accessToken
    }
}

private actor HealthSyncSessionRefreshGate {
    static let shared = HealthSyncSessionRefreshGate()

    private var refreshTasks: [HealthSyncSessionRefreshKey: Task<HealthSyncSession, Error>] = [:]

    func refreshedSession(
        session: HealthSyncSession,
        store: HealthSyncSessionStore,
        tokenTransport: any HealthSyncTokenTransport,
        forceRefresh: Bool,
        now: @escaping @Sendable () -> Date
    ) async throws -> HealthSyncSession {
        let latestSession = store.loadSession() ?? session
        let taskKey = HealthSyncSessionRefreshKey(session: latestSession)

        if let refreshTask = refreshTasks[taskKey] {
            return try await refreshTask.value
        }

        let refreshTask = Task {
            guard forceRefresh || HealthSyncSessionManager.shouldRefresh(
                latestSession,
                now: now
            ) else {
                return latestSession
            }

            return try await HealthSyncSessionManager.refreshedSession(
                latestSession,
                store: store,
                tokenTransport: tokenTransport,
                now: now
            )
        }

        refreshTasks[taskKey] = refreshTask
        defer { refreshTasks[taskKey] = nil }

        return try await refreshTask.value
    }
}

private struct HealthSyncSessionRefreshKey: Hashable, Sendable {
    let backendURL: URL
    let userId: String
    let clientId: String
    let refreshToken: String?

    init(session: HealthSyncSession) {
        backendURL = session.backendURL
        userId = session.userId
        clientId = session.clientId
        refreshToken = trimmed(session.refreshToken)
    }
}

struct URLSessionHealthSyncTokenTransport: HealthSyncTokenTransport, Sendable {
    func refresh(
        backendURL: URL,
        clientId: String,
        refreshToken: String
    ) async throws -> HealthSyncTokenResponse {
        let requestURL = backendURL.appendingPathComponent("oauth2/token")
        var request = URLRequest(url: requestURL)
        let body = URLSearchParams([
            ("grant_type", "refresh_token"),
            ("client_id", clientId),
            ("refresh_token", refreshToken),
        ])

        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "content-type")
        request.httpBody = body.data(using: .utf8)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            throw HealthSyncSessionError.tokenRefreshRejected(
                statusCode: (response as? HTTPURLResponse)?.statusCode,
                message: Self.rejectionMessage(from: data)
            )
        }

        return try HealthSyncTokenJSON.decoder.decode(HealthSyncTokenResponse.self, from: data)
    }

    private static func rejectionMessage(from data: Data) -> String? {
        guard !data.isEmpty else {
            return nil
        }

        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let description = json["error_description"] as? String {
                return description
            }

            if let error = json["error"] as? String {
                return error
            }
        }

        return String(data: data, encoding: .utf8)
    }
}

final class KeychainHealthSyncSecretStore: HealthSyncSecretStore, @unchecked Sendable {
    private let service: String

    init(service: String = "FitnessCoach.HealthSyncSession") {
        self.service = service
    }

    func string(for key: String) throws -> String? {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        if status == errSecItemNotFound {
            return nil
        }

        guard status == errSecSuccess else {
            throw KeychainHealthSyncSecretStoreError.unhandledStatus(status)
        }

        guard let data = item as? Data else {
            return nil
        }

        return String(data: data, encoding: .utf8)
    }

    func set(_ value: String, for key: String) throws {
        let data = Data(value.utf8)
        let query = baseQuery(for: key)
        let updateStatus = SecItemUpdate(
            query as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )

        if updateStatus == errSecSuccess {
            return
        }

        guard updateStatus == errSecItemNotFound else {
            throw KeychainHealthSyncSecretStoreError.unhandledStatus(updateStatus)
        }

        var addQuery = query
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)

        guard addStatus == errSecSuccess else {
            throw KeychainHealthSyncSecretStoreError.unhandledStatus(addStatus)
        }
    }

    func deleteString(for key: String) throws {
        let status = SecItemDelete(baseQuery(for: key) as CFDictionary)

        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainHealthSyncSecretStoreError.unhandledStatus(status)
        }
    }

    private func baseQuery(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }
}

private enum KeychainHealthSyncSecretStoreError: LocalizedError {
    case unhandledStatus(OSStatus)

    var errorDescription: String? {
        switch self {
        case .unhandledStatus(let status):
            return "Keychain operation failed with status \(status)."
        }
    }
}

private struct URLSearchParams {
    private let values: [(String, String)]

    init(_ values: [(String, String)]) {
        self.values = values
    }

    func data(using encoding: String.Encoding) -> Data? {
        string.data(using: encoding)
    }

    private var string: String {
        values
            .map { key, value in
                "\(Self.escape(key))=\(Self.escape(value))"
            }
            .joined(separator: "&")
    }

    private static func escape(_ value: String) -> String {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: ":#[]@!$&'()*+,;=")

        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}

enum HealthSyncTokenJSON {
    static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
}

private func trimmed(_ value: String?) -> String? {
    let trimmedValue = value?.trimmingCharacters(in: .whitespacesAndNewlines)

    return trimmedValue?.isEmpty == false ? trimmedValue : nil
}
