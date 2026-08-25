import XCTest
@testable import FitnessCoach

final class HealthMetricUploaderTests: XCTestCase {
    func testDefaultChunkSizeKeepsHostedPayloadsBoundedButReducesRequestCount() {
        XCTAssertEqual(HealthMetricUploader.defaultMaxSamplesPerRequest, 1_000)
    }

    func testUploadRejectedErrorDescriptionIncludesStatusAndServerMessage() {
        let error = HealthMetricUploaderError.uploadRejected(
            statusCode: 400,
            message: "Sample unit does not match the metric contract."
        )

        XCTAssertEqual(
            error.localizedDescription,
            "Backend rejected the HealthKit upload (HTTP 400: Sample unit does not match the metric contract.)."
        )
    }

    func testRequiresExplicitLiveHealthDataFlagBeforeUploadingSamples() async throws {
        let transport = RecordingHealthMetricTransport()
        let uploader = HealthMetricUploader(
            backendURL: URL(string: "http://127.0.0.1:8787")!,
            allowLiveHealthData: false,
            transport: transport
        )
        let sample = HealthMetricUploadSample(
            metricName: "weight",
            unit: "kg",
            value: 87.5,
            startTime: Date(timeIntervalSince1970: 1_800_000_000),
            endTime: Date(timeIntervalSince1970: 1_800_000_000),
            timezone: "Asia/Jerusalem",
            source: "apple_health",
            sourceSampleId: "sample-1"
        )

        let result = try await uploader.upload(samples: [sample], idempotencyKey: "healthkit-weight-1")

        XCTAssertEqual(result, .skippedLiveHealthDataDisabled)
        XCTAssertEqual(transport.requests.count, 0)
    }

    func testUploadsOnlyWhenBackendAndLiveHealthDataFlagAreExplicitlyConfigured() async throws {
        let transport = RecordingHealthMetricTransport()
        let uploader = HealthMetricUploader(
            backendURL: URL(string: "http://127.0.0.1:8787")!,
            allowLiveHealthData: true,
            transport: transport
        )
        let sample = HealthMetricUploadSample(
            metricName: "weight",
            unit: "kg",
            value: 87.5,
            startTime: Date(timeIntervalSince1970: 1_800_000_000),
            endTime: Date(timeIntervalSince1970: 1_800_000_000),
            timezone: "Asia/Jerusalem",
            source: "apple_health",
            sourceSampleId: "sample-1"
        )

        let result = try await uploader.upload(samples: [sample], idempotencyKey: "healthkit-weight-1")

        XCTAssertEqual(result, .uploaded(count: 1))
        XCTAssertEqual(transport.requests.count, 1)
        XCTAssertEqual(transport.requests[0].url, URL(string: "http://127.0.0.1:8787/api/health/samples"))
        XCTAssertEqual(transport.requests[0].httpMethod, "POST")
        XCTAssertEqual(transport.requests[0].value(forHTTPHeaderField: "content-type"), "application/json")
        XCTAssertEqual(transport.requests[0].value(forHTTPHeaderField: "idempotency-key"), "healthkit-weight-1")
        XCTAssertEqual(transport.requests[0].value(forHTTPHeaderField: "prefer"), "return=minimal")
    }

    func testUploadsLargeBatchesInBoundedChunks() async throws {
        let transport = RecordingHealthMetricTransport()
        let uploader = HealthMetricUploader(
            backendURL: URL(string: "http://127.0.0.1:8787")!,
            allowLiveHealthData: true,
            transport: transport
        )
        let samples = (0..<5).map { index in
            uploadSample(sourceSampleId: "sample-\(index)")
        }

        let result = try await uploader.uploadInChunks(
            samples: samples,
            idempotencyKey: "healthkit-large-batch",
            maxSamplesPerRequest: 2
        )

        XCTAssertEqual(result, .uploaded(count: 5))
        XCTAssertEqual(transport.requests.count, 3)
        XCTAssertEqual(
            transport.requests.map { $0.value(forHTTPHeaderField: "idempotency-key") },
            [
                "healthkit-large-batch.chunk-1",
                "healthkit-large-batch.chunk-2",
                "healthkit-large-batch.chunk-3",
            ]
        )
        XCTAssertEqual(try requestSampleCount(transport.requests[0]), 2)
        XCTAssertEqual(try requestSampleCount(transport.requests[1]), 2)
        XCTAssertEqual(try requestSampleCount(transport.requests[2]), 1)
    }

    func testUploadsDeletionOnlyBatchInsteadOfSkippingAsEmpty() async throws {
        let transport = RecordingHealthMetricTransport()
        let uploader = HealthMetricUploader(
            backendURL: URL(string: "http://127.0.0.1:8787")!,
            allowLiveHealthData: true,
            transport: transport
        )
        let deletedSample = HealthMetricDeletedSample(
            metricName: "weight",
            source: "apple_health",
            sourceSampleId: "deleted-weight-1"
        )

        let result = try await uploader.upload(
            samples: [],
            deletedSamples: [deletedSample],
            idempotencyKey: "healthkit-delete-1"
        )

        XCTAssertEqual(result, .uploaded(count: 1))
        XCTAssertEqual(transport.requests.count, 1)
        XCTAssertEqual(try requestSampleCount(transport.requests[0]), 0)
        XCTAssertEqual(try requestDeletedSampleCount(transport.requests[0]), 1)
    }

    func testUploadsMixedSamplesAndDeletionsInOnePayload() async throws {
        let transport = RecordingHealthMetricTransport()
        let uploader = HealthMetricUploader(
            backendURL: URL(string: "http://127.0.0.1:8787")!,
            allowLiveHealthData: true,
            transport: transport
        )
        let deletedSample = HealthMetricDeletedSample(
            metricName: "steps",
            source: "apple_health",
            sourceSampleId: "deleted-steps-1"
        )

        let result = try await uploader.upload(
            samples: [uploadSample(sourceSampleId: "sample-1")],
            deletedSamples: [deletedSample],
            idempotencyKey: "healthkit-mixed-1"
        )

        XCTAssertEqual(result, .uploaded(count: 2))
        XCTAssertEqual(transport.requests.count, 1)

        let body = try XCTUnwrap(transport.requests[0].httpBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        let deletedSamples = try XCTUnwrap(json["deletedSamples"] as? [[String: Any]])

        XCTAssertEqual(deletedSamples.count, 1)
        XCTAssertEqual(deletedSamples[0]["metricName"] as? String, "steps")
        XCTAssertEqual(deletedSamples[0]["source"] as? String, "apple_health")
        XCTAssertEqual(deletedSamples[0]["sourceSampleId"] as? String, "deleted-steps-1")
    }

    func testUploadsDeletionChunksWithStableIdempotencyKeys() async throws {
        let transport = RecordingHealthMetricTransport()
        let uploader = HealthMetricUploader(
            backendURL: URL(string: "http://127.0.0.1:8787")!,
            allowLiveHealthData: true,
            transport: transport
        )
        let deletedSamples = (0..<5).map { index in
            HealthMetricDeletedSample(
                metricName: "weight",
                source: "apple_health",
                sourceSampleId: "deleted-\(index)"
            )
        }

        let result = try await uploader.uploadInChunks(
            samples: [],
            deletedSamples: deletedSamples,
            idempotencyKey: "healthkit-delete-large-batch",
            maxSamplesPerRequest: 2
        )

        XCTAssertEqual(result, .uploaded(count: 5))
        XCTAssertEqual(transport.requests.count, 3)
        XCTAssertEqual(
            transport.requests.map { $0.value(forHTTPHeaderField: "idempotency-key") },
            [
                "healthkit-delete-large-batch.chunk-1",
                "healthkit-delete-large-batch.chunk-2",
                "healthkit-delete-large-batch.chunk-3",
            ]
        )
        XCTAssertEqual(try requestDeletedSampleCount(transport.requests[0]), 2)
        XCTAssertEqual(try requestDeletedSampleCount(transport.requests[1]), 2)
        XCTAssertEqual(try requestDeletedSampleCount(transport.requests[2]), 1)
    }

    func testReportsUploadProgressForBoundedChunks() async throws {
        let transport = RecordingHealthMetricTransport()
        let progressRecorder = UploadProgressRecorder()
        let uploader = HealthMetricUploader(
            backendURL: URL(string: "http://127.0.0.1:8787")!,
            allowLiveHealthData: true,
            transport: transport
        )
        let samples = (0..<5).map { index in
            uploadSample(sourceSampleId: "sample-\(index)")
        }

        let result = try await uploader.uploadInChunks(
            samples: samples,
            idempotencyKey: "healthkit-large-progress-batch",
            maxSamplesPerRequest: 2,
            progress: { progress in
                await progressRecorder.append(progress)
            }
        )

        let progresses = await progressRecorder.values()

        XCTAssertEqual(result, .uploaded(count: 5))
        XCTAssertEqual(progresses.map(\.uploadedSamples), [0, 2, 4, 5])
        XCTAssertEqual(progresses.map(\.totalSamples), [5, 5, 5, 5])
        XCTAssertEqual(progresses.map(\.completedChunks), [0, 1, 2, 3])
        XCTAssertEqual(progresses.map(\.totalChunks), [3, 3, 3, 3])
    }

    func testRetriesUnauthorizedChunkWithForcedBearerRefresh() async throws {
        let transport = UnauthorizedOnceHealthMetricTransport()
        let authorizationProvider = RecordingHealthMetricAuthorizationProvider(
            normalToken: "expired-access-token",
            forcedToken: "fresh-access-token"
        )
        let uploader = HealthMetricUploader(
            backendURL: URL(string: "https://fitness-ten-fawn.vercel.app")!,
            allowLiveHealthData: true,
            allowHostedBackend: true,
            userId: "user_alex",
            authorizationProvider: authorizationProvider,
            transport: transport
        )

        let result = try await uploader.upload(
            samples: [uploadSample(sourceSampleId: "retry-after-401")],
            idempotencyKey: "healthkit-retry-401"
        )

        XCTAssertEqual(result, .uploaded(count: 1))
        XCTAssertEqual(
            authorizationProvider.forceRefreshValues,
            [false, true]
        )
        XCTAssertEqual(
            transport.requests.map { $0.value(forHTTPHeaderField: "authorization") },
            [
                "Bearer expired-access-token",
                "Bearer fresh-access-token",
            ]
        )
    }

    func testUploadPayloadIncludesUserAndAuthorizationWhenConfigured() async throws {
        let transport = RecordingHealthMetricTransport()
        let uploader = HealthMetricUploader(
            backendURL: URL(string: "http://127.0.0.1:8787")!,
            allowLiveHealthData: true,
            userId: "user_alex",
            bearerToken: "health-sync-token",
            transport: transport
        )
        let sample = HealthMetricUploadSample(
            metricName: "steps",
            unit: "count",
            value: 12_000,
            startTime: Date(timeIntervalSince1970: 1_800_000_000),
            endTime: Date(timeIntervalSince1970: 1_800_003_600),
            timezone: "Asia/Jerusalem",
            source: "apple_health",
            sourceSampleId: "sample-steps-1"
        )

        _ = try await uploader.upload(samples: [sample], idempotencyKey: "healthkit-steps-1")

        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer health-sync-token")

        let body = try XCTUnwrap(request.httpBody)
        let json = try XCTUnwrap(
            JSONSerialization.jsonObject(with: body) as? [String: Any]
        )

        XCTAssertEqual(json["userId"] as? String, "user_alex")
        XCTAssertEqual(json["idempotencyKey"] as? String, "healthkit-steps-1")
    }

    func testHostedBackendRequiresExplicitOptInAndBearerToken() async throws {
        let sample = HealthMetricUploadSample(
            metricName: "heart_rate",
            unit: "bpm",
            value: 72,
            startTime: Date(timeIntervalSince1970: 1_800_000_000),
            endTime: Date(timeIntervalSince1970: 1_800_000_060),
            timezone: "Asia/Jerusalem",
            source: "apple_health",
            sourceSampleId: "sample-heart-rate-1"
        )
        let hostedURL = URL(string: "https://fitness-ten-fawn.vercel.app")!
        let blockedTransport = RecordingHealthMetricTransport()
        let missingOptIn = HealthMetricUploader(
            backendURL: hostedURL,
            allowLiveHealthData: true,
            userId: "user_alex",
            bearerToken: "health-sync-token",
            transport: blockedTransport
        )

        let missingOptInResult = try await missingOptIn.upload(
            samples: [sample],
            idempotencyKey: "healthkit-hosted-1"
        )

        XCTAssertEqual(missingOptInResult, .skippedNonDisposableBackend)
        XCTAssertEqual(blockedTransport.requests.count, 0)

        let missingToken = HealthMetricUploader(
            backendURL: hostedURL,
            allowLiveHealthData: true,
            allowHostedBackend: true,
            userId: "user_alex",
            transport: blockedTransport
        )

        let missingTokenResult = try await missingToken.upload(
            samples: [sample],
            idempotencyKey: "healthkit-hosted-2"
        )

        XCTAssertEqual(missingTokenResult, .skippedMissingAuthToken)
        XCTAssertEqual(blockedTransport.requests.count, 0)

        let allowedTransport = RecordingHealthMetricTransport()
        let allowed = HealthMetricUploader(
            backendURL: hostedURL,
            allowLiveHealthData: true,
            allowHostedBackend: true,
            userId: "user_alex",
            bearerToken: "health-sync-token",
            transport: allowedTransport
        )

        let allowedResult = try await allowed.upload(
            samples: [sample],
            idempotencyKey: "healthkit-hosted-3"
        )

        XCTAssertEqual(allowedResult, .uploaded(count: 1))
        XCTAssertEqual(allowedTransport.requests.count, 1)
        XCTAssertEqual(
            allowedTransport.requests[0].value(forHTTPHeaderField: "authorization"),
            "Bearer health-sync-token"
        )
    }

    func testHostedBackendTreatsBlankBearerTokenAsMissing() async throws {
        let transport = RecordingHealthMetricTransport()
        let uploader = HealthMetricUploader(
            backendURL: URL(string: "https://fitness-ten-fawn.vercel.app")!,
            allowLiveHealthData: true,
            allowHostedBackend: true,
            userId: "user_alex",
            bearerToken: "   ",
            transport: transport
        )
        let sample = HealthMetricUploadSample(
            metricName: "heart_rate",
            unit: "bpm",
            value: 72,
            startTime: Date(timeIntervalSince1970: 1_800_000_000),
            endTime: Date(timeIntervalSince1970: 1_800_000_060),
            timezone: "Asia/Jerusalem",
            source: "apple_health",
            sourceSampleId: "sample-heart-rate-blank-token"
        )

        let result = try await uploader.upload(
            samples: [sample],
            idempotencyKey: "healthkit-hosted-blank-token"
        )

        XCTAssertEqual(result, .skippedMissingAuthToken)
        XCTAssertEqual(transport.requests.count, 0)
    }

    func testSessionStoreBootstrapsLaunchEnvironmentIntoPersistentSettingsAndKeychain() throws {
        let defaults = UserDefaults(suiteName: "HealthSyncSessionTests.bootstrap")!
        defaults.removePersistentDomain(forName: "HealthSyncSessionTests.bootstrap")
        let secrets = InMemoryHealthSyncSecretStore()
        let store = HealthSyncSessionStore(defaults: defaults, secretStore: secrets)

        try store.bootstrapFromEnvironment([
            "FITNESS_BACKEND_URL": "https://fitness-ten-fawn.vercel.app",
            "ALLOW_LIVE_HEALTH_DATA": "1",
            "ALLOW_HOSTED_HEALTH_BACKEND": "1",
            "FITNESS_HEALTH_USER_ID": "user_alex",
            "FITNESS_HEALTH_SYNC_TOKEN": "launch-access-token",
            "FITNESS_HEALTH_REFRESH_TOKEN": "launch-refresh-token",
            "FITNESS_HEALTH_TOKEN_EXPIRES_AT": "1800000300",
            "FITNESS_HEALTH_OAUTH_CLIENT_ID": "fitness-ios-bootstrap",
        ])

        let session = try XCTUnwrap(store.loadSession())

        XCTAssertEqual(session.backendURL, URL(string: "https://fitness-ten-fawn.vercel.app"))
        XCTAssertEqual(session.userId, "user_alex")
        XCTAssertEqual(session.clientId, "fitness-ios-bootstrap")
        XCTAssertEqual(session.accessToken, "launch-access-token")
        XCTAssertEqual(session.refreshToken, "launch-refresh-token")
        XCTAssertEqual(session.accessTokenExpiresAt, Date(timeIntervalSince1970: 1_800_000_300))
        XCTAssertTrue(session.allowLiveHealthData)
        XCTAssertTrue(session.allowHostedBackend)
    }

    func testSessionManagerUsesStoredSessionWhenLaunchEnvironmentIsMissing() async throws {
        let transport = RecordingHealthMetricTransport()
        let store = HealthSyncSessionStore(
            defaults: isolatedDefaults("HealthSyncSessionTests.stored"),
            secretStore: InMemoryHealthSyncSecretStore()
        )
        try store.save(
            HealthSyncSession(
                backendURL: URL(string: "https://fitness-ten-fawn.vercel.app")!,
                userId: "user_alex",
                allowLiveHealthData: true,
                allowHostedBackend: true,
                clientId: "fitness-ios-bootstrap",
                accessToken: "stored-access-token",
                refreshToken: "stored-refresh-token",
                accessTokenExpiresAt: Date(timeIntervalSince1970: 1_800_000_300)
            )
        )
        let manager = HealthSyncSessionManager(
            store: store,
            tokenTransport: RecordingHealthSyncTokenTransport(),
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )

        let uploader = try await manager.uploader(
            environment: [:],
            uploadTransport: transport
        )
        _ = try await uploader.upload(
            samples: [uploadSample(sourceSampleId: "stored-session-sample")],
            idempotencyKey: "stored-session-upload"
        )

        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer stored-access-token")
    }

    func testSessionManagerCanBootstrapLaunchEnvironmentOverStoredSession() async throws {
        let transport = RecordingHealthMetricTransport()
        let store = HealthSyncSessionStore(
            defaults: isolatedDefaults("HealthSyncSessionTests.envPrecedence"),
            secretStore: InMemoryHealthSyncSecretStore()
        )
        try store.save(
            HealthSyncSession(
                backendURL: URL(string: "https://fitness-ten-fawn.vercel.app")!,
                userId: "user_alex",
                allowLiveHealthData: true,
                allowHostedBackend: true,
                clientId: "fitness-ios-bootstrap",
                accessToken: "stored-access-token",
                refreshToken: "stored-refresh-token",
                accessTokenExpiresAt: Date(timeIntervalSince1970: 1_800_000_300)
            )
        )
        let manager = HealthSyncSessionManager(
            store: store,
            tokenTransport: RecordingHealthSyncTokenTransport(),
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )

        try manager.bootstrapFromEnvironment(
            [
                "FITNESS_BACKEND_URL": "http://127.0.0.1:8787",
                "ALLOW_LIVE_HEALTH_DATA": "1",
                "FITNESS_HEALTH_USER_ID": "user_alex",
                "FITNESS_HEALTH_SYNC_TOKEN": "launch-access-token",
            ]
        )

        let uploader = try await manager.uploader(
            environment: [:],
            uploadTransport: transport
        )
        _ = try await uploader.upload(
            samples: [uploadSample(sourceSampleId: "launch-session-sample")],
            idempotencyKey: "launch-session-upload"
        )

        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.url, URL(string: "http://127.0.0.1:8787/api/health/samples"))
        XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer launch-access-token")
    }

    func testSessionManagerDoesNotOverwriteStoredInteractiveSessionWithStaleLaunchEnvironment()
        async throws {
        let transport = RecordingHealthMetricTransport()
        let store = HealthSyncSessionStore(
            defaults: isolatedDefaults("HealthSyncSessionTests.staleLaunchEnvironment"),
            secretStore: InMemoryHealthSyncSecretStore()
        )
        try store.save(
            HealthSyncSession(
                backendURL: URL(string: "https://fitness-ten-fawn.vercel.app")!,
                userId: "user_alex",
                allowLiveHealthData: true,
                allowHostedBackend: true,
                clientId: "fitness-ios-bootstrap",
                accessToken: "signed-in-access-token",
                refreshToken: "signed-in-refresh-token",
                accessTokenExpiresAt: Date(timeIntervalSince1970: 1_800_000_300)
            )
        )
        let manager = HealthSyncSessionManager(
            store: store,
            tokenTransport: RecordingHealthSyncTokenTransport(),
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )

        let uploader = try await manager.uploader(
            environment: [
                "FITNESS_BACKEND_URL": "https://fitness-ten-fawn.vercel.app",
                "ALLOW_LIVE_HEALTH_DATA": "1",
                "ALLOW_HOSTED_HEALTH_BACKEND": "1",
                "FITNESS_HEALTH_USER_ID": "user_alex",
                "FITNESS_HEALTH_OAUTH_CLIENT_ID": "fitness-ios-bootstrap",
                "FITNESS_HEALTH_SYNC_TOKEN": "stale-launch-access-token",
                "FITNESS_HEALTH_REFRESH_TOKEN": "stale-launch-refresh-token",
                "FITNESS_HEALTH_TOKEN_EXPIRES_AT": "1800000300",
            ],
            uploadTransport: transport
        )
        _ = try await uploader.upload(
            samples: [uploadSample(sourceSampleId: "signed-in-session-sample")],
            idempotencyKey: "signed-in-session-upload"
        )

        let request = try XCTUnwrap(transport.requests.first)

        XCTAssertEqual(
            request.value(forHTTPHeaderField: "authorization"),
            "Bearer signed-in-access-token"
        )
    }

    func testSessionManagerRefreshesExpiredAccessTokensAndStoresRotatedRefreshToken() async throws {
        let transport = RecordingHealthMetricTransport()
        let tokenTransport = RecordingHealthSyncTokenTransport(
            response: HealthSyncTokenResponse(
                accessToken: "new-access-token",
                refreshToken: "new-refresh-token",
                expiresIn: 300,
                scope: "health:sync"
            )
        )
        let store = HealthSyncSessionStore(
            defaults: isolatedDefaults("HealthSyncSessionTests.refresh"),
            secretStore: InMemoryHealthSyncSecretStore()
        )
        try store.save(
            HealthSyncSession(
                backendURL: URL(string: "https://fitness-ten-fawn.vercel.app")!,
                userId: "user_alex",
                allowLiveHealthData: true,
                allowHostedBackend: true,
                clientId: "fitness-ios-bootstrap",
                accessToken: "expired-access-token",
                refreshToken: "old-refresh-token",
                accessTokenExpiresAt: Date(timeIntervalSince1970: 1_799_999_999)
            )
        )
        let manager = HealthSyncSessionManager(
            store: store,
            tokenTransport: tokenTransport,
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )

        let uploader = try await manager.uploader(
            environment: [:],
            uploadTransport: transport
        )
        _ = try await uploader.upload(
            samples: [uploadSample(sourceSampleId: "refreshed-session-sample")],
            idempotencyKey: "refreshed-session-upload"
        )

        let request = try XCTUnwrap(transport.requests.first)
        let refreshedSession = try XCTUnwrap(store.loadSession())

        XCTAssertEqual(tokenTransport.requests.map(\.refreshToken), ["old-refresh-token"])
        XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer new-access-token")
        XCTAssertEqual(refreshedSession.refreshToken, "new-refresh-token")
        XCTAssertEqual(refreshedSession.accessTokenExpiresAt, Date(timeIntervalSince1970: 1_800_000_300))
    }

    func testSessionManagerRefreshesMissingAccessTokenBeforeCreatingUploader() async throws {
        let transport = RecordingHealthMetricTransport()
        let tokenTransport = RecordingHealthSyncTokenTransport(
            response: HealthSyncTokenResponse(
                accessToken: "recovered-access-token",
                refreshToken: "recovered-refresh-token",
                expiresIn: 300,
                scope: "health:sync"
            )
        )
        let store = HealthSyncSessionStore(
            defaults: isolatedDefaults("HealthSyncSessionTests.missingAccessToken"),
            secretStore: InMemoryHealthSyncSecretStore()
        )
        try store.save(
            HealthSyncSession(
                backendURL: URL(string: "https://fitness-ten-fawn.vercel.app")!,
                userId: "user_alex",
                allowLiveHealthData: true,
                allowHostedBackend: true,
                clientId: "fitness-ios-bootstrap",
                accessToken: nil,
                refreshToken: "recoverable-refresh-token",
                accessTokenExpiresAt: nil
            )
        )
        let manager = HealthSyncSessionManager(
            store: store,
            tokenTransport: tokenTransport,
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )

        let uploader = try await manager.uploader(
            environment: [:],
            uploadTransport: transport
        )
        _ = try await uploader.upload(
            samples: [uploadSample(sourceSampleId: "recovered-session-sample")],
            idempotencyKey: "recovered-session-upload"
        )

        let request = try XCTUnwrap(transport.requests.first)
        let refreshedSession = try XCTUnwrap(store.loadSession())

        XCTAssertEqual(tokenTransport.requests.map(\.refreshToken), ["recoverable-refresh-token"])
        XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer recovered-access-token")
        XCTAssertEqual(refreshedSession.refreshToken, "recovered-refresh-token")
    }

    func testSessionManagerFailsFastWhenStoredSessionHasNoTokens() async throws {
        let store = HealthSyncSessionStore(
            defaults: isolatedDefaults("HealthSyncSessionTests.missingStoredTokens"),
            secretStore: InMemoryHealthSyncSecretStore()
        )
        try store.save(
            HealthSyncSession(
                backendURL: URL(string: "https://fitness-ten-fawn.vercel.app")!,
                userId: "user_alex",
                allowLiveHealthData: true,
                allowHostedBackend: true,
                clientId: "fitness-ios-bootstrap",
                accessToken: nil,
                refreshToken: nil,
                accessTokenExpiresAt: nil
            )
        )
        let manager = HealthSyncSessionManager(
            store: store,
            tokenTransport: RecordingHealthSyncTokenTransport(),
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )

        do {
            _ = try await manager.uploader(
                environment: [:],
                uploadTransport: RecordingHealthMetricTransport()
            )
            XCTFail("Expected missing stored tokens to fail before HealthKit reads start.")
        } catch {
            XCTAssertEqual(
                error.localizedDescription,
                "Sign in with Google in Account settings to sync Apple Health."
            )
        }
    }

    func testSessionManagerFailsFastWhenNoStoredSessionOrLaunchEnvironmentExists() async throws {
        let manager = HealthSyncSessionManager(
            store: HealthSyncSessionStore(
                defaults: isolatedDefaults("HealthSyncSessionTests.noStoredSession"),
                secretStore: InMemoryHealthSyncSecretStore()
            ),
            tokenTransport: RecordingHealthSyncTokenTransport(),
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )

        do {
            _ = try await manager.uploader(
                environment: [:],
                uploadTransport: RecordingHealthMetricTransport()
            )
            XCTFail("Expected missing session to fail before HealthKit reads start.")
        } catch {
            XCTAssertEqual(
                error.localizedDescription,
                "Sign in with Google in Account settings to sync Apple Health."
            )
        }
    }

    func testSessionManagerCoalescesConcurrentForcedRefreshes() async throws {
        let tokenTransport = DelayedHealthSyncTokenTransport(
            response: HealthSyncTokenResponse(
                accessToken: "coalesced-access-token",
                refreshToken: "coalesced-refresh-token",
                expiresIn: 300,
                scope: "health:sync"
            )
        )
        let store = HealthSyncSessionStore(
            defaults: isolatedDefaults("HealthSyncSessionTests.coalescedRefresh"),
            secretStore: InMemoryHealthSyncSecretStore()
        )
        try store.save(
            HealthSyncSession(
                backendURL: URL(string: "https://fitness-ten-fawn.vercel.app")!,
                userId: "user_alex",
                allowLiveHealthData: true,
                allowHostedBackend: true,
                clientId: "fitness-ios-bootstrap",
                accessToken: "expired-access-token",
                refreshToken: "old-refresh-token",
                accessTokenExpiresAt: Date(timeIntervalSince1970: 1_799_999_999)
            )
        )
        let manager = HealthSyncSessionManager(
            store: store,
            tokenTransport: tokenTransport,
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )

        async let firstToken = manager.bearerToken(forceRefresh: true)
        async let secondToken = manager.bearerToken(forceRefresh: true)
        let tokens = try await [firstToken, secondToken]

        let refreshedSession = try XCTUnwrap(store.loadSession())

        XCTAssertEqual(tokens, ["coalesced-access-token", "coalesced-access-token"])
        XCTAssertEqual(tokenTransport.recordedRequests().map(\.refreshToken), ["old-refresh-token"])
        XCTAssertEqual(refreshedSession.refreshToken, "coalesced-refresh-token")
    }

    func testSessionManagerClearsTokensWhenRefreshTokenIsInvalidGrant() async throws {
        let store = HealthSyncSessionStore(
            defaults: isolatedDefaults("HealthSyncSessionTests.invalidGrant"),
            secretStore: InMemoryHealthSyncSecretStore()
        )
        try store.save(
            HealthSyncSession(
                backendURL: URL(string: "https://fitness-ten-fawn.vercel.app")!,
                userId: "user_alex",
                allowLiveHealthData: true,
                allowHostedBackend: true,
                clientId: "fitness-ios-bootstrap",
                accessToken: "expired-access-token",
                refreshToken: "already-rotated-refresh-token",
                accessTokenExpiresAt: Date(timeIntervalSince1970: 1_799_999_999)
            )
        )
        let manager = HealthSyncSessionManager(
            store: store,
            tokenTransport: InvalidGrantHealthSyncTokenTransport(),
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )

        do {
            _ = try await manager.uploader(
                environment: [:],
                uploadTransport: RecordingHealthMetricTransport()
            )
            XCTFail("Expected invalid grant refresh to fail.")
        } catch {
            XCTAssertEqual(
                error.localizedDescription,
                "Your Health sync session expired. Sign in with Google again in Account settings."
            )
        }

        let session = try XCTUnwrap(store.loadSession())

        XCTAssertNil(session.accessToken)
        XCTAssertNil(session.refreshToken)
        XCTAssertNil(session.accessTokenExpiresAt)
    }

    func testSessionManagerDoesNotClearNewerSessionWhenOldRefreshTokenIsInvalidGrant()
        async throws {
        let store = HealthSyncSessionStore(
            defaults: isolatedDefaults("HealthSyncSessionTests.invalidGrantPreservesNewerSession"),
            secretStore: InMemoryHealthSyncSecretStore()
        )
        let newerExpiry = Date(timeIntervalSince1970: 1_800_000_300)
        try store.save(
            HealthSyncSession(
                backendURL: URL(string: "https://fitness-ten-fawn.vercel.app")!,
                userId: "user_alex",
                allowLiveHealthData: true,
                allowHostedBackend: true,
                clientId: "fitness-ios-bootstrap",
                accessToken: "expired-access-token",
                refreshToken: "already-rotated-refresh-token",
                accessTokenExpiresAt: Date(timeIntervalSince1970: 1_799_999_999)
            )
        )
        let manager = HealthSyncSessionManager(
            store: store,
            tokenTransport: NewerSessionThenInvalidGrantHealthSyncTokenTransport(
                store: store,
                newerExpiry: newerExpiry
            ),
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )

        do {
            _ = try await manager.uploader(
                environment: [:],
                uploadTransport: RecordingHealthMetricTransport()
            )
            XCTFail("Expected invalid grant refresh to fail.")
        } catch {
            XCTAssertEqual(
                error.localizedDescription,
                "Your Health sync session expired. Sign in with Google again in Account settings."
            )
        }

        let session = try XCTUnwrap(store.loadSession())

        XCTAssertEqual(session.accessToken, "newer-access-token")
        XCTAssertEqual(session.refreshToken, "newer-refresh-token")
        XCTAssertEqual(session.accessTokenExpiresAt, newerExpiry)
    }

    @MainActor
    func testOAuthLoginAuthorizesThroughGoogleStartAndSavesRefreshSession() async throws {
        let store = HealthSyncSessionStore(
            defaults: isolatedDefaults("HealthSyncOAuthLoginTests.signIn"),
            secretStore: InMemoryHealthSyncSecretStore()
        )
        let authorizer = RecordingHealthSyncOAuthAuthorizer(callbackCode: "returned-health-code")
        let tokenTransport = RecordingHealthSyncOAuthTokenTransport(
            response: HealthSyncTokenResponse(
                accessToken: "health-access-token",
                refreshToken: "health-refresh-token",
                expiresIn: 300,
                scope: "health:sync meal:write coach:write"
            )
        )
        let service = HealthSyncOAuthLoginService(
            authorizer: authorizer,
            store: store,
            tokenTransport: tokenTransport,
            now: { Date(timeIntervalSince1970: 1_800_000_000) },
            randomToken: { "fixed-oauth-token" }
        )

        try await service.signIn(config: .production)

        let authorizeRequest = try XCTUnwrap(authorizer.requests.first)
        let tokenRequest = try XCTUnwrap(tokenTransport.requests.first)
        let session = try XCTUnwrap(store.loadSession())

        XCTAssertEqual(authorizeRequest.callbackScheme, "fitnesscoach")
        XCTAssertEqual(authorizeRequest.url.path, "/auth/google/start")
        XCTAssertEqual(queryValue(authorizeRequest.url, "flow"), "oauth-authorize")
        XCTAssertEqual(queryValue(authorizeRequest.url, "response_type"), "code")
        XCTAssertEqual(queryValue(authorizeRequest.url, "client_id"), "fitness-ios-bootstrap")
        XCTAssertEqual(queryValue(authorizeRequest.url, "redirect_uri"), "fitnesscoach://oauth/callback")
        XCTAssertEqual(queryValue(authorizeRequest.url, "resource"), "https://fitness-ten-fawn.vercel.app")
        XCTAssertEqual(queryValue(authorizeRequest.url, "scope"), "health:sync meal:write coach:write")
        XCTAssertEqual(queryValue(authorizeRequest.url, "state"), "fixed-oauth-token")
        XCTAssertEqual(queryValue(authorizeRequest.url, "code_challenge_method"), "S256")
        XCTAssertNotEqual(queryValue(authorizeRequest.url, "code_challenge"), "fixed-oauth-token")
        XCTAssertEqual(tokenRequest.backendURL, URL(string: "https://fitness-ten-fawn.vercel.app"))
        XCTAssertEqual(tokenRequest.clientId, "fitness-ios-bootstrap")
        XCTAssertEqual(tokenRequest.redirectURI, "fitnesscoach://oauth/callback")
        XCTAssertEqual(tokenRequest.code, "returned-health-code")
        XCTAssertEqual(tokenRequest.codeVerifier, "fixed-oauth-token")
        XCTAssertEqual(session.backendURL, URL(string: "https://fitness-ten-fawn.vercel.app"))
        XCTAssertEqual(session.userId, "user_alex")
        XCTAssertEqual(session.clientId, "fitness-ios-bootstrap")
        XCTAssertEqual(session.scope, "health:sync meal:write coach:write")
        XCTAssertEqual(session.accessToken, "health-access-token")
        XCTAssertEqual(session.refreshToken, "health-refresh-token")
        XCTAssertEqual(session.accessTokenExpiresAt, Date(timeIntervalSince1970: 1_800_000_300))
        XCTAssertTrue(session.allowLiveHealthData)
        XCTAssertTrue(session.allowHostedBackend)
    }

    @MainActor
    func testOAuthLoginRejectsCallbackStateMismatchWithoutSavingTokens() async throws {
        let store = HealthSyncSessionStore(
            defaults: isolatedDefaults("HealthSyncOAuthLoginTests.stateMismatch"),
            secretStore: InMemoryHealthSyncSecretStore()
        )
        let authorizer = RecordingHealthSyncOAuthAuthorizer(
            callbackCode: "returned-health-code",
            callbackStateOverride: "wrong-state"
        )
        let tokenTransport = RecordingHealthSyncOAuthTokenTransport()
        let service = HealthSyncOAuthLoginService(
            authorizer: authorizer,
            store: store,
            tokenTransport: tokenTransport,
            randomToken: { "expected-state" }
        )

        do {
            try await service.signIn(config: .production)
            XCTFail("Expected state mismatch to fail.")
        } catch {
            XCTAssertEqual(error as? HealthSyncOAuthLoginError, .stateMismatch)
        }

        XCTAssertNil(store.loadSession())
        XCTAssertEqual(tokenTransport.requests.count, 0)
    }

    @MainActor
    func testOAuthLoginRejectsTokenWithoutHealthSyncScope() async throws {
        let store = HealthSyncSessionStore(
            defaults: isolatedDefaults("HealthSyncOAuthLoginTests.invalidScope"),
            secretStore: InMemoryHealthSyncSecretStore()
        )
        let authorizer = RecordingHealthSyncOAuthAuthorizer(callbackCode: "returned-health-code")
        let tokenTransport = RecordingHealthSyncOAuthTokenTransport(
            response: HealthSyncTokenResponse(
                accessToken: "health-access-token",
                refreshToken: "health-refresh-token",
                expiresIn: 300,
                scope: "health:read"
            )
        )
        let service = HealthSyncOAuthLoginService(
            authorizer: authorizer,
            store: store,
            tokenTransport: tokenTransport,
            randomToken: { "fixed-oauth-token" }
        )

        do {
            try await service.signIn(config: .production)
            XCTFail("Expected invalid scope to fail.")
        } catch {
            XCTAssertEqual(error as? HealthSyncOAuthLoginError, .invalidTokenResponse)
        }

        XCTAssertNil(store.loadSession())
    }
}

private func uploadSample(sourceSampleId: String) -> HealthMetricUploadSample {
    HealthMetricUploadSample(
        metricName: "weight",
        unit: "kg",
        value: 87.5,
        startTime: Date(timeIntervalSince1970: 1_800_000_000),
        endTime: Date(timeIntervalSince1970: 1_800_000_000),
        timezone: "Asia/Jerusalem",
        source: "apple_health",
        sourceSampleId: sourceSampleId
    )
}

private func requestSampleCount(_ request: URLRequest) throws -> Int {
    let body = try XCTUnwrap(request.httpBody)
    let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
    let samples = try XCTUnwrap(json["samples"] as? [[String: Any]])

    return samples.count
}

private func requestDeletedSampleCount(_ request: URLRequest) throws -> Int {
    let body = try XCTUnwrap(request.httpBody)
    let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
    let samples = try XCTUnwrap(json["deletedSamples"] as? [[String: Any]])

    return samples.count
}

private func queryValue(_ url: URL, _ name: String) -> String? {
    URLComponents(url: url, resolvingAgainstBaseURL: false)?
        .queryItems?
        .first { $0.name == name }?
        .value
}

private final class RecordingHealthMetricTransport: HealthMetricTransport, @unchecked Sendable {
    private(set) var requests: [URLRequest] = []

    func upload(_ request: URLRequest) async throws {
        requests.append(request)
    }
}

private final class UnauthorizedOnceHealthMetricTransport: HealthMetricTransport, @unchecked Sendable {
    private(set) var requests: [URLRequest] = []

    func upload(_ request: URLRequest) async throws {
        requests.append(request)

        if requests.count == 1 {
            throw HealthMetricUploaderError.uploadRejected(
                statusCode: 401,
                message: "malformed"
            )
        }
    }
}

private final class RecordingHealthMetricAuthorizationProvider:
    HealthMetricAuthorizationProvider, @unchecked Sendable {
    private let normalToken: String
    private let forcedToken: String
    private(set) var forceRefreshValues: [Bool] = []

    init(normalToken: String, forcedToken: String) {
        self.normalToken = normalToken
        self.forcedToken = forcedToken
    }

    func bearerToken(forceRefresh: Bool) async throws -> String? {
        forceRefreshValues.append(forceRefresh)

        return forceRefresh ? forcedToken : normalToken
    }
}

private final class InMemoryHealthSyncSecretStore: HealthSyncSecretStore, @unchecked Sendable {
    private var values: [String: String] = [:]

    func string(for key: String) throws -> String? {
        values[key]
    }

    func set(_ value: String, for key: String) throws {
        values[key] = value
    }

    func deleteString(for key: String) throws {
        values.removeValue(forKey: key)
    }
}

private final class RecordingHealthSyncTokenTransport: HealthSyncTokenTransport, @unchecked Sendable {
    struct Request: Equatable {
        let backendURL: URL
        let clientId: String
        let refreshToken: String
    }

    private(set) var requests: [Request] = []
    private let response: HealthSyncTokenResponse

    init(
        response: HealthSyncTokenResponse = HealthSyncTokenResponse(
            accessToken: "unused-access-token",
            refreshToken: "unused-refresh-token",
            expiresIn: 300,
            scope: "health:sync"
        )
    ) {
        self.response = response
    }

    func refresh(
        backendURL: URL,
        clientId: String,
        refreshToken: String
    ) async throws -> HealthSyncTokenResponse {
        requests.append(
            Request(
                backendURL: backendURL,
                clientId: clientId,
                refreshToken: refreshToken
            )
        )

        return response
    }
}

@MainActor
private final class RecordingHealthSyncOAuthAuthorizer:
    HealthSyncOAuthAuthorizer, @unchecked Sendable {
    struct Request: Equatable {
        let url: URL
        let callbackScheme: String
    }

    private(set) var requests: [Request] = []
    private let callbackCode: String
    private let callbackStateOverride: String?

    init(
        callbackCode: String = "authorization-code",
        callbackStateOverride: String? = nil
    ) {
        self.callbackCode = callbackCode
        self.callbackStateOverride = callbackStateOverride
    }

    func authorize(url: URL, callbackScheme: String) async throws -> URL {
        requests.append(Request(url: url, callbackScheme: callbackScheme))

        var components = URLComponents()
        components.scheme = callbackScheme
        components.host = "oauth"
        components.path = "/callback"
        components.queryItems = [
            URLQueryItem(name: "code", value: callbackCode),
            URLQueryItem(
                name: "state",
                value: callbackStateOverride ?? queryValue(url, "state")
            ),
        ]

        return try XCTUnwrap(components.url)
    }
}

private final class RecordingHealthSyncOAuthTokenTransport:
    HealthSyncOAuthTokenTransport, @unchecked Sendable {
    struct Request: Equatable {
        let backendURL: URL
        let clientId: String
        let redirectURI: String
        let code: String
        let codeVerifier: String
    }

    private(set) var requests: [Request] = []
    private let response: HealthSyncTokenResponse

    init(
        response: HealthSyncTokenResponse = HealthSyncTokenResponse(
            accessToken: "health-access-token",
            refreshToken: "health-refresh-token",
            expiresIn: 300,
            scope: "health:sync"
        )
    ) {
        self.response = response
    }

    func exchangeAuthorizationCode(
        backendURL: URL,
        clientId: String,
        redirectURI: String,
        code: String,
        codeVerifier: String
    ) async throws -> HealthSyncTokenResponse {
        requests.append(
            Request(
                backendURL: backendURL,
                clientId: clientId,
                redirectURI: redirectURI,
                code: code,
                codeVerifier: codeVerifier
            )
        )

        return response
    }
}

private final class DelayedHealthSyncTokenTransport: HealthSyncTokenTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [RecordingHealthSyncTokenTransport.Request] = []
    private let response: HealthSyncTokenResponse

    init(response: HealthSyncTokenResponse) {
        self.response = response
    }

    func refresh(
        backendURL: URL,
        clientId: String,
        refreshToken: String
    ) async throws -> HealthSyncTokenResponse {
        lock.withLock {
            requests.append(
                RecordingHealthSyncTokenTransport.Request(
                    backendURL: backendURL,
                    clientId: clientId,
                    refreshToken: refreshToken
                )
            )
        }

        try await Task.sleep(nanoseconds: 100_000_000)

        return response
    }

    func recordedRequests() -> [RecordingHealthSyncTokenTransport.Request] {
        lock.withLock { requests }
    }
}

private struct InvalidGrantHealthSyncTokenTransport: HealthSyncTokenTransport {
    func refresh(
        backendURL _: URL,
        clientId _: String,
        refreshToken _: String
    ) async throws -> HealthSyncTokenResponse {
        throw HealthSyncSessionError.tokenRefreshRejected(
            statusCode: 400,
            message: "invalid_grant"
        )
    }
}

private struct NewerSessionThenInvalidGrantHealthSyncTokenTransport: HealthSyncTokenTransport {
    let store: HealthSyncSessionStore
    let newerExpiry: Date

    func refresh(
        backendURL: URL,
        clientId: String,
        refreshToken _: String
    ) async throws -> HealthSyncTokenResponse {
        try store.save(
            HealthSyncSession(
                backendURL: backendURL,
                userId: "user_alex",
                allowLiveHealthData: true,
                allowHostedBackend: true,
                clientId: clientId,
                accessToken: "newer-access-token",
                refreshToken: "newer-refresh-token",
                accessTokenExpiresAt: newerExpiry
            )
        )

        throw HealthSyncSessionError.tokenRefreshRejected(
            statusCode: 400,
            message: "invalid_grant"
        )
    }
}

private func isolatedDefaults(_ suiteName: String) -> UserDefaults {
    let defaults = UserDefaults(suiteName: suiteName)!
    defaults.removePersistentDomain(forName: suiteName)

    return defaults
}

private actor UploadProgressRecorder {
    private var recordedValues: [HealthMetricUploadProgress] = []

    func append(_ progress: HealthMetricUploadProgress) {
        recordedValues.append(progress)
    }

    func values() -> [HealthMetricUploadProgress] {
        recordedValues
    }
}
