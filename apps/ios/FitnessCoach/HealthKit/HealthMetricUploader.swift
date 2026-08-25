import Foundation

struct HealthMetricUploadSample: Codable, Equatable, Sendable {
    let metricName: String
    let unit: String
    let value: Double
    let startTime: Date
    let endTime: Date
    let timezone: String
    let source: String
    let sourceSampleId: String
}

struct HealthMetricDeletedSample: Codable, Equatable, Sendable {
    let metricName: String
    let source: String
    let sourceSampleId: String
}

enum HealthMetricUploadResult: Equatable, Sendable {
    case skippedEmptyBatch
    case skippedLiveHealthDataDisabled
    case skippedMissingBackendURL
    case skippedMissingAuthToken
    case skippedNonDisposableBackend
    case uploaded(count: Int)
}

struct HealthMetricUploadProgress: Equatable, Sendable {
    let uploadedSamples: Int
    let totalSamples: Int
    let completedChunks: Int
    let totalChunks: Int
    let startedAt: Date
    let updatedAt: Date

    var percentComplete: Int {
        guard totalSamples > 0 else {
            return 0
        }

        return min(100, Int((Double(uploadedSamples) / Double(totalSamples) * 100).rounded()))
    }

    var estimatedRemainingSeconds: TimeInterval? {
        guard uploadedSamples > 0, uploadedSamples < totalSamples else {
            return nil
        }

        let elapsedSeconds = updatedAt.timeIntervalSince(startedAt)

        guard elapsedSeconds > 0 else {
            return nil
        }

        let samplesPerSecond = Double(uploadedSamples) / elapsedSeconds

        guard samplesPerSecond > 0 else {
            return nil
        }

        return Double(totalSamples - uploadedSamples) / samplesPerSecond
    }
}

typealias HealthMetricUploadProgressHandler = @Sendable (HealthMetricUploadProgress) async -> Void

protocol HealthMetricTransport: Sendable {
    func upload(_ request: URLRequest) async throws
}

protocol HealthMetricAuthorizationProvider: Sendable {
    func bearerToken(forceRefresh: Bool) async throws -> String?
}

struct URLSessionHealthMetricTransport: HealthMetricTransport, Sendable {
    func upload(_ request: URLRequest) async throws {
        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            throw HealthMetricUploaderError.uploadRejected(
                statusCode: (response as? HTTPURLResponse)?.statusCode,
                message: Self.rejectionMessage(from: data)
            )
        }
    }

    private static func rejectionMessage(from data: Data) -> String? {
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

enum HealthMetricUploaderError: LocalizedError, Sendable {
    case uploadRejected(statusCode: Int?, message: String?)

    var isUnauthorized: Bool {
        switch self {
        case .uploadRejected(let statusCode, _):
            return statusCode == 401
        }
    }

    var errorDescription: String? {
        switch self {
        case .uploadRejected(let statusCode, let message):
            let statusText = statusCode.map { "HTTP \($0)" } ?? "non-HTTP response"
            let messageText = message.map { ": \($0)" } ?? ""

            return "Backend rejected the HealthKit upload (\(statusText)\(messageText))."
        }
    }
}

struct HealthMetricUploader: Sendable {
    static let defaultMaxSamplesPerRequest = 1_000

    private let backendURL: URL?
    private let allowLiveHealthData: Bool
    private let allowHostedBackend: Bool
    private let userId: String
    private let bearerToken: String?
    private let authorizationProvider: (any HealthMetricAuthorizationProvider)?
    private let transport: any HealthMetricTransport

    init(
        backendURL: URL?,
        allowLiveHealthData: Bool,
        allowHostedBackend: Bool = false,
        userId: String = "user_alex",
        bearerToken: String? = nil,
        authorizationProvider: (any HealthMetricAuthorizationProvider)? = nil,
        transport: any HealthMetricTransport = URLSessionHealthMetricTransport()
    ) {
        self.backendURL = backendURL
        self.allowLiveHealthData = allowLiveHealthData
        self.allowHostedBackend = allowHostedBackend
        self.userId = userId
        let trimmedBearerToken = bearerToken?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.bearerToken = trimmedBearerToken?.isEmpty == false ? trimmedBearerToken : nil
        self.authorizationProvider = authorizationProvider
        self.transport = transport
    }

    static func fromProcessEnvironment(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        transport: any HealthMetricTransport = URLSessionHealthMetricTransport()
    ) -> HealthMetricUploader {
        let backendURL = environment["FITNESS_BACKEND_URL"].flatMap(URL.init(string:))
        let allowLiveHealthData = environment["ALLOW_LIVE_HEALTH_DATA"] == "1"
        let allowHostedBackend = environment["ALLOW_HOSTED_HEALTH_BACKEND"] == "1"
        let userId = environment["FITNESS_HEALTH_USER_ID"] ?? "user_alex"
        let bearerToken = environment["FITNESS_HEALTH_SYNC_TOKEN"]

        return HealthMetricUploader(
            backendURL: backendURL,
            allowLiveHealthData: allowLiveHealthData,
            allowHostedBackend: allowHostedBackend,
            userId: userId,
            bearerToken: bearerToken,
            transport: transport
        )
    }

    static func fromSession(
        _ session: HealthSyncSession,
        authorizationProvider: (any HealthMetricAuthorizationProvider)? = nil,
        transport: any HealthMetricTransport = URLSessionHealthMetricTransport()
    ) -> HealthMetricUploader {
        HealthMetricUploader(
            backendURL: session.backendURL,
            allowLiveHealthData: session.allowLiveHealthData,
            allowHostedBackend: session.allowHostedBackend,
            userId: session.userId,
            bearerToken: session.accessToken,
            authorizationProvider: authorizationProvider,
            transport: transport
        )
    }

    func upload(
        samples: [HealthMetricUploadSample],
        deletedSamples: [HealthMetricDeletedSample] = [],
        idempotencyKey: String
    ) async throws -> HealthMetricUploadResult {
        try await upload(
            samples: samples,
            deletedSamples: deletedSamples,
            idempotencyKey: idempotencyKey,
            forceRefreshBearerToken: false,
            canRetryUnauthorized: authorizationProvider != nil
        )
    }

    private func upload(
        samples: [HealthMetricUploadSample],
        deletedSamples: [HealthMetricDeletedSample],
        idempotencyKey: String,
        forceRefreshBearerToken: Bool,
        canRetryUnauthorized: Bool
    ) async throws -> HealthMetricUploadResult {
        let acceptedCount = samples.count + deletedSamples.count

        guard acceptedCount > 0 else {
            return .skippedEmptyBatch
        }

        guard allowLiveHealthData else {
            return .skippedLiveHealthDataDisabled
        }

        guard let backendURL else {
            return .skippedMissingBackendURL
        }

        if !backendURL.isDisposableBackend && !allowHostedBackend {
            return .skippedNonDisposableBackend
        }

        let resolvedBearerToken = try await resolvedBearerToken(
            forceRefresh: forceRefreshBearerToken
        )

        if !backendURL.isDisposableBackend && resolvedBearerToken == nil {
            return .skippedMissingAuthToken
        }

        let payload = HealthMetricUploadPayload(
            userId: userId,
            idempotencyKey: idempotencyKey,
            samples: samples,
            deletedSamples: deletedSamples
        )
        let requestURL = backendURL.appendingPathComponent("api/health/samples")
        var request = URLRequest(url: requestURL)

        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue(idempotencyKey, forHTTPHeaderField: "idempotency-key")
        request.setValue("return=minimal", forHTTPHeaderField: "prefer")

        if let resolvedBearerToken {
            request.setValue("Bearer \(resolvedBearerToken)", forHTTPHeaderField: "authorization")
        }

        request.httpBody = try HealthMetricJSON.encoder.encode(payload)

        do {
            try await transport.upload(request)
        } catch let error as HealthMetricUploaderError
            where error.isUnauthorized && canRetryUnauthorized {
            return try await upload(
                samples: samples,
                deletedSamples: deletedSamples,
                idempotencyKey: idempotencyKey,
                forceRefreshBearerToken: true,
                canRetryUnauthorized: false
            )
        }

        return .uploaded(count: acceptedCount)
    }

    private func resolvedBearerToken(forceRefresh: Bool) async throws -> String? {
        let token = try await authorizationProvider?.bearerToken(forceRefresh: forceRefresh)

        guard let token else {
            return bearerToken
        }

        let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)

        return trimmedToken.isEmpty ? nil : trimmedToken
    }

    func uploadInChunks(
        samples: [HealthMetricUploadSample],
        deletedSamples: [HealthMetricDeletedSample] = [],
        idempotencyKey: String,
        maxSamplesPerRequest: Int = Self.defaultMaxSamplesPerRequest,
        progress: HealthMetricUploadProgressHandler? = nil
    ) async throws -> HealthMetricUploadResult {
        precondition(maxSamplesPerRequest > 0, "maxSamplesPerRequest must be positive")

        let totalItems = samples.count + deletedSamples.count

        guard totalItems > 0 else {
            return .skippedEmptyBatch
        }

        let chunks = Self.uploadChunks(
            samples: samples,
            deletedSamples: deletedSamples,
            maxItemsPerRequest: maxSamplesPerRequest
        )
        let totalChunks = chunks.count
        let startedAt = Date()
        var uploadedCount = 0

        if let progress {
            await progress(
                HealthMetricUploadProgress(
                    uploadedSamples: uploadedCount,
                    totalSamples: totalItems,
                    completedChunks: 0,
                    totalChunks: totalChunks,
                    startedAt: startedAt,
                    updatedAt: startedAt
                )
            )
        }

        guard chunks.count > 1 else {
            let result = try await upload(
                samples: samples,
                deletedSamples: deletedSamples,
                idempotencyKey: idempotencyKey
            )

            if case .uploaded(let count) = result, let progress {
                uploadedCount += count
                await progress(
                    HealthMetricUploadProgress(
                        uploadedSamples: uploadedCount,
                        totalSamples: totalItems,
                        completedChunks: 1,
                        totalChunks: totalChunks,
                        startedAt: startedAt,
                        updatedAt: Date()
                    )
                )
            }

            return result
        }

        for (chunkIndex, chunk) in chunks.enumerated() {
            let chunkResult = try await upload(
                samples: chunk.samples,
                deletedSamples: chunk.deletedSamples,
                idempotencyKey: Self.chunkIdempotencyKey(
                    idempotencyKey,
                    chunkIndex: chunkIndex
                )
            )

            switch chunkResult {
            case .uploaded(let count):
                uploadedCount += count

                if let progress {
                    await progress(
                        HealthMetricUploadProgress(
                            uploadedSamples: uploadedCount,
                            totalSamples: totalItems,
                            completedChunks: chunkIndex + 1,
                            totalChunks: totalChunks,
                            startedAt: startedAt,
                            updatedAt: Date()
                        )
                    )
                }
            case .skippedEmptyBatch,
                 .skippedLiveHealthDataDisabled,
                 .skippedMissingBackendURL,
                 .skippedMissingAuthToken,
                 .skippedNonDisposableBackend:
                return chunkResult
            }
        }

        return .uploaded(count: uploadedCount)
    }

    private static func uploadChunks(
        samples: [HealthMetricUploadSample],
        deletedSamples: [HealthMetricDeletedSample],
        maxItemsPerRequest: Int
    ) -> [(samples: [HealthMetricUploadSample], deletedSamples: [HealthMetricDeletedSample])] {
        var chunks: [(samples: [HealthMetricUploadSample], deletedSamples: [HealthMetricDeletedSample])] = []
        var remainingSamples = samples[...]
        var remainingDeletedSamples = deletedSamples[...]

        while !remainingSamples.isEmpty || !remainingDeletedSamples.isEmpty {
            let sampleCount = min(maxItemsPerRequest, remainingSamples.count)
            let sampleChunk = Array(remainingSamples.prefix(sampleCount))
            remainingSamples = remainingSamples.dropFirst(sampleCount)

            let deletedSampleCapacity = maxItemsPerRequest - sampleChunk.count
            let deletedSampleCount = min(deletedSampleCapacity, remainingDeletedSamples.count)
            let deletedSampleChunk = Array(remainingDeletedSamples.prefix(deletedSampleCount))
            remainingDeletedSamples = remainingDeletedSamples.dropFirst(deletedSampleCount)

            chunks.append((samples: sampleChunk, deletedSamples: deletedSampleChunk))
        }

        return chunks
    }

    private static func chunkIdempotencyKey(
        _ idempotencyKey: String,
        chunkIndex: Int
    ) -> String {
        let suffix = ".chunk-\(chunkIndex + 1)"
        let maxBaseLength = max(0, 128 - suffix.count)

        return "\(idempotencyKey.prefix(maxBaseLength))\(suffix)"
    }
}

private struct HealthMetricUploadPayload: Codable, Sendable {
    let userId: String
    let idempotencyKey: String
    let samples: [HealthMetricUploadSample]
    let deletedSamples: [HealthMetricDeletedSample]
}

private enum HealthMetricJSON {
    static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

private extension URL {
    var isDisposableBackend: Bool {
        guard let host else {
            return false
        }

        return scheme == "http" &&
            ["127.0.0.1", "::1", "localhost"].contains(host.lowercased())
    }
}
