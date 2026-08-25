import AuthenticationServices
import CryptoKit
import Foundation
import Security
import UIKit

struct HealthSyncOAuthLoginConfig: Equatable, Sendable {
    static let production = HealthSyncOAuthLoginConfig(
        backendURL: URL(string: "https://fitness-ten-fawn.vercel.app")!,
        userId: "user_alex",
        clientId: "fitness-ios-bootstrap",
        redirectURI: "fitnesscoach://oauth/callback",
        scope: "health:sync meal:write coach:write"
    )

    let backendURL: URL
    let userId: String
    let clientId: String
    let redirectURI: String
    let scope: String

    var callbackScheme: String {
        URL(string: redirectURI)?.scheme ?? "fitnesscoach"
    }

    var resource: String {
        var value = backendURL.absoluteString

        while value.hasSuffix("/") {
            value.removeLast()
        }

        return value
    }
}

@MainActor
protocol HealthSyncOAuthAuthorizer: AnyObject, Sendable {
    func authorize(url: URL, callbackScheme: String) async throws -> URL
}

protocol HealthSyncOAuthTokenTransport: Sendable {
    func exchangeAuthorizationCode(
        backendURL: URL,
        clientId: String,
        redirectURI: String,
        code: String,
        codeVerifier: String
    ) async throws -> HealthSyncTokenResponse
}

enum HealthSyncOAuthLoginError: LocalizedError, Equatable, Sendable {
    case invalidAuthorizationURL
    case invalidCallback
    case stateMismatch
    case missingCode
    case tokenExchangeRejected(statusCode: Int?, message: String?)
    case invalidTokenResponse

    var errorDescription: String? {
        switch self {
        case .invalidAuthorizationURL:
            return "Could not create the sign-in request."
        case .invalidCallback:
            return "The sign-in callback was invalid."
        case .stateMismatch:
            return "The sign-in state did not match. Please try again."
        case .missingCode:
            return "The sign-in callback did not include an authorization code."
        case .tokenExchangeRejected(let statusCode, let message):
            let statusText = statusCode.map { "HTTP \($0)" } ?? "non-HTTP response"
            let messageText = message.map { ": \($0)" } ?? ""

            return "Backend rejected the sign-in token exchange (\(statusText)\(messageText))."
        case .invalidTokenResponse:
            return "Backend returned an invalid sign-in token response."
        }
    }
}

struct HealthSyncOAuthLoginService {
    private let authorizer: any HealthSyncOAuthAuthorizer
    private let store: HealthSyncSessionStore
    private let tokenTransport: any HealthSyncOAuthTokenTransport
    private let now: @Sendable () -> Date
    private let randomToken: @Sendable () -> String

    init(
        authorizer: any HealthSyncOAuthAuthorizer,
        store: HealthSyncSessionStore = HealthSyncSessionStore(),
        tokenTransport: any HealthSyncOAuthTokenTransport = URLSessionHealthSyncOAuthTokenTransport(),
        now: @escaping @Sendable () -> Date = Date.init,
        randomToken: @escaping @Sendable () -> String = secureRandomURLToken
    ) {
        self.authorizer = authorizer
        self.store = store
        self.tokenTransport = tokenTransport
        self.now = now
        self.randomToken = randomToken
    }

    func signIn(config: HealthSyncOAuthLoginConfig) async throws {
        let request = try authorizationRequest(config: config)
        let callbackURL = try await authorizer.authorize(
            url: request.url,
            callbackScheme: config.callbackScheme
        )
        let code = try authorizationCode(
            from: callbackURL,
            expectedState: request.state
        )
        let tokenResponse = try await tokenTransport.exchangeAuthorizationCode(
            backendURL: config.backendURL,
            clientId: config.clientId,
            redirectURI: config.redirectURI,
            code: code,
            codeVerifier: request.codeVerifier
        )

        guard tokenResponse.scope.split(separator: " ").contains("health:sync"),
              !tokenResponse.accessToken.isEmpty,
              !tokenResponse.refreshToken.isEmpty,
              tokenResponse.expiresIn > 0 else {
            throw HealthSyncOAuthLoginError.invalidTokenResponse
        }

        try store.save(
            HealthSyncSession(
                backendURL: config.backendURL,
                userId: config.userId,
                allowLiveHealthData: true,
                allowHostedBackend: true,
                clientId: config.clientId,
                scope: tokenResponse.scope,
                accessToken: tokenResponse.accessToken,
                refreshToken: tokenResponse.refreshToken,
                accessTokenExpiresAt: now().addingTimeInterval(tokenResponse.expiresIn)
            )
        )
    }

    func authorizationRequest(
        config: HealthSyncOAuthLoginConfig
    ) throws -> HealthSyncOAuthAuthorizationRequest {
        let state = randomToken()
        let codeVerifier = randomToken()
        var components = URLComponents(
            url: config.backendURL.appendingPathComponent("auth/google/start"),
            resolvingAgainstBaseURL: false
        )

        components?.queryItems = [
            URLQueryItem(name: "flow", value: "oauth-authorize"),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: config.clientId),
            URLQueryItem(name: "redirect_uri", value: config.redirectURI),
            URLQueryItem(name: "resource", value: config.resource),
            URLQueryItem(name: "scope", value: config.scope),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: pkceChallenge(codeVerifier)),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]

        guard let url = components?.url else {
            throw HealthSyncOAuthLoginError.invalidAuthorizationURL
        }

        return HealthSyncOAuthAuthorizationRequest(
            url: url,
            state: state,
            codeVerifier: codeVerifier
        )
    }
}

struct HealthSyncOAuthAuthorizationRequest: Equatable, Sendable {
    let url: URL
    let state: String
    let codeVerifier: String
}

@MainActor
final class HealthSyncOAuthLoginModel: NSObject, ObservableObject {
    @Published private(set) var isSigningIn = false
    @Published private(set) var isSignedIn = false
    @Published private(set) var sessionStatus = "Signed out"
    @Published var statusMessage: String?

    private let store: HealthSyncSessionStore
    private var currentAuthorizer: ASWebAuthenticationHealthSyncOAuthAuthorizer?

    init(store: HealthSyncSessionStore = HealthSyncSessionStore()) {
        self.store = store
        super.init()
        refresh()
    }

    func refresh() {
        let session = store.loadSession()

        if session?.refreshToken?.isEmpty == false {
            isSignedIn = true
            sessionStatus = "Signed in"
            return
        }

        isSignedIn = false
        sessionStatus = "Signed out"
    }

    func signIn(config: HealthSyncOAuthLoginConfig = .production) {
        guard !isSigningIn else {
            return
        }

        isSigningIn = true
        statusMessage = nil

        Task { @MainActor in
            defer {
                isSigningIn = false
                currentAuthorizer = nil
                refresh()
            }

            do {
                let authorizer = ASWebAuthenticationHealthSyncOAuthAuthorizer()
                currentAuthorizer = authorizer
                let service = HealthSyncOAuthLoginService(
                    authorizer: authorizer,
                    store: store
                )

                try await service.signIn(config: config)
                statusMessage = "Signed in. Health sync is authorized for this device."
            } catch {
                statusMessage = error.localizedDescription
            }
        }
    }

    func signOut() {
        try? store.clearTokens()
        statusMessage = "Signed out on this device."
        refresh()
    }
}

struct URLSessionHealthSyncOAuthTokenTransport: HealthSyncOAuthTokenTransport, Sendable {
    func exchangeAuthorizationCode(
        backendURL: URL,
        clientId: String,
        redirectURI: String,
        code: String,
        codeVerifier: String
    ) async throws -> HealthSyncTokenResponse {
        let requestURL = backendURL.appendingPathComponent("oauth2/token")
        var request = URLRequest(url: requestURL)
        let body = HealthSyncOAuthFormBody([
            ("grant_type", "authorization_code"),
            ("client_id", clientId),
            ("redirect_uri", redirectURI),
            ("code", code),
            ("code_verifier", codeVerifier),
        ])

        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "content-type")
        request.httpBody = body.data(using: .utf8)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            throw HealthSyncOAuthLoginError.tokenExchangeRejected(
                statusCode: (response as? HTTPURLResponse)?.statusCode,
                message: rejectionMessage(from: data)
            )
        }

        return try HealthSyncTokenJSON.decoder.decode(HealthSyncTokenResponse.self, from: data)
    }

    private func rejectionMessage(from data: Data) -> String? {
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

@MainActor
private final class ASWebAuthenticationHealthSyncOAuthAuthorizer: NSObject, HealthSyncOAuthAuthorizer,
    ASWebAuthenticationPresentationContextProviding, @unchecked Sendable {
    private var session: ASWebAuthenticationSession?

    func authorize(url: URL, callbackScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: callbackScheme
            ) { callbackURL, error in
                if let callbackURL {
                    continuation.resume(returning: callbackURL)
                    return
                }

                continuation.resume(throwing: error ?? HealthSyncOAuthLoginError.invalidCallback)
            }

            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session

            if !session.start() {
                continuation.resume(throwing: HealthSyncOAuthLoginError.invalidAuthorizationURL)
            }
        }
    }

    func presentationAnchor(for _: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}

private struct HealthSyncOAuthFormBody {
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

private func authorizationCode(from callbackURL: URL, expectedState: String) throws -> String {
    guard let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
        throw HealthSyncOAuthLoginError.invalidCallback
    }

    let queryItems = components.queryItems ?? []
    let state = queryItems.first { $0.name == "state" }?.value

    guard state == expectedState else {
        throw HealthSyncOAuthLoginError.stateMismatch
    }

    guard let code = queryItems.first(where: { $0.name == "code" })?.value,
          !code.isEmpty else {
        throw HealthSyncOAuthLoginError.missingCode
    }

    return code
}

private func pkceChallenge(_ verifier: String) -> String {
    Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncodedString()
}

private func secureRandomURLToken() -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)

    if status == errSecSuccess {
        return Data(bytes).base64URLEncodedString()
    }

    return UUID().uuidString.replacingOccurrences(of: "-", with: "")
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
