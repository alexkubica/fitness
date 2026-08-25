import Charts
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import WidgetKit

enum HealthSyncAutomation {
    static let autoSyncOnForegroundDefaultsKey =
        "FitnessCoach.SyncAutomation.AutoSyncOnForeground"
    static let foregroundAttemptCooldown: TimeInterval = 15 * 60

    static func shouldAutoSyncOnForeground(
        isEnabled: Bool,
        isUITestMode: Bool,
        authorizationSummary: HealthKitAuthorizationSummary,
        isRequestingAuthorization: Bool,
        isSyncing: Bool,
        allowLiveHealthData: Bool,
        allowHostedBackend: Bool,
        backendURLString: String,
        lastAttemptAt: Date?,
        now: Date
    ) -> Bool {
        guard isEnabled,
              !isUITestMode,
              authorizationSummary.isReady,
              !isRequestingAuthorization,
              !isSyncing,
              allowLiveHealthData,
              allowHostedBackend,
              URL(string: backendURLString)?.host != nil else {
            return false
        }

        if let lastAttemptAt,
           now.timeIntervalSince(lastAttemptAt) < foregroundAttemptCooldown {
            return false
        }

        return true
    }

    static func shouldStartSignInBeforeManualSync(
        allowLiveHealthData: Bool,
        allowHostedBackend: Bool,
        backendURLString: String,
        isSignedIn: Bool,
        isSigningIn: Bool
    ) -> Bool {
        guard allowLiveHealthData,
              allowHostedBackend,
              URL(string: backendURLString)?.host != nil,
              !isSignedIn,
              !isSigningIn else {
            return false
        }

        return true
    }
}

enum AppBuildInfo {
    static var displayText: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "0.0.0"
        let build = info?["CFBundleVersion"] as? String ?? "dev"

        return "v\(version) (\(build))"
    }
}

struct ContentView: View {
    @StateObject private var healthKitStore: HealthKitStore
    @StateObject private var notificationSettings = HealthSyncNotificationSettings()
    @StateObject private var loginModel = HealthSyncOAuthLoginModel()
    @StateObject private var coachProfileStore = CoachProfileStore()
    @StateObject private var mealLogStore = MealLogStore()
    @StateObject private var mealPlanStore = DailyMealPlanStore()
    @StateObject private var eatingCheckInStore = EatingCheckInStore()
    @StateObject private var savedMealStore = SavedMealStore()
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(HealthSyncSessionStore.backendURLDefaultsKey)
    private var backendURLString = ""
    @AppStorage(HealthSyncSessionStore.allowLiveHealthDataDefaultsKey)
    private var allowLiveHealthData = false
    @AppStorage(HealthSyncSessionStore.allowHostedBackendDefaultsKey)
    private var allowHostedBackend = false
    @AppStorage(HealthSyncAutomation.autoSyncOnForegroundDefaultsKey)
    private var autoSyncOnForeground = true
    @AppStorage(HealthSyncNotifier.completionNotificationsEnabledDefaultsKey)
    private var completionNotificationsEnabled = HealthSyncNotifier.completionNotificationsDefaultEnabled
    @AppStorage(HealthSyncNotifier.staleReminderEnabledDefaultsKey)
    private var staleSyncRemindersEnabled = HealthSyncNotifier.staleReminderDefaultEnabled
    @AppStorage("FitnessCoach.AppNotifications.QuietDefaults.v2")
    private var didApplyQuietNotificationDefaults = false
    @AppStorage("FitnessCoach.SyncAutomation.ActiveDefaults.v1")
    private var didApplyActiveSyncDefaults = false
    @State private var isRequestingAuthorization = false
    @State private var isSyncing = false
    @State private var isShowingSettings = false
    @State private var isShowingCoachSetup = false
    @State private var isShowingMealLogger = false
    @State private var mealLogInitialDate = Date()
    @State private var mealLogInitialPrompt = ""
    @State private var mealBeingEdited: MealLogEntry?
    @State private var mealPendingDeletion: MealLogEntry?
    @State private var didOfferCoachSetupThisSession = false
    @State private var lastForegroundAutoSyncAttemptAt: Date?
    @State private var lastMealMetadataSyncAt: Date?
    @State private var mealRefreshStatusText: String?
    @State private var lastCoachProfileSyncAt: Date?
    @State private var isSyncingMealMetadata = false
    @State private var isSyncingCoachProfile = false
    @State private var isWritingNutritionToHealth = false
    @State private var nutritionWritebackMessage: String?
    @State private var homeMetricSummaries: [HomeMetricSummary] = []
    @State private var isLoadingHomeMetrics = false
    @State private var homeMetricError: String?
    @State private var coachHealthDefaults = CoachHealthDefaults()
    @State private var selectedAppTab = FitnessAppTab.today
    @State private var navigationPath = NavigationPath()
    @State private var healthSyncLiveActivityController = HealthSyncLiveActivityController()
    @State private var pendingNutritionAction: String?
    private let mealPersistenceClient: MealPersistenceClient
    private let coachProfileClient: CoachProfilePersistenceClient
    private let watchSyncBridge: PhoneWatchSyncBridge?

    init(
        healthKitStore: HealthKitStore = HealthKitStore(),
        mealPersistenceClient: MealPersistenceClient = MealPersistenceClient(),
        coachProfileClient: CoachProfilePersistenceClient = CoachProfilePersistenceClient(),
        watchSyncBridge: PhoneWatchSyncBridge? = nil
    ) {
        _healthKitStore = StateObject(wrappedValue: healthKitStore)
        self.mealPersistenceClient = mealPersistenceClient
        self.coachProfileClient = coachProfileClient
        self.watchSyncBridge = watchSyncBridge
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ZStack {
                FitnessTheme.background.ignoresSafeArea()

                TabView(selection: $selectedAppTab) {
                    todayTab
                        .tag(FitnessAppTab.today)
                        .tabItem {
                            Label(FitnessAppTab.today.title, systemImage: FitnessAppTab.today.systemImage)
                        }

                    metricsTab
                        .tag(FitnessAppTab.metrics)
                        .tabItem {
                            Label(FitnessAppTab.metrics.title, systemImage: FitnessAppTab.metrics.systemImage)
                        }

                    syncTab
                        .tag(FitnessAppTab.sync)
                        .tabItem {
                            Label(FitnessAppTab.sync.title, systemImage: FitnessAppTab.sync.systemImage)
                        }

                    coachTab
                        .tag(FitnessAppTab.coach)
                        .tabItem {
                            Label(FitnessAppTab.coach.title, systemImage: FitnessAppTab.coach.systemImage)
                        }
                }
                .tint(FitnessTheme.lime)
            }
            .navigationTitle(selectedAppTab.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        isShowingSettings = true
                    } label: {
                        Image(systemName: "gearshape.fill")
                    }
                    .foregroundStyle(FitnessTheme.lime)
                    .accessibilityLabel("Settings")
                }
            }
            .navigationDestination(for: String.self) { metricName in
                if let descriptor = HealthKitStore.firstSliceReadDescriptors.first(where: {
                    $0.metricName == metricName
                }) {
                    MetricDetailView(
                        descriptor: descriptor,
                        healthKitStore: healthKitStore
                    )
                } else {
                    UnavailableMetricDeepLinkView(metricName: metricName)
                }
            }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $isShowingSettings) {
            SettingsView(
                authorizationSummary: healthKitStore.authorizationSummary,
                backendDisplayText: backendDisplayText,
                liveUploadDisplayText: liveUploadDisplayText,
                authSessionStatus: loginModel.sessionStatus,
                authSessionMessage: loginModel.statusMessage,
                isAuthSessionSignedIn: loginModel.isSignedIn,
                isSigningIn: loginModel.isSigningIn,
                notificationSettings: notificationSettings,
                autoSyncOnForeground: $autoSyncOnForeground,
                completionNotificationsEnabled: $completionNotificationsEnabled,
                staleSyncRemindersEnabled: $staleSyncRemindersEnabled,
                onSignIn: { loginModel.signIn() },
                onSignOut: loginModel.signOut,
                onRequestAccess: requestReadAccess,
                onRequestNotifications: requestNotifications
            )
            .preferredColorScheme(.dark)
        }
        .sheet(isPresented: $isShowingCoachSetup) {
            CoachSetupView(
                existingProfile: coachProfileStore.profile,
                healthDefaults: coachHealthDefaults
            ) { profile in
                coachProfileStore.save(profile)
                MealReminderScheduler.scheduleReminders(for: profile)
                uploadCoachProfile(profile)
            }
            .preferredColorScheme(.dark)
        }
        .sheet(isPresented: $isShowingMealLogger) {
            MealLogEditorView(
                profile: coachProfileStore.profile,
                mealStore: mealLogStore,
                savedMealStore: savedMealStore,
                existingMeal: nil,
                initialLoggedAt: mealLogInitialDate,
                initialPrompt: mealLogInitialPrompt,
                mealPersistenceClient: mealPersistenceClient,
                onNeedsSignIn: {
                    openSettingsAfterMealSheet()
                }
            )
                .preferredColorScheme(.dark)
        }
        .sheet(item: $mealBeingEdited) { meal in
            MealLogEditorView(
                profile: coachProfileStore.profile,
                mealStore: mealLogStore,
                savedMealStore: savedMealStore,
                existingMeal: meal,
                mealPersistenceClient: mealPersistenceClient,
                onNeedsSignIn: {
                    openSettingsAfterMealSheet()
                }
            )
            .preferredColorScheme(.dark)
        }
        .confirmationDialog(
            "Delete meal?",
            isPresented: Binding(
                get: {
                    mealPendingDeletion != nil
                },
                set: { isPresented in
                    if !isPresented {
                        mealPendingDeletion = nil
                    }
                }
            ),
            titleVisibility: .visible
        ) {
            if let meal = mealPendingDeletion {
                Button("Delete Meal", role: .destructive) {
                    deleteMeal(meal)
                    mealPendingDeletion = nil
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            if let meal = mealPendingDeletion {
                Text("This removes \(meal.title) from this app and your synced account.")
            }
        }
        .task {
            applyActiveSyncDefaultsIfNeeded()
            applyQuietNotificationDefaultsIfNeeded()
            await handleAppBecameActive()
            await mealPlanStore.refresh()
            await eatingCheckInStore.refresh()
            publishNutritionSnapshot()
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else {
                return
            }

            Task { @MainActor in
                await handleAppBecameActive()
            }
        }
        .onChange(of: loginModel.isSignedIn) { _, isSignedIn in
            if isSignedIn {
                healthKitStore.clearSignInRequiredSyncFailure()
                Task {
                    await mealPlanStore.refresh()
                    await eatingCheckInStore.refresh()
                }
            }
        }
        .onReceive(mealLogStore.$meals) { _ in
            publishNutritionSnapshot()
        }
        .onReceive(mealPlanStore.$response) { _ in
            publishNutritionSnapshot()
        }
        .onReceive(eatingCheckInStore.$checkIns) { _ in
            publishNutritionSnapshot()
        }
        .onChange(of: healthKitStore.syncProgress) { _, syncProgress in
            updateSyncLiveActivity(progress: syncProgress)
        }
        .onChange(of: healthKitStore.lastSyncResult) { _, result in
            guard result != nil else {
                return
            }

            Task { @MainActor in
                await loadHomeMetricSummaries()
            }
        }
        .onOpenURL { url in
            handleDeepLink(url)
        }
    }

    private var todayTab: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                SyncCenterHeader(
                    isSyncing: isSyncing,
                    canSync: healthKitStore.authorizationSummary.isReady,
                    onSync: syncHealthDeltas
                )

                HomeOverviewCard(
                    authorizationSummary: healthKitStore.authorizationSummary,
                    healthKitStore: healthKitStore,
                    summaries: homeMetricSummaries,
                    isLoading: isLoadingHomeMetrics,
                    errorMessage: homeMetricError,
                    onRequestAccess: requestReadAccess
                )

                NutritionTodayCard(
                    profile: coachProfileStore.profile,
                    mealStore: mealLogStore,
                    mealPlanStore: mealPlanStore,
                    eatingCheckInStore: eatingCheckInStore,
                    isWritingNutritionToHealth: isWritingNutritionToHealth,
                    writebackMessage: nutritionWritebackMessage,
                    pendingAction: $pendingNutritionAction,
                    onSetup: {
                        isShowingCoachSetup = true
                    },
                    onLogMeal: { loggedAt in
                        mealLogInitialDate = loggedAt
                        mealLogInitialPrompt = ""
                        isShowingMealLogger = true
                    },
                    onChangeDay: { loggedAt, prompt in
                        mealLogInitialDate = loggedAt
                        mealLogInitialPrompt = prompt
                        isShowingMealLogger = true
                    },
                    onEditMeal: { meal in
                        mealBeingEdited = meal
                    },
                    onDeleteMeal: { meal in
                        mealPendingDeletion = meal
                    },
                    onDeleteIngredient: { ingredient, meal in
                        deleteIngredient(ingredient, from: meal)
                    },
                    onReorderMeals: { meals, date in
                        reorderMeals(meals, on: date)
                    },
                    onReorderIngredients: { ingredients, meal in
                        reorderIngredients(ingredients, in: meal)
                    },
                    onMoveIngredientToMeal: { ingredientID, targetMeal in
                        moveIngredient(ingredientID, to: targetMeal)
                    },
                    onWriteNutritionToHealth: { date, totals in
                        writeNutritionToAppleHealth(date: date, totals: totals)
                    },
                    refreshStatusText: mealRefreshStatusText,
                    onRefreshDay: { day in
                        await refreshMealDayFromServer(day)
                    }
                )
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 32)
        }
        .refreshable {
            await loadHomeMetricSummaries()
            await refreshMealMetadataFromServer()
            await syncCoachProfileIfNeeded(force: true)
            await mealPlanStore.refresh()
            await eatingCheckInStore.refresh()
            publishNutritionSnapshot()
        }
    }

    private var metricsTab: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                MetricsCard(
                    authorizationSummary: healthKitStore.authorizationSummary,
                    healthKitStore: healthKitStore
                )
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 32)
        }
        .refreshable {
            await loadHomeMetricSummaries()
        }
    }

    private var syncTab: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                CompactSyncCard(
                    authorizationSummary: healthKitStore.authorizationSummary,
                    syncProgress: healthKitStore.syncProgress,
                    lastSyncResult: healthKitStore.lastSyncResult,
                    isRequestingAuthorization: isRequestingAuthorization,
                    isSyncing: isSyncing,
                    onRequestAccess: requestReadAccess,
                    onSignIn: { loginModel.signIn() }
                )

                if let syncResult = healthKitStore.lastSyncResult {
                    GlassCard {
                        VStack(alignment: .leading, spacing: 14) {
                            SectionHeader(
                                title: "Last Sync",
                                trailing: syncResult.shortStatus
                            )
                            LastSyncResultView(
                                result: syncResult,
                                onSignIn: { loginModel.signIn() }
                            )
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 32)
        }
        .refreshable {
            await handleAppBecameActive()
        }
    }

    private var coachTab: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                CoachTargetCard(
                    profile: coachProfileStore.profile,
                    healthDefaults: coachHealthDefaults,
                    onSetup: {
                        isShowingCoachSetup = true
                    }
                )

                GlassCard {
                    VStack(alignment: .leading, spacing: 14) {
                        SectionHeader(title: "Coach Context", trailing: "Targets")
                        Text("Keep this light: goal, calorie target, macro targets, and reminder slots are shared with iOS, web, and MCP.")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(FitnessTheme.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)

                        Button {
                            isShowingCoachSetup = true
                        } label: {
                            ActionButtonLabel(
                                title: coachProfileStore.profile == nil ? "Set Up Coach" : "Edit Coach Profile",
                                systemImage: "slider.horizontal.3"
                            )
                        }
                        .buttonStyle(SecondaryActionButtonStyle())
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 32)
        }
        .refreshable {
            await syncCoachProfileIfNeeded(force: true)
        }
    }

    private func requestReadAccess() {
        Task { @MainActor in
            guard !isRequestingAuthorization else { return }

            isRequestingAuthorization = true
            defer { isRequestingAuthorization = false }

            await healthKitStore.requestReadAuthorization()
            await loadHomeMetricSummaries()
        }
    }

    private func openSettingsAfterMealSheet() {
        isShowingMealLogger = false
        mealBeingEdited = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            isShowingSettings = true
        }
    }

    private func syncHealthDeltas() {
        selectedAppTab = .sync

        if HealthSyncAutomation.shouldStartSignInBeforeManualSync(
            allowLiveHealthData: allowLiveHealthData,
            allowHostedBackend: allowHostedBackend,
            backendURLString: backendURLString,
            isSignedIn: loginModel.isSignedIn,
            isSigningIn: loginModel.isSigningIn
        ) {
            loginModel.signIn()
            return
        }

        startSync()
    }

    private func handleDeepLink(_ url: URL) {
        if let actionName = FitnessCoachDeepLink.actionName(from: url) {
            openNutritionAction(actionName)
            return
        }

        if let metricName = FitnessCoachDeepLink.metricName(from: url) {
            openMetricChart(metricName: metricName)
        }
    }

    private func openNutritionAction(_ actionName: String) {
        selectedAppTab = .today
        navigationPath = NavigationPath()
        switch actionName {
        case "log":
            mealLogInitialDate = Date()
            mealLogInitialPrompt = ""
            isShowingMealLogger = true
        default:
            pendingNutritionAction = actionName
        }
    }

    private func openMetricChart(metricName: String) {
        guard HealthKitStore.firstSliceReadDescriptors.contains(where: {
            $0.metricName == metricName
        }) else {
            return
        }

        selectedAppTab = .metrics
        navigationPath = NavigationPath()
        navigationPath.append(metricName)
    }

    private func publishNutritionSnapshot(now: Date = Date()) {
        let totals = mealLogStore.totals(on: now)
        let targets = coachProfileStore.profile.map(NutritionTargetCalculator.targets(for:))
        let nextMeal = nextPlannedMeal(now: now)
        let latestCheckIn = eatingCheckInStore.latest(on: now)
        let snapshot = NutritionCoachSnapshot(
            localDate: StepSnapshot.localDateString(for: now),
            timezoneIdentifier: TimeZone.current.identifier,
            actualCalories: Int(totals.calories.rounded()),
            calorieTarget: targets?.selectedCalories,
            actualProtein: Int(totals.proteinGrams.rounded()),
            proteinTarget: targets?.proteinGrams,
            nextPlannedMealTitle: nextMeal?.title,
            nextPlannedMealTime: nextMeal?.plannedTime,
            latestHunger: latestCheckIn?.hungerBefore,
            quickAction: nextMeal == nil ? "checkin" : "confirm",
            updatedAt: now
        )
        NutritionCoachSnapshotStore.save(snapshot)
        watchSyncBridge?.publishNutritionSnapshot(snapshot)
        WidgetCenter.shared.reloadTimelines(ofKind: StepSnapshotStore.widgetKind)
    }

    private func nextPlannedMeal(now: Date = Date()) -> PlannedMealDTO? {
        let currentMinutes = Calendar.current.component(.hour, from: now) * 60
            + Calendar.current.component(.minute, from: now)
        let meals = mealPlanStore.response?.plan.meals ?? []
        let candidates = meals
            .filter { $0.linkedMealLogId == nil }
            .filter { !["skipped", "replaced", "confirmed", "eaten_as_planned", "partially_eaten"].contains($0.status) }
            .sorted { lhs, rhs in
                let lhsTime = minutes(from: lhs.plannedTime) ?? Int.max
                let rhsTime = minutes(from: rhs.plannedTime) ?? Int.max
                if lhsTime == rhsTime {
                    return lhs.sortOrder < rhs.sortOrder
                }
                return lhsTime < rhsTime
            }
        return candidates.first { (minutes(from: $0.plannedTime) ?? Int.max) >= currentMinutes }
            ?? candidates.first
    }

    private func minutes(from text: String?) -> Int? {
        guard let text else {
            return nil
        }
        let parts = text.split(separator: ":")
        guard parts.count == 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]) else {
            return nil
        }
        return hour * 60 + minute
    }

    private func autoSyncOnForegroundIfNeeded(now: Date = Date()) {
        guard HealthSyncAutomation.shouldAutoSyncOnForeground(
            isEnabled: autoSyncOnForeground,
            isUITestMode: ProcessInfo.processInfo.environment["FITNESS_UI_TEST_MODE"] == "1",
            authorizationSummary: healthKitStore.authorizationSummary,
            isRequestingAuthorization: isRequestingAuthorization,
            isSyncing: isSyncing,
            allowLiveHealthData: allowLiveHealthData,
            allowHostedBackend: allowHostedBackend,
            backendURLString: backendURLString,
            lastAttemptAt: lastForegroundAutoSyncAttemptAt,
            now: now
        ) else {
            return
        }
        guard loginModel.isSignedIn else {
            return
        }

        lastForegroundAutoSyncAttemptAt = now
        startSync()
    }

    @MainActor
    private func handleAppBecameActive() async {
        loginModel.refresh()
        if loginModel.isSignedIn {
            healthKitStore.clearSignInRequiredSyncFailure()
        }
        await notificationSettings.refresh()
        await syncCoachProfileIfNeeded()
        autoSyncOnForegroundIfNeeded()
        await loadHomeMetricSummaries()
        await refreshMealMetadataFromServer()
    }

    private func applyActiveSyncDefaultsIfNeeded() {
        guard !didApplyActiveSyncDefaults else {
            return
        }

        autoSyncOnForeground = true
        didApplyActiveSyncDefaults = true
    }

    private func startSync() {
        Task { @MainActor in
            guard !isSyncing else { return }

            isSyncing = true
            defer { isSyncing = false }

            await healthSyncLiveActivityController.start(
                title: "Syncing Apple Health",
                detail: "Reading Apple Health data."
            )
            await healthKitStore.syncFirstSliceDeltas()
            let syncResult = healthKitStore.lastSyncResult
            if syncResult == .alreadyRunning {
                await healthSyncLiveActivityController.showAlreadyRunning(
                    progress: healthKitStore.syncProgress
                )
            } else {
                await healthSyncLiveActivityController.end(result: syncResult)
            }
            loginModel.refresh()
            let didCheckRemoteCoachProfile = await syncCoachProfileIfNeeded(force: true)
            await loadHomeMetricSummaries()
            await refreshMealMetadataFromServer()

            if HealthSyncAutomation.shouldStartSignInBeforeManualSync(
                allowLiveHealthData: allowLiveHealthData,
                allowHostedBackend: allowHostedBackend,
                backendURLString: backendURLString,
                isSignedIn: loginModel.isSignedIn,
                isSigningIn: loginModel.isSigningIn
            ), syncResult?.requiresGoogleSignIn == true {
                loginModel.signIn()
            } else if !loginModel.isSignedIn || didCheckRemoteCoachProfile {
                offerCoachSetupAfterSyncIfNeeded()
            }
        }
    }

    @MainActor
    @discardableResult
    private func syncCoachProfileIfNeeded(
        now: Date = Date(),
        force: Bool = false
    ) async -> Bool {
        guard loginModel.isSignedIn,
              !isSyncingCoachProfile,
              !isShowingCoachSetup else {
            return false
        }

        if !force,
           let lastCoachProfileSyncAt,
           now.timeIntervalSince(lastCoachProfileSyncAt) < 10 * 60 {
            return true
        }

        isSyncingCoachProfile = true
        lastCoachProfileSyncAt = now
        defer { isSyncingCoachProfile = false }

        do {
            if let localProfile = coachProfileStore.profile {
                _ = try await coachProfileClient.upsertProfile(localProfile)
            }

            guard let remoteProfile = try await coachProfileClient.getProfile(),
                  let profile = remoteProfile.coachProfile() else {
                return true
            }

            if shouldApplyRemoteProfile(remoteProfile, over: coachProfileStore.profile) {
                coachProfileStore.save(profile)
                MealReminderScheduler.scheduleReminders(for: profile)
            }

            return true
        } catch {
            // Coach profile remains local-first; foreground activation retries later.
            lastCoachProfileSyncAt = nil
            return false
        }
    }

    @MainActor
    private func uploadCoachProfile(_ profile: CoachProfile) {
        lastCoachProfileSyncAt = nil

        Task {
            try? await coachProfileClient.upsertProfile(profile)
        }
    }

    private func writeNutritionToAppleHealth(date: Date, totals: MacroTotals) {
        guard !isWritingNutritionToHealth else {
            return
        }

        isWritingNutritionToHealth = true
        nutritionWritebackMessage = nil

        Task { @MainActor in
            defer { isWritingNutritionToHealth = false }

            do {
                let result = try await healthKitStore.writeNutritionTotalsToAppleHealth(
                    totals,
                    on: date
                )
                nutritionWritebackMessage = result.displayText
            } catch {
                nutritionWritebackMessage = error.localizedDescription
            }
        }
    }

    private func shouldApplyRemoteProfile(
        _ remoteProfile: RemoteCoachProfile,
        over localProfile: CoachProfile?
    ) -> Bool {
        guard let localProfile else {
            return true
        }

        guard let remoteUpdatedAt = remoteProfile.updatedDate else {
            return false
        }

        return remoteUpdatedAt > localProfile.completedAt
    }

    @MainActor
    private func syncMealMetadataIfNeeded(now: Date = Date(), force: Bool = false) async {
        guard loginModel.isSignedIn,
              !isSyncingMealMetadata else {
            return
        }

        if !force,
           let lastMealMetadataSyncAt,
           now.timeIntervalSince(lastMealMetadataSyncAt) < 5 * 60 {
            return
        }

        isSyncingMealMetadata = true
        lastMealMetadataSyncAt = now
        defer { isSyncingMealMetadata = false }

        do {
            await flushPendingMealDeletes()

            if !force {
                for meal in mealLogStore.meals.prefix(120) {
                    try await mealPersistenceClient.upsertMeal(meal)
                }

                for template in savedMealStore.templates.prefix(30) {
                    try await mealPersistenceClient.upsertTemplate(template)
                }
            }

            if force {
                let calendar = Calendar.current
                let to = calendar.date(
                    byAdding: .day,
                    value: 14,
                    to: now
                ) ?? now.addingTimeInterval(14 * 24 * 60 * 60)
                let from = Calendar.current.date(
                    byAdding: .day,
                    value: -45,
                    to: now
                ) ?? now.addingTimeInterval(-45 * 24 * 60 * 60)
                let remoteMeals = try await mealPersistenceClient.listMeals(from: from, to: to)
                mealLogStore.replaceRemote(remoteMeals, from: from, to: to)
                mealRefreshStatusText = mealRefreshStatus(
                    mealCount: remoteMeals.count,
                    now: now,
                    scope: "server range"
                )
            } else {
                let remoteMeals = try await mealPersistenceClient.listRecentMeals(days: 45)
                mealLogStore.mergeRemote(remoteMeals)
            }

            let remoteTemplates = try await mealPersistenceClient.listTemplates()
            savedMealStore.mergeRemote(remoteTemplates)
        } catch {
            // Meal logging remains local-first; the next foreground activation retries.
            lastMealMetadataSyncAt = nil
            mealRefreshStatusText = "Food Log refresh failed: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func refreshMealMetadataFromServer(now: Date = Date()) async {
        await syncMealMetadataIfNeeded(now: now, force: true)
    }

    @MainActor
    private func refreshMealDayFromServer(_ day: Date) async {
        guard loginModel.isSignedIn,
              !isSyncingMealMetadata else {
            return
        }

        isSyncingMealMetadata = true
        lastMealMetadataSyncAt = Date()
        defer { isSyncingMealMetadata = false }

        let calendar = Calendar.current
        let timezone = calendar.timeZone
        let localDate = MealPersistenceDate.localDateString(day, calendar: calendar)
        let startOfDay = calendar.startOfDay(for: day)
        let endOfDay = calendar.date(byAdding: .day, value: 1, to: startOfDay) ??
            startOfDay.addingTimeInterval(24 * 60 * 60)

        do {
            await flushPendingMealDeletes()

            let remoteMeals = try await mealPersistenceClient.listMeals(
                on: day,
                calendar: calendar,
                timezone: timezone
            )
            mealLogStore.replaceRemote(remoteMeals, from: startOfDay, to: endOfDay)
            mealRefreshStatusText = mealRefreshStatus(
                mealCount: remoteMeals.count,
                now: Date(),
                scope: "\(localDate) \(timezone.identifier)"
            )
        } catch {
            lastMealMetadataSyncAt = nil
            mealRefreshStatusText = "Food Log refresh failed: \(localDate): \(error.localizedDescription)"
        }
    }

    @MainActor
    private func flushPendingMealDeletes() async {
        for mealId in mealLogStore.pendingDeletedMealIds {
            do {
                try await mealPersistenceClient.deleteMeal(id: mealId)
                mealLogStore.markRemoteDeleteCompleted(mealId: mealId)
            } catch MealPersistenceClientError.rejected(let statusCode, _) where statusCode == 404 {
                mealLogStore.markRemoteDeleteCompleted(mealId: mealId)
            } catch {
                print("Food Log pending delete failed for \(mealId): \(error.localizedDescription)")
            }
        }
    }

    private func mealRefreshStatus(
        mealCount: Int,
        now: Date,
        scope: String
    ) -> String {
        let time = now.formatted(date: .omitted, time: .standard)
        let mealLabel = mealCount == 1 ? "meal" : "meals"

        return "Last server refresh \(time): \(mealCount) \(mealLabel), \(scope)"
    }

    private func deleteMeal(_ meal: MealLogEntry) {
        mealLogStore.delete(meal)

        Task {
            do {
                try await mealPersistenceClient.deleteMeal(meal)
                await MainActor.run {
                    mealLogStore.markRemoteDeleteCompleted(mealId: meal.id)
                }
            } catch {
                // Keep the local tombstone so the next metadata sync retries and
                // does not resurrect the remote meal.
            }
        }
    }

    private func deleteIngredient(_ ingredient: MealIngredientEntry, from meal: MealLogEntry) {
        var updatedMeal = meal
        updatedMeal.ingredients.removeAll { $0.id == ingredient.id }
        updatedMeal.totals = updatedMeal.ingredients.map(\.totals).reduce(.zero, +)
        updatedMeal.estimateStatus = updatedMeal.ingredients.isEmpty ? .manual : meal.estimateStatus
        updatedMeal.estimateConfidence = updatedMeal.ingredients.isEmpty ? nil : meal.estimateConfidence

        let storedMeal = mealLogStore.updateMetadata(updatedMeal)

        Task {
            try? await mealPersistenceClient.upsertMeal(storedMeal)
        }
    }

    private func reorderMeals(_ meals: [MealLogEntry], on date: Date) {
        let changedMeals = mealLogStore.reorderMeals(meals, on: date)
        guard !changedMeals.isEmpty else {
            return
        }

        Task {
            for meal in changedMeals {
                try? await mealPersistenceClient.upsertMeal(meal)
            }
        }
    }

    private func reorderIngredients(_ ingredients: [MealIngredientEntry], in meal: MealLogEntry) {
        let storedMeal = mealLogStore.reorderIngredients(ingredients, in: meal)

        Task {
            try? await mealPersistenceClient.upsertMeal(storedMeal)
        }
    }

    private func moveIngredient(_ ingredientID: UUID, to targetMeal: MealLogEntry) {
        let changedMeals = mealLogStore.moveIngredient(ingredientID, to: targetMeal.id)
        guard !changedMeals.isEmpty else {
            return
        }

        Task {
            for meal in changedMeals {
                try? await mealPersistenceClient.upsertMeal(meal)
            }
        }
    }

    private func applyQuietNotificationDefaultsIfNeeded() {
        guard !didApplyQuietNotificationDefaults else {
            return
        }

        completionNotificationsEnabled = false
        staleSyncRemindersEnabled = false
        notificationSettings.cancelAllHealthSyncNotifications()
        quietMealRemindersIfNeeded()
        didApplyQuietNotificationDefaults = true
    }

    private func quietMealRemindersIfNeeded(now: Date = Date()) {
        guard let profile = coachProfileStore.profile else {
            MealReminderScheduler.cancelAllReminders()
            return
        }

        guard profile.mealRemindersEnabled ||
              profile.effectiveMealSlots.contains(where: \.remindersEnabled) else {
            MealReminderScheduler.cancelAllReminders()
            return
        }

        let quietProfile = profile.disablingLocalReminders(now: now)

        coachProfileStore.save(quietProfile)
        MealReminderScheduler.scheduleReminders(for: quietProfile)
        uploadCoachProfile(quietProfile)
    }

    @MainActor
    private func loadHomeMetricSummaries(now: Date = Date()) async {
        guard healthKitStore.authorizationSummary.isReady else {
            homeMetricSummaries = []
            homeMetricError = nil
            isLoadingHomeMetrics = false
            publishStepSnapshot(.permissionNeeded(now: now))
            publishDashboardSnapshot(.permissionNeeded(now: now))
            return
        }

        isLoadingHomeMetrics = true
        homeMetricError = nil
        defer { isLoadingHomeMetrics = false }

        do {
            var summaries: [HomeMetricSummary] = []
            var defaults = CoachHealthDefaults()

            for descriptor in HealthKitStore.firstSliceReadDescriptors {
                let metricName = descriptor.metricName
                let points = try await healthKitStore.metricChartPoints(
                    for: descriptor,
                    days: 30,
                    now: now
                )

                if metricName == "weight" {
                    defaults.weightKg = points.sorted { $0.date < $1.date }.last?.value
                } else if metricName == "steps" {
                    defaults.averageStepsPerDay = HomeMetricAnalysis.averageValue(
                        from: points,
                        endingAt: now,
                        days: 30,
                        calendar: .current
                    )
                    publishStepSnapshot(
                        Self.stepSnapshot(
                            from: points,
                            now: now,
                            calendar: .current
                        )
                    )
                } else if metricName == "active_energy" {
                    defaults.averageActiveCaloriesPerDay = HomeMetricAnalysis.averageValue(
                        from: points,
                        endingAt: now,
                        days: 30,
                        calendar: .current
                    )
                } else if metricName == "resting_energy" {
                    defaults.averageRestingCaloriesPerDay = HomeMetricAnalysis.averageValue(
                        from: points,
                        endingAt: now,
                        days: 30,
                        calendar: .current
                    )
                }

                summaries.append(
                    HomeMetricAnalysis.summary(
                        for: descriptor,
                        points: points,
                        now: now,
                        calendar: .current
                    )
                )
            }

            homeMetricSummaries = summaries
            coachHealthDefaults = defaults
            publishDashboardSnapshot(Self.dashboardSnapshot(from: summaries, now: now))
        } catch {
            homeMetricSummaries = []
            coachHealthDefaults = CoachHealthDefaults()
            homeMetricError = error.localizedDescription
            publishStepSnapshot(.failed(now: now))
            publishDashboardSnapshot(.failed(now: now))
        }
    }

    private func publishStepSnapshot(_ snapshot: StepSnapshot) {
        StepSnapshotStore.save(snapshot)
        WidgetCenter.shared.reloadTimelines(ofKind: StepSnapshotStore.widgetKind)
        watchSyncBridge?.publishStepSnapshot(snapshot)
    }

    private func publishDashboardSnapshot(_ snapshot: HealthDashboardSnapshot) {
        HealthDashboardSnapshotStore.save(snapshot)
        WidgetCenter.shared.reloadTimelines(ofKind: HealthDashboardSnapshotStore.widgetKind)
        watchSyncBridge?.publishDashboardSnapshot(snapshot)
    }

    private func updateSyncLiveActivity(progress: HealthKitSyncProgress?) {
        Task { @MainActor in
            await healthSyncLiveActivityController.update(progress: progress)
        }
    }

    private static func stepSnapshot(
        from points: [HealthMetricChartPoint],
        now: Date,
        calendar: Calendar
    ) -> StepSnapshot {
        let sortedPoints = points.sorted { $0.date < $1.date }

        guard let selectedPoint = sortedPoints.last(where: {
            calendar.isDate($0.date, inSameDayAs: now)
        }) ?? sortedPoints.last else {
            return .noData(now: now)
        }

        return StepSnapshot(
            state: .ready,
            stepCount: Int(selectedPoint.value.rounded()),
            sevenDayAverage: HomeMetricAnalysis.averageValue(
                from: sortedPoints,
                endingAt: now,
                days: 7,
                calendar: calendar
            ).map { Int($0.rounded()) },
            localDate: StepSnapshot.localDateString(for: selectedPoint.date),
            timezoneIdentifier: TimeZone.current.identifier,
            sourceDate: selectedPoint.date,
            updatedAt: now
        )
    }

    private static func dashboardSnapshot(
        from summaries: [HomeMetricSummary],
        now: Date
    ) -> HealthDashboardSnapshot {
        HealthDashboardSnapshot.ready(
            metrics: summaries.enumerated().map { index, summary in
                summary.dashboardMetric(sortOrder: index + 1)
            },
            now: now
        )
    }

    private func offerCoachSetupAfterSyncIfNeeded() {
        guard coachProfileStore.profile == nil,
              !didOfferCoachSetupThisSession,
              healthKitStore.lastSyncResult?.shortStatus == "Synced" else {
            return
        }

        didOfferCoachSetupThisSession = true
        isShowingCoachSetup = true
    }

    private func requestNotifications() {
        Task { @MainActor in
            await notificationSettings.requestAuthorization()
        }
    }

    private var backendDisplayText: String {
        guard let url = URL(string: backendURLString),
              let host = url.host else {
            return "Not configured"
        }

        return host
    }

    private var liveUploadDisplayText: String {
        if allowLiveHealthData && allowHostedBackend {
            return loginModel.isSignedIn ? "Enabled" : "Sign in required"
        }

        return "Disabled"
    }
}

private enum FitnessAppTab: Hashable {
    case today
    case metrics
    case sync
    case coach

    var title: String {
        switch self {
        case .today:
            return "Today"
        case .metrics:
            return "Metrics"
        case .sync:
            return "Sync"
        case .coach:
            return "Coach"
        }
    }

    var systemImage: String {
        switch self {
        case .today:
            return "house.fill"
        case .metrics:
            return "chart.line.uptrend.xyaxis"
        case .sync:
            return "arrow.triangle.2.circlepath"
        case .coach:
            return "figure.strengthtraining.traditional"
        }
    }
}

private struct SyncCenterHeader: View {
    let isSyncing: Bool
    let canSync: Bool
    let onSync: () -> Void

    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 4) {
                Text("FITNESS")
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.lime)
                Text(AppBuildInfo.displayText)
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.secondaryText)
                Text("Today")
                    .font(.system(size: 30, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.72)
            }

            Spacer(minLength: 12)

            Button(action: onSync) {
                Image(systemName: isSyncing ? "arrow.triangle.2.circlepath" : "arrow.clockwise")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(canSync ? FitnessTheme.lime : FitnessTheme.secondaryText.opacity(0.55))
                    .frame(width: 44, height: 44)
                    .background(FitnessTheme.cardFill, in: Circle())
                    .overlay(Circle().stroke(FitnessTheme.cardStroke, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(isSyncing || !canSync)
            .accessibilityLabel("Sync Health Deltas")
        }
    }
}

private struct HomeOverviewCard: View {
    let authorizationSummary: HealthKitAuthorizationSummary
    @ObservedObject var healthKitStore: HealthKitStore
    let summaries: [HomeMetricSummary]
    let isLoading: Bool
    let errorMessage: String?
    let onRequestAccess: () -> Void

    private let columns = [
        GridItem(.flexible(), spacing: 10),
        GridItem(.flexible(), spacing: 10),
    ]

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                SectionHeader(title: "Dashboard", trailing: trailingText)

                if !authorizationSummary.isReady {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Connect Apple Health to show weight, steps, activity, and sleep here.")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(FitnessTheme.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)

                        Button(action: onRequestAccess) {
                            ActionButtonLabel(
                                title: authorizationSummary.readAccessButtonTitle,
                                systemImage: "heart.text.square"
                            )
                        }
                        .buttonStyle(SecondaryActionButtonStyle())
                    }
                } else if isLoading && summaries.isEmpty {
                    HStack(spacing: 10) {
                        ProgressView()
                            .controlSize(.small)
                            .tint(FitnessTheme.lime)
                        Text("Loading HealthKit summary")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(FitnessTheme.secondaryText)
                    }
                    .frame(maxWidth: .infinity, minHeight: 96, alignment: .center)
                } else if let errorMessage {
                    Text(errorMessage)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(FitnessTheme.error)
                        .fixedSize(horizontal: false, vertical: true)
                } else if summaries.isEmpty {
                    Text("No local HealthKit summary data yet.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(FitnessTheme.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    LazyVGrid(columns: columns, spacing: 10) {
                        ForEach(summaries) { summary in
                            if let descriptor = HealthKitStore.firstSliceReadDescriptors.first(where: {
                                $0.metricName == summary.metricName
                            }) {
                                NavigationLink {
                                    MetricDetailView(
                                        descriptor: descriptor,
                                        healthKitStore: healthKitStore
                                    )
                                } label: {
                                    HomeMetricTile(summary: summary)
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("homeMetricTile.\(summary.metricName)")
                            } else {
                                HomeMetricTile(summary: summary)
                            }
                        }
                    }
                }
            }
        }
    }

    private var trailingText: String {
        if isLoading {
            return "Refreshing"
        }

        return authorizationSummary.isReady ? "Local" : authorizationSummary.shortStatus
    }
}

private struct HomeMetricTile: View {
    let summary: HomeMetricSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: summary.systemImage)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(summary.accentColor)
                    .frame(width: 24, height: 24)
                    .background(summary.accentColor.opacity(0.12), in: Circle())
                    .accessibilityHidden(true)

                Text(summary.title)
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)

                Spacer(minLength: 2)

                Image(systemName: "chevron.right.circle.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(summary.accentColor.opacity(0.9))
                    .accessibilityHidden(true)
            }

            Text(summary.valueText)
                .font(.system(size: 23, weight: .black, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.65)

            Text(summary.caption)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(FitnessTheme.secondaryText)
                .lineLimit(2)
                .minimumScaleFactor(0.72)

            if let detailText = summary.detailText {
                Text(detailText)
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(summary.accentColor)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 128, alignment: .topLeading)
        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(FitnessTheme.cardStroke, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(summary.accessibilityText)
        .accessibilityAddTraits(.isButton)
    }
}

struct HomeMetricSummary: Identifiable {
    let metricName: String
    let title: String
    let valueText: String
    let caption: String
    let detailText: String?
    let systemImage: String
    let accentColor: Color
    let accentColorName: HealthDashboardMetric.AccentColorName

    var id: String { metricName }

    var accessibilityText: String {
        [
            title,
            valueText,
            caption,
            detailText,
        ]
        .compactMap { $0 }
        .joined(separator: ", ")
    }

    func dashboardMetric(sortOrder: Int) -> HealthDashboardMetric {
        HealthDashboardMetric(
            metricName: metricName,
            title: title,
            valueText: valueText,
            caption: caption,
            detailText: detailText,
            systemImage: systemImage,
            accentColorName: accentColorName,
            sortOrder: sortOrder
        )
    }
}

enum HomeMetricAnalysis {
    static func summary(
        for descriptor: HealthKitMetricDescriptor,
        points: [HealthMetricChartPoint],
        now: Date,
        calendar: Calendar
    ) -> HomeMetricSummary {
        let sortedPoints = points.sorted { $0.date < $1.date }
        let latest = sortedPoints.last
        let today = sortedPoints.last {
            calendar.isDate($0.date, inSameDayAs: now)
        }

        switch descriptor.metricName {
        case "weight":
            return metricSummary(
                descriptor: descriptor,
                valuePoint: latest,
                caption: latest.map { "Latest • \(shortDate($0.date))" } ?? "No local weight",
                detail: weightDeltaText(from: sortedPoints, latest: latest, calendar: calendar)
            )
        case "steps":
            let valuePoint = today ?? latest
            return metricSummary(
                descriptor: descriptor,
                valuePoint: valuePoint,
                caption: today == nil
                    ? latest.map { "Latest • \(shortDate($0.date))" } ?? "No local steps"
                    : "Today",
                detail: averageText(
                    from: sortedPoints,
                    endingAt: now,
                    days: 7,
                    unit: descriptor.normalizedUnit,
                    calendar: calendar
                )
            )
        case "active_energy":
            return averageSummary(
                descriptor: descriptor,
                points: sortedPoints,
                now: now,
                calendar: calendar,
                emptyCaption: "No active energy"
            )
        case "sleep":
            return averageSummary(
                descriptor: descriptor,
                points: sortedPoints,
                now: now,
                calendar: calendar,
                emptyCaption: "No sleep data"
            )
        default:
            return metricSummary(
                descriptor: descriptor,
                valuePoint: latest,
                caption: latest.map { "Latest • \(shortDate($0.date))" } ?? "No local data",
                detail: nil
            )
        }
    }

    private static func averageSummary(
        descriptor: HealthKitMetricDescriptor,
        points: [HealthMetricChartPoint],
        now: Date,
        calendar: Calendar,
        emptyCaption: String
    ) -> HomeMetricSummary {
        guard let latest = points.last else {
            return metricSummary(
                descriptor: descriptor,
                valueText: "No data",
                caption: emptyCaption,
                detail: nil
            )
        }

        let average = averageValue(
            from: points,
            endingAt: now,
            days: 7,
            calendar: calendar
        ) ?? latest.value
        let today = points.last {
            calendar.isDate($0.date, inSameDayAs: now)
        }

        return metricSummary(
            descriptor: descriptor,
            valueText: formatMetricValue(average, unit: descriptor.normalizedUnit),
            caption: "1W avg",
            detail: today.map {
                "Today \(formatMetricValue($0.value, unit: descriptor.normalizedUnit))"
            }
        )
    }

    private static func metricSummary(
        descriptor: HealthKitMetricDescriptor,
        valuePoint: HealthMetricChartPoint?,
        caption: String,
        detail: String?
    ) -> HomeMetricSummary {
        metricSummary(
            descriptor: descriptor,
            valueText: valuePoint.map {
                formatMetricValue($0.value, unit: descriptor.normalizedUnit)
            } ?? "No data",
            caption: caption,
            detail: detail
        )
    }

    private static func metricSummary(
        descriptor: HealthKitMetricDescriptor,
        valueText: String,
        caption: String,
        detail: String?
    ) -> HomeMetricSummary {
        HomeMetricSummary(
            metricName: descriptor.metricName,
            title: descriptor.dashboardTitle,
            valueText: valueText,
            caption: caption,
            detailText: detail,
            systemImage: descriptor.systemImage,
            accentColor: descriptor.accentColor,
            accentColorName: descriptor.accentColorName
        )
    }

    private static func averageText(
        from points: [HealthMetricChartPoint],
        endingAt date: Date,
        days: Int,
        unit: String,
        calendar: Calendar
    ) -> String? {
        guard let average = averageValue(
            from: points,
            endingAt: date,
            days: days,
            calendar: calendar
        ) else {
            return nil
        }

        return "\(compactPeriodLabel(days: days)) avg \(formatMetricValue(average, unit: unit))"
    }

    static func averageValue(
        from points: [HealthMetricChartPoint],
        endingAt date: Date,
        days: Int,
        calendar: Calendar
    ) -> Double? {
        let endDay = calendar.startOfDay(for: date)
        let windowStart = calendar.date(
            byAdding: .day,
            value: -max(0, days - 1),
            to: endDay
        ) ?? endDay
        let windowPoints = points.filter {
            $0.date >= windowStart && $0.date <= date
        }

        guard !windowPoints.isEmpty else {
            return nil
        }

        return windowPoints.map(\.value).reduce(0, +) / Double(windowPoints.count)
    }

    private static func weightDeltaText(
        from points: [HealthMetricChartPoint],
        latest: HealthMetricChartPoint?,
        calendar: Calendar
    ) -> String? {
        guard let latest,
              let target = calendar.date(byAdding: .day, value: -7, to: latest.date),
              let comparison = points.filter({ $0.date < latest.date }).min(by: {
                abs($0.date.timeIntervalSince(target)) < abs($1.date.timeIntervalSince(target))
              }) else {
            return nil
        }

        let delta = latest.value - comparison.value

        guard abs(delta) >= 0.05 else {
            return "0 kg vs 1W"
        }

        return "\(delta > 0 ? "+" : "-")\(formatMetricValue(abs(delta), unit: "kg")) vs 1W"
    }

    private static func compactPeriodLabel(days: Int) -> String {
        switch days {
        case 3:
            return "3D"
        case 7:
            return "1W"
        case 14:
            return "2W"
        case 30:
            return "1M"
        default:
            return "\(days)D"
        }
    }

    private static func formatMetricValue(_ value: Double, unit: String) -> String {
        switch unit {
        case "count":
            return value.rounded().formatted(.number.precision(.fractionLength(0)))
        case "kcal":
            return "\(value.rounded().formatted(.number.precision(.fractionLength(0)))) kcal"
        case "minute":
            let totalMinutes = max(0, Int(value.rounded()))
            let hours = totalMinutes / 60
            let minutes = totalMinutes % 60

            return "\(hours)h \(minutes)m"
        case "bpm":
            return "\(value.rounded().formatted(.number.precision(.fractionLength(0)))) bpm"
        default:
            return "\(formatValue(value)) \(unit)"
        }
    }

    private static func shortDate(_ date: Date) -> String {
        date.formatted(.dateTime.month(.abbreviated).day().year(.twoDigits))
    }
}

private struct CoachTargetCard: View {
    let profile: CoachProfile?
    let healthDefaults: CoachHealthDefaults
    let onSetup: () -> Void

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                SectionHeader(title: "Coach Plan", trailing: profile == nil ? "Setup" : "Active")

                if let profile {
                    let targets = NutritionTargetCalculator.targets(for: profile)

                    VStack(alignment: .leading, spacing: 12) {
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(profile.goal.displayName)
                                    .font(.system(size: 22, weight: .black, design: .rounded))
                                    .foregroundStyle(.white)
                                Text(profile.goal.targetCaption)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(FitnessTheme.secondaryText)
                            }

                            Spacer(minLength: 10)

                            Text("\(targets.selectedCalories) kcal")
                                .font(.system(size: 19, weight: .black, design: .rounded))
                                .foregroundStyle(FitnessTheme.lime)
                                .lineLimit(1)
                                .minimumScaleFactor(0.72)
                        }

                        HStack(spacing: 8) {
                            GoalTargetPill(title: "Lose", value: "\(targets.loseCalories)")
                            GoalTargetPill(title: "Keep", value: "\(targets.maintainCalories)")
                            GoalTargetPill(title: "Gain", value: "\(targets.gainCalories)")
                        }

                        VStack(spacing: 8) {
                            SummaryRow(title: "Protein", value: "\(targets.proteinGrams)g")
                            SummaryRow(title: "Fat", value: "\(targets.fatGrams)g")
                            SummaryRow(title: "Carbs", value: "\(targets.carbGrams)g")
                            SummaryRow(title: "Fiber", value: "\(targets.fiberGrams)g")
                        }

                        Button(action: onSetup) {
                            ActionButtonLabel(title: "Edit Questionnaire", systemImage: "slider.horizontal.3")
                        }
                        .buttonStyle(SecondaryActionButtonStyle())
                    }
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Answer a short setup so calories, macros, meal times, and reminders are tailored to your current data.")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(FitnessTheme.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)

                        if healthDefaults.weightKg != nil || healthDefaults.averageStepsPerDay != nil {
                            HStack(spacing: 8) {
                                if let weightKg = healthDefaults.weightKg {
                                    GoalTargetPill(title: "Weight", value: "\(formatValue(weightKg))kg")
                                }

                                if let steps = healthDefaults.averageStepsPerDay {
                                    GoalTargetPill(
                                        title: "Steps",
                                        value: steps.rounded().formatted(.number.precision(.fractionLength(0)))
                                    )
                                }
                            }
                        }

                        Button(action: onSetup) {
                            ActionButtonLabel(title: "Start Questionnaire", systemImage: "list.clipboard")
                        }
                        .buttonStyle(PrimaryActionButtonStyle())
                        .accessibilityIdentifier("coachSetupStart")
                    }
                }
            }
        }
    }
}

private struct GoalTargetPill: View {
    let title: String
    let value: String

    var body: some View {
        VStack(spacing: 3) {
            Text(title)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(FitnessTheme.secondaryText)
                .textCase(.uppercase)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Text(value)
                .font(.system(size: 14, weight: .black, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 9)
        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(FitnessTheme.cardStroke, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

private struct DailyMealPlanCard: View {
    @ObservedObject var store: DailyMealPlanStore
    @State private var selectedDate = Date()

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Daily Meal Plan")
                            .font(.headline.weight(.black))
                        Text("Planned intentions stay separate from logged food")
                            .font(.caption)
                            .foregroundStyle(FitnessTheme.secondaryText)
                    }
                    Spacer()
                    if store.isLoading {
                        ProgressView().tint(FitnessTheme.lime)
                    }
                }

                HStack(spacing: 10) {
                    Button { moveDay(-1) } label: {
                        Image(systemName: "chevron.left")
                    }
                    .accessibilityLabel("Previous meal plan date")
                    Spacer()
                    Button("\(selectedDate.formatted(date: .abbreviated, time: .omitted))") {
                        selectedDate = Date()
                        Task { await store.refresh(date: selectedDate) }
                    }
                    .font(.caption.weight(.bold))
                    .foregroundStyle(FitnessTheme.lime)
                    Spacer()
                    Button { moveDay(1) } label: {
                        Image(systemName: "chevron.right")
                    }
                    .accessibilityLabel("Next meal plan date")
                }

                if let response = store.response {
                    HStack(spacing: 8) {
                        PlanMacroChip(title: "Calories", value: response.plannedTotals.calories, unit: "kcal")
                        PlanMacroChip(title: "Protein", value: response.plannedTotals.proteinGrams, unit: "g")
                        PlanMacroChip(title: "Carbs", value: response.plannedTotals.carbsGrams, unit: "g")
                    }

                    ForEach(response.plan.meals.sorted { $0.sortOrder < $1.sortOrder }) { meal in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(alignment: .firstTextBaseline) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(meal.title).font(.subheadline.weight(.bold))
                                    Text("\(meal.plannedTime ?? "Time open") · \(meal.mealType)")
                                        .font(.caption2)
                                        .foregroundStyle(FitnessTheme.secondaryText)
                                }
                                Spacer()
                                Text("\(meal.calories, format: .number.precision(.fractionLength(0))) kcal")
                                    .font(.caption.monospacedDigit().weight(.bold))
                            }
                            Text(meal.displayStatus)
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(meal.linkedMealLogId == nil ? FitnessTheme.secondaryText : FitnessTheme.lime)

                            HStack(spacing: 6) {
                                MealStateBadge(title: "Planned", systemImage: "calendar", tint: FitnessTheme.cyan)
                                if meal.linkedMealLogId != nil {
                                    MealStateBadge(title: "Logged", systemImage: "checkmark.circle.fill", tint: FitnessTheme.lime)
                                }
                            }

                            if meal.linkedMealLogId == nil && meal.status != "skipped" {
                                HStack(spacing: 8) {
                                    planAction("Eaten", icon: "checkmark.circle.fill") {
                                        await store.consume(meal, fraction: 1)
                                    }
                                    planAction("Partial", icon: "circle.lefthalf.filled") {
                                        await store.consume(meal, fraction: 0.5)
                                    }
                                    planAction("Skip", icon: "forward.fill") {
                                        await store.skip(meal)
                                    }
                                }
                            }
                        }
                        .padding(10)
                        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(FitnessTheme.cardStroke, lineWidth: 1))
                    }
                } else if let message = store.message {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(FitnessTheme.secondaryText)
                }
            }
        }
        .accessibilityIdentifier("dailyMealPlanCard")
    }

    private func moveDay(_ offset: Int) {
        selectedDate = Calendar.current.date(byAdding: .day, value: offset, to: selectedDate) ?? selectedDate
        Task { await store.refresh(date: selectedDate) }
    }

    private func planAction(
        _ title: String,
        icon: String,
        operation: @escaping () async -> Void
    ) -> some View {
        Button {
            Task { await operation() }
        } label: {
            Label(title, systemImage: icon)
                .font(.caption2.weight(.bold))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(SecondaryActionButtonStyle())
        .disabled(store.isLoading)
    }
}

private struct PlanMacroChip: View {
    let title: String
    let value: Double
    let unit: String

    var body: some View {
        VStack(spacing: 3) {
            Text(title).font(.caption2.weight(.bold)).foregroundStyle(FitnessTheme.secondaryText)
            Text("\(value, format: .number.precision(.fractionLength(0))) \(unit)")
                .font(.caption.monospacedDigit().weight(.black))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 10))
    }
}

private struct MealStateBadge: View {
    let title: String
    let systemImage: String
    let tint: Color

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.caption2.weight(.black))
            .foregroundStyle(tint)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(tint.opacity(0.12), in: Capsule())
            .overlay(Capsule().stroke(tint.opacity(0.28), lineWidth: 1))
            .lineLimit(1)
            .minimumScaleFactor(0.82)
    }
}

private struct NutritionTodayCard: View {
    let profile: CoachProfile?
    @ObservedObject var mealStore: MealLogStore
    @ObservedObject var mealPlanStore: DailyMealPlanStore
    @ObservedObject var eatingCheckInStore: EatingCheckInStore
    let isWritingNutritionToHealth: Bool
    let writebackMessage: String?
    @Binding var pendingAction: String?
    let onSetup: () -> Void
    let onLogMeal: (Date) -> Void
    let onChangeDay: (Date, String) -> Void
    let onEditMeal: (MealLogEntry) -> Void
    let onDeleteMeal: (MealLogEntry) -> Void
    let onDeleteIngredient: (MealIngredientEntry, MealLogEntry) -> Void
    let onReorderMeals: ([MealLogEntry], Date) -> Void
    let onReorderIngredients: ([MealIngredientEntry], MealLogEntry) -> Void
    let onMoveIngredientToMeal: (UUID, MealLogEntry) -> Void
    let onWriteNutritionToHealth: (Date, MacroTotals) -> Void
    let refreshStatusText: String?
    let onRefreshDay: (Date) async -> Void
    @State private var selectedDay = Date()
    @State private var isConfirmingHealthWriteback = false
    @State private var selectedBreakdownMacro: NutritionBreakdownMacro?
    @State private var isShowingDayReview = false
    @State private var isShowingDayChangePrompt = false
    @State private var dayChangeRequest = ""
    @State private var pendingIngredientDeletion: PendingIngredientDeletion?
    @State private var draggingMealID: UUID?
    @State private var draggingIngredientID: UUID?
    @State private var dropTargetMealID: UUID?
    @State private var dropTargetIngredientID: UUID?
    @State private var isRefreshingFoodLog = false
    @State private var isShowingQuickCheckIn = false
    @State private var isShowingUrgeSupport = false
    @State private var isShowingRecoveryFlow = false
    @State private var isShowingPlanToday = false
    @State private var isShowingWeeklyInsights = false
    @State private var adjustingPlannedMeal: PlannedMealDTO?
    @State private var movingPlannedMeal: PlannedMealDTO?
    @State private var replacingPlannedMeal: PlannedMealDTO?
    @State private var selectedCheckInMeal: MealLogEntry?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            FoodLogStickyHeader(
                mealCount: displayedMeals.count,
                isRefreshing: isRefreshingFoodLog,
                pager: NutritionDayPager(
                    date: selectedDay,
                    canMoveForward: canMoveForward,
                    onPrevious: {
                        moveDay(by: -1)
                    },
                    onNext: {
                        moveDay(by: 1)
                    },
                    onToday: {
                        selectedDay = Date()
                    }
                )
            ) {
                Task {
                    await refreshSelectedDay()
                }
            }

            if let refreshStatusText {
                Text(refreshStatusText)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    .lineLimit(2)
                    .padding(.horizontal, 2)
                    .accessibilityIdentifier("foodLogRefreshStatus")
            }

            GlassCard {
                VStack(alignment: .leading, spacing: 14) {
                    if let profile {
                        let targets = NutritionTargetCalculator.targets(for: profile)
                        let totals = mealStore.totals(on: selectedDay)
                        let plannedMeals = planMeals
                        let plannedTotals = mealPlanStore.response?.plannedTotals ?? .zero
                        let checkIns = eatingCheckInStore.checkIns(on: selectedDay)

                        TodayNutritionOverviewSection(
                            totals: totals,
                            targets: targets,
                            plannedTotals: plannedTotals,
                            nextMeal: nextPlannedMeal,
                            latestCheckIn: checkIns.last
                        )

                        DailyCoachPanel(
                            totals: totals,
                            targets: targets,
                            nextMeal: nextPlannedMeal,
                            latestCheckIn: checkIns.last
                        )

                        HStack(spacing: 10) {
                            Button {
                                isShowingPlanToday = true
                            } label: {
                                ActionButtonLabel(title: "Plan Today", systemImage: "calendar.badge.plus")
                            }
                            .buttonStyle(PrimaryActionButtonStyle())

                            Button {
                                isShowingQuickCheckIn = true
                            } label: {
                                ActionButtonLabel(title: "Check In", systemImage: "square.and.pencil")
                            }
                            .buttonStyle(SecondaryActionButtonStyle())
                        }

                        Button {
                            isShowingUrgeSupport = true
                        } label: {
                            ActionButtonLabel(title: "I Want To Eat Right Now", systemImage: "pause.circle.fill")
                        }
                        .buttonStyle(SecondaryActionButtonStyle())

                        PlannedTodaySection(
                            meals: plannedMeals,
                            isLoading: mealPlanStore.isLoading,
                            message: mealPlanStore.message,
                            onAte: { meal in
                                await mealPlanStore.consume(meal, fraction: 1)
                                await refreshSelectedDay()
                            },
                            onAdjust: { meal in
                                adjustingPlannedMeal = meal
                            },
                            onReplace: { meal in
                                replacingPlannedMeal = meal
                            },
                            onSkip: { meal in
                                await mealPlanStore.skip(meal)
                            },
                            onMoveTime: { meal in
                                movingPlannedMeal = meal
                            }
                        )

                        if let writebackMessage {
                            Text(writebackMessage)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(FitnessTheme.secondaryText)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(10)
                                .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(FitnessTheme.cardStroke, lineWidth: 1)
                                )
                        }

                        EatenTodaySection(
                            totals: totals,
                            targets: targets,
                            rows: {
                                foodLogRows(totals: totals)
                            },
                            onMacroTap: { macro in
                                selectedBreakdownMacro = macro
                            }
                        )

                        PlanActualComparisonSection(
                            plannedMeals: plannedMeals,
                            actualMeals: displayedMeals,
                            plannedTotals: plannedTotals,
                            actualTotals: totals
                        )

                        DailyBehaviorTimelineSection(
                            plannedMeals: plannedMeals,
                            actualMeals: displayedMeals,
                            checkIns: checkIns
                        )

                        BehaviorCheckInSummarySection(
                            checkIns: checkIns,
                            lastSyncedAt: eatingCheckInStore.lastSyncedAt,
                            syncMessage: eatingCheckInStore.message,
                            onQuickCheckIn: {
                                isShowingQuickCheckIn = true
                            },
                            onUrge: {
                                isShowingUrgeSupport = true
                            },
                            onRecovery: {
                                isShowingRecoveryFlow = true
                            },
                            onWeeklyInsights: {
                                isShowingWeeklyInsights = true
                            },
                            onRetry: {
                                Task {
                                    await eatingCheckInStore.retryPending()
                                }
                            }
                        )

                        HStack(spacing: 10) {
                            Button {
                                onLogMeal(defaultLogDate)
                            } label: {
                                ActionButtonLabel(title: "Add Food", systemImage: "plus.circle.fill")
                            }
                            .buttonStyle(PrimaryActionButtonStyle())

                            Button {
                                dayChangeRequest = ""
                                isShowingDayChangePrompt = true
                            } label: {
                                ActionButtonLabel(title: "Adjust Day", systemImage: "wand.and.sparkles")
                            }
                            .buttonStyle(SecondaryActionButtonStyle())
                            .disabled(displayedMeals.isEmpty)
                        }

                        NavigationLink {
                            NutritionDashboardView(
                                mealStore: mealStore,
                                profile: profile,
                                onEditMeal: onEditMeal,
                                onDeleteMeal: onDeleteMeal
                            )
                        } label: {
                            ActionButtonLabel(title: "History", systemImage: "chart.bar.xaxis")
                        }
                        .buttonStyle(SecondaryActionButtonStyle())

                        Button {
                            isShowingDayReview = true
                        } label: {
                            ActionButtonLabel(title: "Review Day", systemImage: "sparkles")
                        }
                        .buttonStyle(SecondaryActionButtonStyle())
                        .disabled(displayedMeals.isEmpty)

                        Button {
                            isConfirmingHealthWriteback = true
                        } label: {
                            if isWritingNutritionToHealth {
                                HStack(spacing: 8) {
                                    ProgressView()
                                        .tint(FitnessTheme.lime)
                                    Text("Writing To Apple Health")
                                }
                                .frame(maxWidth: .infinity)
                            } else {
                                ActionButtonLabel(title: "Write To Apple Health", systemImage: "heart.text.square.fill")
                            }
                        }
                        .buttonStyle(SecondaryActionButtonStyle())
                        .disabled(displayedMeals.isEmpty || isWritingNutritionToHealth || totals.calories <= 0)
                        .confirmationDialog(
                            "Write daily nutrition to Apple Health?",
                            isPresented: $isConfirmingHealthWriteback,
                            titleVisibility: .visible
                        ) {
                            Button("Write Calories And Macros") {
                                onWriteNutritionToHealth(selectedDay, totals)
                            }
                            Button("Cancel", role: .cancel) {}
                        } message: {
                            Text("FitnessCoach will write this day's total calories, protein, carbs, fat, and fiber to Apple Health. Rewriting the same day replaces this app's previous writeback for that day.")
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Set targets before tracking calories and macros.")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(FitnessTheme.secondaryText)
                                .fixedSize(horizontal: false, vertical: true)

                            Button(action: onSetup) {
                                ActionButtonLabel(title: "Set Targets", systemImage: "target")
                            }
                            .buttonStyle(PrimaryActionButtonStyle())
                        }
                    }
                }
            }
        }
        .accessibilityIdentifier("nutritionTodayCard")
        .confirmationDialog(
            "Delete ingredient?",
            isPresented: Binding(
                get: {
                    pendingIngredientDeletion != nil
                },
                set: { isPresented in
                    if !isPresented {
                        pendingIngredientDeletion = nil
                    }
                }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete Ingredient", role: .destructive) {
                if let pendingIngredientDeletion {
                    onDeleteIngredient(
                        pendingIngredientDeletion.ingredient,
                        pendingIngredientDeletion.meal
                    )
                }
                pendingIngredientDeletion = nil
            }
            Button("Cancel", role: .cancel) {
                pendingIngredientDeletion = nil
            }
        } message: {
            if let pendingIngredientDeletion {
                Text("Remove \(pendingIngredientDeletion.ingredient.name) from \(pendingIngredientDeletion.meal.title)?")
            } else {
                Text("Remove this ingredient?")
            }
        }
        .sheet(isPresented: $isShowingDayChangePrompt) {
            DayChangePromptView(
                date: selectedDay,
                meals: displayedMeals,
                request: $dayChangeRequest,
                onSubmit: { request in
                    isShowingDayChangePrompt = false
                    onChangeDay(defaultLogDate, dayChangePrompt(for: request))
                }
            )
            .preferredColorScheme(.dark)
        }
        .sheet(item: $selectedBreakdownMacro) { macro in
            NutritionMacroBreakdownView(
                macro: macro,
                meals: displayedMeals,
                dayTotals: mealStore.totals(on: selectedDay),
                date: selectedDay
            )
            .preferredColorScheme(.dark)
        }
        .sheet(isPresented: $isShowingDayReview) {
            NutritionDayReviewView(
                date: selectedDay,
                meals: displayedMeals,
                totals: mealStore.totals(on: selectedDay),
                targets: profile.map(NutritionTargetCalculator.targets(for:))
            )
            .preferredColorScheme(.dark)
        }
        .sheet(isPresented: $isShowingQuickCheckIn) {
            QuickEatingCheckInSheet(
                linkedMeal: selectedCheckInMeal,
                onSave: { draft in
                    await eatingCheckInStore.save(draft)
                    selectedCheckInMeal = nil
                }
            )
            .preferredColorScheme(.dark)
        }
        .sheet(isPresented: $isShowingUrgeSupport) {
            UrgeSupportSheet { draft in
                await eatingCheckInStore.save(draft)
            }
            .preferredColorScheme(.dark)
        }
        .sheet(isPresented: $isShowingRecoveryFlow) {
            OvereatingRecoverySheet { draft in
                await eatingCheckInStore.save(draft)
            }
            .preferredColorScheme(.dark)
        }
        .sheet(isPresented: $isShowingPlanToday) {
            PlanTodaySheet(
                selectedDay: selectedDay,
                onAddOpenMeal: { mealType, plannedTime, title, note in
                    await mealPlanStore.addOpenPlaceholder(
                        date: selectedDay,
                        mealType: mealType,
                        plannedTime: plannedTime,
                        title: title,
                        note: note
                    )
                },
                onCopyYesterday: {
                    await mealPlanStore.copyYesterday(to: selectedDay)
                },
                onAskCoach: {
                    onChangeDay(
                        defaultLogDate,
                        "Create a practical meal plan for today using usual foods. Keep planned food separate from actual logged meals."
                    )
                }
            )
            .preferredColorScheme(.dark)
        }
        .sheet(item: $adjustingPlannedMeal) { meal in
            PlannedMealAdjustmentSheet(meal: meal) { adjustedIngredients, status in
                await mealPlanStore.consume(
                    meal,
                    actualIngredients: adjustedIngredients,
                    status: status
                )
                await refreshSelectedDay()
            }
            .preferredColorScheme(.dark)
        }
        .sheet(item: $movingPlannedMeal) { meal in
            MovePlannedMealTimeSheet(meal: meal) { plannedTime in
                await mealPlanStore.moveTime(meal, plannedTime: plannedTime)
            }
            .preferredColorScheme(.dark)
        }
        .sheet(item: $replacingPlannedMeal) { meal in
            ReplacePlannedMealSheet(meal: meal) { title, reason in
                await mealPlanStore.replaceWithOpenMeal(
                    meal,
                    title: title,
                    reason: reason
                )
                onChangeDay(
                    defaultLogDate,
                    replacementPrompt(for: meal, title: title, reason: reason)
                )
            }
            .preferredColorScheme(.dark)
        }
        .sheet(isPresented: $isShowingWeeklyInsights) {
            WeeklyCBTInsightsView(
                insights: eatingCheckInStore.weeklyInsights(endingAt: selectedDay)
            )
            .preferredColorScheme(.dark)
        }
        .onChange(of: pendingAction) { _, action in
            guard let action else {
                return
            }
            switch action {
            case "checkin":
                isShowingQuickCheckIn = true
            case "urge":
                isShowingUrgeSupport = true
            case "recovery":
                isShowingRecoveryFlow = true
            case "confirm":
                if let meal = nextPlannedMeal {
                    adjustingPlannedMeal = meal
                } else {
                    isShowingPlanToday = true
                }
            default:
                break
            }
            pendingAction = nil
        }
    }

    private var displayedMeals: [MealLogEntry] {
        mealStore.meals(on: selectedDay)
    }

    private var planMeals: [PlannedMealDTO] {
        mealPlanStore.response?.plan.meals.sorted { lhs, rhs in
            if lhs.sortOrder == rhs.sortOrder {
                return (lhs.plannedTime ?? "") < (rhs.plannedTime ?? "")
            }
            return lhs.sortOrder < rhs.sortOrder
        } ?? []
    }

    private var nextPlannedMeal: PlannedMealDTO? {
        let currentMinutes = Calendar.current.component(.hour, from: Date()) * 60
            + Calendar.current.component(.minute, from: Date())
        let openMeals = planMeals
            .filter { $0.linkedMealLogId == nil }
            .filter { !["skipped", "replaced", "confirmed", "eaten_as_planned", "partially_eaten"].contains($0.status) }
        return openMeals.first { (plannedMinutes($0.plannedTime) ?? Int.max) >= currentMinutes }
            ?? openMeals.first
    }

    @ViewBuilder
    private func foodLogRows(totals: MacroTotals) -> some View {
        if displayedMeals.isEmpty {
            Text("No meals logged for \(nutritionDayLabel(selectedDay).lowercased()).")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(FitnessTheme.secondaryText)
                .frame(maxWidth: .infinity, minHeight: 72, alignment: .center)
                .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(FitnessTheme.cardStroke, lineWidth: 1)
                )
        } else {
            VStack(spacing: 10) {
                ForEach(displayedMeals) { meal in
                    HomeMealLogRow(
                        meal: meal,
                        dayTotals: totals,
                        thumbnailData: mealStore.thumbnailData(for: meal),
                        linkedPlanTitle: linkedPlanTitle(for: meal),
                        linkedCheckIns: eatingCheckInStore.checkIns(linkedToMeal: meal.id),
                        onEdit: {
                            onEditMeal(meal)
                        },
                        onAddCheckIn: {
                            selectedCheckInMeal = meal
                            isShowingQuickCheckIn = true
                        },
                        onDeleteMeal: {
                            onDeleteMeal(meal)
                        },
                        onDeleteIngredient: { ingredient in
                            pendingIngredientDeletion = PendingIngredientDeletion(
                                ingredient: ingredient,
                                meal: meal
                            )
                        },
                        draggingMealID: $draggingMealID,
                        draggingIngredientID: $draggingIngredientID,
                        dropTargetMealID: $dropTargetMealID,
                        dropTargetIngredientID: $dropTargetIngredientID,
                        onMoveMeal: { draggedID, targetID in
                            moveMeal(draggedID, before: targetID)
                        },
                        onMoveIngredient: { draggedID, targetID in
                            moveIngredient(draggedID, before: targetID, in: meal)
                        },
                        onMoveIngredientToMeal: { ingredientID in
                            onMoveIngredientToMeal(ingredientID, meal)
                        }
                    )
                }
            }
        }
    }

    private func linkedPlanTitle(for meal: MealLogEntry) -> String? {
        let mealId = meal.id.uuidString.lowercased()
        return planMeals.first { $0.linkedMealLogId?.lowercased() == mealId }?.title
    }

    private func plannedMinutes(_ text: String?) -> Int? {
        guard let text else {
            return nil
        }
        let parts = text.split(separator: ":")
        guard parts.count == 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]) else {
            return nil
        }
        return hour * 60 + minute
    }

    private func replacementPrompt(
        for meal: PlannedMealDTO,
        title: String,
        reason: String?
    ) -> String {
        [
            "I ate something else instead of this planned meal.",
            "Original planned meal: \(meal.title)",
            "Replacement title: \(title)",
            reason.map { "Reason/context: \($0)" },
            "Please log the actual meal and keep the original plan for comparison."
        ]
        .compactMap { $0 }
        .joined(separator: "\n")
    }

    private var canMoveForward: Bool {
        true
    }

    private var defaultLogDate: Date {
        guard !Calendar.current.isDateInToday(selectedDay) else {
            return Date()
        }

        let calendar = Calendar.current
        let dayComponents = calendar.dateComponents([.year, .month, .day], from: selectedDay)
        let timeComponents = calendar.dateComponents([.hour, .minute], from: Date())
        var components = DateComponents()
        components.year = dayComponents.year
        components.month = dayComponents.month
        components.day = dayComponents.day
        components.hour = timeComponents.hour
        components.minute = timeComponents.minute

        return calendar.date(from: components) ?? selectedDay
    }

    private func dayChangePrompt(for request: String) -> String {
        let mealLines = displayedMeals.map { meal in
            let ingredients = meal.ingredients.map(\.name).joined(separator: ", ")
            let ingredientText = ingredients.isEmpty ? "no ingredient breakdown" : ingredients

            return "- \(meal.title): \(ingredientText) (\(wholeNumber(meal.totals.calories)) kcal)"
        }
        .joined(separator: "\n")

        return [
            "I want to change this day's food log without replacing everything.",
            "Current meals:",
            mealLines,
            "",
            "Requested change:",
            request.trimmingCharacters(in: .whitespacesAndNewlines)
        ].joined(separator: "\n")
    }

    private func moveDay(by offset: Int) {
        guard let nextDay = Calendar.current.date(byAdding: .day, value: offset, to: selectedDay) else {
            return
        }

        selectedDay = Calendar.current.startOfDay(for: nextDay)
    }

    @MainActor
    private func refreshSelectedDay() async {
        guard !isRefreshingFoodLog else {
            return
        }

        isRefreshingFoodLog = true
        defer { isRefreshingFoodLog = false }
        await onRefreshDay(selectedDay)
    }

    private func moveMeal(_ draggedID: UUID, before targetID: UUID) {
        guard draggedID != targetID,
              let fromIndex = displayedMeals.firstIndex(where: { $0.id == draggedID }),
              let toIndex = displayedMeals.firstIndex(where: { $0.id == targetID }) else {
            return
        }

        var reorderedMeals = displayedMeals
        let movedMeal = reorderedMeals.remove(at: fromIndex)
        let insertionIndex = min(max(0, toIndex), reorderedMeals.count)
        reorderedMeals.insert(movedMeal, at: insertionIndex)
        withAnimation(.snappy(duration: 0.18)) {
            onReorderMeals(reorderedMeals, selectedDay)
        }
    }

    private func moveIngredient(_ draggedID: UUID, before targetID: UUID, in meal: MealLogEntry) {
        guard draggedID != targetID,
              let fromIndex = meal.ingredients.firstIndex(where: { $0.id == draggedID }),
              let toIndex = meal.ingredients.firstIndex(where: { $0.id == targetID }) else {
            return
        }

        var reorderedIngredients = meal.ingredients
        let movedIngredient = reorderedIngredients.remove(at: fromIndex)
        let insertionIndex = min(max(0, toIndex), reorderedIngredients.count)
        reorderedIngredients.insert(movedIngredient, at: insertionIndex)
        withAnimation(.snappy(duration: 0.18)) {
            onReorderIngredients(reorderedIngredients, meal)
        }
    }
}

private struct NutritionSectionTitle: View {
    let title: String
    let subtitle: String?
    let systemImage: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Label(title, systemImage: systemImage)
                .font(.system(size: 14, weight: .black, design: .rounded))
                .foregroundStyle(.white)
            Spacer(minLength: 8)
            if let subtitle {
                Text(subtitle)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    .multilineTextAlignment(.trailing)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct TodayNutritionOverviewSection: View {
    let totals: MacroTotals
    let targets: NutritionTargets
    let plannedTotals: MacroTotals
    let nextMeal: PlannedMealDTO?
    let latestCheckIn: EatingCheckInRecord?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NutritionSectionTitle(
                title: "Today overview",
                subtitle: "Planned and eaten stay separate",
                systemImage: "gauge.with.dots.needle.50percent"
            )

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                OverviewValueCard(
                    label: "Eaten",
                    value: "\(wholeNumber(totals.calories)) / \(targets.selectedCalories.formatted())",
                    unit: "kcal",
                    systemImage: "checkmark.circle.fill",
                    tint: FitnessTheme.lime
                )
                OverviewValueCard(
                    label: "Planned",
                    value: "\(wholeNumber(plannedTotals.calories))",
                    unit: "kcal",
                    systemImage: "calendar",
                    tint: FitnessTheme.cyan
                )
                OverviewValueCard(
                    label: "Remaining",
                    value: "\(wholeNumber(max(0, Double(targets.selectedCalories) - totals.calories)))",
                    unit: "kcal",
                    systemImage: "minus.plus.batteryblock",
                    tint: FitnessTheme.orange
                )
                OverviewValueCard(
                    label: "Protein",
                    value: "\(wholeNumber(totals.proteinGrams)) / \(targets.proteinGrams)",
                    unit: "g",
                    systemImage: "fish.fill",
                    tint: FitnessTheme.lime
                )
                OverviewValueCard(
                    label: "Fiber",
                    value: "\(wholeNumber(totals.fiberGrams)) / \(targets.fiberGrams)",
                    unit: "g",
                    systemImage: "leaf.fill",
                    tint: FitnessTheme.cyan
                )
                OverviewValueCard(
                    label: "Latest hunger",
                    value: latestCheckIn?.hungerBefore.map { "\($0)/10" } ?? "Open",
                    unit: "",
                    systemImage: "dial.low.fill",
                    tint: FitnessTheme.violet
                )
            }

            HStack(spacing: 8) {
                MealStateBadge(title: "Next meal", systemImage: "clock", tint: FitnessTheme.cyan)
                Text(nextMeal.map { "\($0.title) \($0.plannedTime ?? "time open")" } ?? "Nothing else planned")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    .lineLimit(2)
                Spacer(minLength: 0)
            }
            .padding(10)
            .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
}

private struct OverviewValueCard: View {
    let label: String
    let value: String
    let unit: String
    let systemImage: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.caption.bold())
                    .foregroundStyle(tint)
                Text(label)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    .lineLimit(1)
            }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value)
                    .font(.system(size: 17, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.55)
                if !unit.isEmpty {
                    Text(unit)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(FitnessTheme.secondaryText)
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 70, alignment: .topLeading)
        .padding(10)
        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(tint.opacity(0.28), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

private struct DailyCoachPanel: View {
    let totals: MacroTotals
    let targets: NutritionTargets
    let nextMeal: PlannedMealDTO?
    let latestCheckIn: EatingCheckInRecord?

    var body: some View {
        let text = coachText
        Label {
            Text(text)
                .font(.caption.weight(.semibold))
                .foregroundStyle(FitnessTheme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "sparkles")
                .foregroundStyle(FitnessTheme.lime)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(FitnessTheme.lime.opacity(0.25), lineWidth: 1)
        )
        .accessibilityLabel("Coach check-in, \(text)")
    }

    private var coachText: String {
        if let latestCheckIn, (latestCheckIn.hungerBefore ?? 0) >= 7, let nextMeal {
            return "You reported hunger \(latestCheckIn.hungerBefore ?? 0)/10. \(nextMeal.title) is the next planned option."
        }
        if let nextMeal, nextMeal.ingredients.isEmpty {
            return "Your planned \(nextMeal.mealType.lowercased()) is still open. Choose it when you are ready."
        }
        let remainingProtein = max(0, Double(targets.proteinGrams) - totals.proteinGrams)
        if remainingProtein >= 35 {
            return "You have eaten \(wholeNumber(totals.proteinGrams)) g protein so far. A protein-forward next meal would help."
        }
        return "Keep the next meal normal. No compensation is needed after a larger eating event."
    }
}

private struct PlannedTodaySection: View {
    let meals: [PlannedMealDTO]
    let isLoading: Bool
    let message: String?
    let onAte: (PlannedMealDTO) async -> Void
    let onAdjust: (PlannedMealDTO) -> Void
    let onReplace: (PlannedMealDTO) -> Void
    let onSkip: (PlannedMealDTO) async -> Void
    let onMoveTime: (PlannedMealDTO) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NutritionSectionTitle(
                title: "Planned today",
                subtitle: "\(meals.count) items",
                systemImage: "calendar"
            )

            if isLoading {
                ProgressView("Loading plan")
                    .tint(FitnessTheme.lime)
                    .foregroundStyle(FitnessTheme.secondaryText)
            } else if meals.isEmpty {
                EmptyNutritionState(
                    title: "Nothing is planned yet.",
                    detail: "Build today's meals or ask the coach to create a plan.",
                    systemImage: "calendar.badge.plus"
                )
            } else {
                ForEach(meals) { meal in
                    PlannedMealUXCard(
                        meal: meal,
                        onAte: { await onAte(meal) },
                        onAdjust: { onAdjust(meal) },
                        onReplace: { onReplace(meal) },
                        onSkip: { await onSkip(meal) },
                        onMoveTime: { onMoveTime(meal) }
                    )
                }
            }

            if let message, meals.isEmpty {
                Text(message)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(FitnessTheme.secondaryText)
            }
        }
    }
}

private struct PlannedMealUXCard: View {
    let meal: PlannedMealDTO
    let onAte: () async -> Void
    let onAdjust: () -> Void
    let onReplace: () -> Void
    let onSkip: () async -> Void
    let onMoveTime: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: statusIcon)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(statusTint)
                    .frame(width: 30, height: 30)
                    .background(statusTint.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))

                VStack(alignment: .leading, spacing: 4) {
                    Text(meal.title)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                    Text("\(meal.plannedTime ?? "Time open") · \(meal.mealType)")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(FitnessTheme.secondaryText)
                }

                Spacer(minLength: 8)

                Text("\(wholeNumber(meal.calories)) kcal")
                    .font(.caption.monospacedDigit().weight(.black))
                    .foregroundStyle(FitnessTheme.cyan)
            }

            HStack(spacing: 6) {
                MealStateBadge(title: statusTitle, systemImage: statusIcon, tint: statusTint)
                if meal.linkedMealLogId != nil {
                    MealStateBadge(title: "Linked actual", systemImage: "link", tint: FitnessTheme.lime)
                }
            }

            if !meal.ingredients.isEmpty {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(meal.ingredients.prefix(4)) { ingredient in
                        HStack {
                            Text(ingredient.displayName)
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(FitnessTheme.secondaryText)
                                .lineLimit(1)
                            Spacer()
                            Text("\(formatQuantity(ingredient.quantity)) \(ingredient.unit)")
                                .font(.caption2.monospacedDigit().weight(.bold))
                                .foregroundStyle(FitnessTheme.secondaryText)
                        }
                    }
                }
            } else {
                Text("Open placeholder - zero planned calories until food is selected.")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(FitnessTheme.secondaryText)
            }

            HStack(spacing: 8) {
                PlanActionButton(title: "I ate this", icon: "checkmark.circle.fill") {
                    Task { await onAte() }
                }
                PlanActionButton(title: "Ate part", icon: "circle.lefthalf.filled", action: onAdjust)
            }
            HStack(spacing: 8) {
                PlanActionButton(title: "Edit before logging", icon: "slider.horizontal.3", action: onAdjust)
                PlanActionButton(title: "Replace", icon: "arrow.triangle.2.circlepath", action: onReplace)
            }
            HStack(spacing: 8) {
                PlanActionButton(title: "Skip", icon: "forward.fill") {
                    Task { await onSkip() }
                }
                PlanActionButton(title: "Move time", icon: "clock.arrow.circlepath", action: onMoveTime)
            }
        }
        .padding(12)
        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(style: StrokeStyle(lineWidth: 1, dash: meal.linkedMealLogId == nil ? [5, 4] : []))
                .foregroundStyle(statusTint.opacity(0.45))
        )
        .opacity(meal.status == "skipped" ? 0.62 : 1)
        .accessibilityElement(children: .contain)
    }

    private var statusTitle: String {
        switch meal.status {
        case "confirmed", "eaten_as_planned":
            return "Confirmed"
        case "partially_eaten":
            return "Partially eaten"
        case "replaced":
            return "Replaced"
        case "skipped":
            return "Skipped"
        case "unconfirmed", "not_confirmed":
            return "Unconfirmed"
        default:
            return "Planned"
        }
    }

    private var statusIcon: String {
        switch meal.status {
        case "confirmed", "eaten_as_planned":
            return "checkmark.circle.fill"
        case "partially_eaten":
            return "circle.lefthalf.filled"
        case "replaced":
            return "arrow.right.circle.fill"
        case "skipped":
            return "forward.fill"
        case "unconfirmed", "not_confirmed":
            return "questionmark.circle"
        default:
            return "calendar"
        }
    }

    private var statusTint: Color {
        switch meal.status {
        case "confirmed", "eaten_as_planned":
            return FitnessTheme.lime
        case "partially_eaten", "replaced":
            return FitnessTheme.orange
        case "skipped", "unconfirmed", "not_confirmed":
            return FitnessTheme.secondaryText
        default:
            return FitnessTheme.cyan
        }
    }

    private func formatQuantity(_ value: Double) -> String {
        value.rounded() == value ? "\(Int(value))" : String(format: "%.1f", value)
    }
}

private struct PlanActionButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.caption2.weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .frame(maxWidth: .infinity, minHeight: 34)
        }
        .buttonStyle(SecondaryActionButtonStyle())
        .accessibilityLabel(title)
    }
}

private struct EatenTodaySection<Rows: View>: View {
    let totals: MacroTotals
    let targets: NutritionTargets
    @ViewBuilder let rows: () -> Rows
    let onMacroTap: (NutritionBreakdownMacro) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NutritionSectionTitle(
                title: "Eaten today",
                subtitle: "Actual consumed only",
                systemImage: "checkmark.circle.fill"
            )

            VStack(spacing: 10) {
                MacroProgressRow(
                    title: "Eaten calories",
                    current: totals.calories,
                    target: Double(targets.selectedCalories),
                    unit: "kcal",
                    tint: FitnessTheme.orange,
                    onTap: { onMacroTap(.calories) }
                )
                MacroProgressRow(
                    title: "Actual protein",
                    current: totals.proteinGrams,
                    target: Double(targets.proteinGrams),
                    unit: "g",
                    tint: FitnessTheme.lime,
                    onTap: { onMacroTap(.protein) }
                )
                MacroProgressRow(
                    title: "Fiber",
                    current: totals.fiberGrams,
                    target: Double(targets.fiberGrams),
                    unit: "g",
                    tint: FitnessTheme.cyan,
                    onTap: { onMacroTap(.fiber) }
                )
            }

            rows()
        }
    }
}

private struct PlanActualComparisonSection: View {
    let plannedMeals: [PlannedMealDTO]
    let actualMeals: [MealLogEntry]
    let plannedTotals: MacroTotals
    let actualTotals: MacroTotals

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NutritionSectionTitle(
                title: "Plan versus actual",
                subtitle: "\(completedCount) completed · \(skippedCount) skipped",
                systemImage: "arrow.left.arrow.right"
            )

            HStack(spacing: 8) {
                PlanMacroChip(title: "Planned", value: plannedTotals.calories, unit: "kcal")
                PlanMacroChip(title: "Actual", value: actualTotals.calories, unit: "kcal")
                PlanMacroChip(title: "Protein diff", value: actualTotals.proteinGrams - plannedTotals.proteinGrams, unit: "g")
            }

            if plannedMeals.isEmpty && actualMeals.isEmpty {
                EmptyNutritionState(
                    title: "Not enough information yet.",
                    detail: "Plans and food logs will appear here for comparison.",
                    systemImage: "list.bullet.rectangle"
                )
            } else {
                ForEach(comparisonRows.prefix(6), id: \.title) { row in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(row.title)
                            .font(.caption.weight(.black))
                            .foregroundStyle(.white)
                        Text(row.detail)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(FitnessTheme.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(9)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            }
        }
    }

    private var completedCount: Int {
        plannedMeals.filter { ["confirmed", "eaten_as_planned", "partially_eaten"].contains($0.status) }.count
    }

    private var skippedCount: Int {
        plannedMeals.filter { $0.status == "skipped" }.count
    }

    private var comparisonRows: [(title: String, detail: String)] {
        let planRows = plannedMeals.map { meal in
            let actual = actualMeals.first { $0.id.uuidString.lowercased() == meal.linkedMealLogId?.lowercased() }
            let actualText = actual.map { "\($0.title), \(wholeNumber($0.totals.calories)) kcal" } ?? "not logged yet"
            return (
                title: meal.mealType,
                detail: "Planned: \(meal.title). Actual: \(actualText). Status: \(meal.displayStatus)."
            )
        }
        let linkedActualIds = Set(plannedMeals.compactMap { $0.linkedMealLogId?.lowercased() })
        let unplanned = actualMeals
            .filter { !linkedActualIds.contains($0.id.uuidString.lowercased()) }
            .map {
                (
                    title: $0.mealType,
                    detail: "Additional food logged: \($0.title), \(wholeNumber($0.totals.calories)) kcal."
                )
            }
        return planRows + unplanned
    }
}

private struct DailyBehaviorTimelineSection: View {
    let plannedMeals: [PlannedMealDTO]
    let actualMeals: [MealLogEntry]
    let checkIns: [EatingCheckInRecord]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NutritionSectionTitle(
                title: "Daily timeline",
                subtitle: "\(items.count) events",
                systemImage: "timeline.selection"
            )

            if items.isEmpty {
                EmptyNutritionState(
                    title: "No check-ins yet.",
                    detail: "A 10-second hunger check can help identify patterns.",
                    systemImage: "book.closed"
                )
            } else {
                ForEach(items.prefix(12)) { item in
                    HStack(alignment: .top, spacing: 9) {
                        Text(item.time)
                            .font(.caption2.monospacedDigit().weight(.bold))
                            .foregroundStyle(FitnessTheme.secondaryText)
                            .frame(width: 42, alignment: .leading)
                        Image(systemName: item.icon)
                            .font(.caption.bold())
                            .foregroundStyle(item.tint)
                            .frame(width: 22)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title)
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.white)
                            Text(item.detail)
                                .font(.caption2.weight(.medium))
                                .foregroundStyle(FitnessTheme.secondaryText)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 3)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    private var items: [NutritionTimelineItem] {
        let planItems = plannedMeals.map {
            NutritionTimelineItem(
                sortKey: $0.plannedTime ?? "99:99",
                time: $0.plannedTime ?? "--:--",
                icon: "calendar",
                tint: FitnessTheme.cyan,
                title: "Plan",
                detail: "\($0.mealType): \($0.title)"
            )
        }
        let actualItems = actualMeals.map {
            NutritionTimelineItem(
                sortKey: $0.loggedAt.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute()),
                time: $0.loggedAt.formatted(.dateTime.hour().minute()),
                icon: "checkmark.circle.fill",
                tint: FitnessTheme.lime,
                title: "Actual meal",
                detail: "\($0.title), \(wholeNumber($0.totals.calories)) kcal"
            )
        }
        let checkInItems = checkIns.map {
            NutritionTimelineItem(
                sortKey: $0.occurredAt.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute()),
                time: $0.occurredAt.formatted(.dateTime.hour().minute()),
                icon: ($0.urgeIntensity ?? 0) >= 7 ? "pause.circle.fill" : "book.closed.fill",
                tint: ($0.urgeIntensity ?? 0) >= 7 ? FitnessTheme.orange : FitnessTheme.violet,
                title: ($0.urgeIntensity ?? 0) >= 7 ? "Urge" : "Check-in",
                detail: $0.summaryText
            )
        }
        return (planItems + actualItems + checkInItems).sorted { $0.sortKey < $1.sortKey }
    }
}

private struct NutritionTimelineItem: Identifiable {
    let id = UUID()
    let sortKey: String
    let time: String
    let icon: String
    let tint: Color
    let title: String
    let detail: String
}

private struct BehaviorCheckInSummarySection: View {
    let checkIns: [EatingCheckInRecord]
    let lastSyncedAt: Date?
    let syncMessage: String?
    let onQuickCheckIn: () -> Void
    let onUrge: () -> Void
    let onRecovery: () -> Void
    let onWeeklyInsights: () -> Void
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NutritionSectionTitle(
                title: "Eating check-ins",
                subtitle: lastSyncedAt.map { "Synced \($0.formatted(.dateTime.hour().minute()))" } ?? "Local first",
                systemImage: "book.closed.fill"
            )

            if checkIns.isEmpty {
                EmptyNutritionState(
                    title: "No check-ins yet.",
                    detail: "A 10-second hunger check can help identify patterns.",
                    systemImage: "dial.low"
                )
            } else {
                ForEach(checkIns.suffix(3)) { checkIn in
                    Label(checkIn.summaryText, systemImage: checkIn.isSynced ? "checkmark.icloud.fill" : "icloud.slash")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(FitnessTheme.secondaryText)
                        .padding(9)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 10))
                }
            }

            if let syncMessage {
                HStack(spacing: 8) {
                    Text(syncMessage)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(FitnessTheme.secondaryText)
                    Spacer(minLength: 6)
                    Button("Retry", action: onRetry)
                        .font(.caption2.bold())
                        .foregroundStyle(FitnessTheme.lime)
                }
            }

            HStack(spacing: 8) {
                PlanActionButton(title: "Quick check-in", icon: "square.and.pencil", action: onQuickCheckIn)
                PlanActionButton(title: "Urge help", icon: "pause.circle.fill", action: onUrge)
            }
            HStack(spacing: 8) {
                PlanActionButton(title: "Recovery", icon: "heart.text.square", action: onRecovery)
                PlanActionButton(title: "Weekly insights", icon: "chart.line.uptrend.xyaxis", action: onWeeklyInsights)
            }
        }
    }
}

private struct EmptyNutritionState: View {
    let title: String
    let detail: String
    let systemImage: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: systemImage)
                .foregroundStyle(FitnessTheme.secondaryText)
                .frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
                Text(detail)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

private struct QuickEatingCheckInSheet: View {
    let linkedMeal: MealLogEntry?
    let onSave: (EatingCheckInDraft) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var hunger = 5.0
    @State private var urge = 0.0
    @State private var selectedFeelings: Set<String> = []
    @State private var selectedContexts: Set<String> = []
    @State private var isExpanded = false
    @State private var fullness = 5.0
    @State private var automaticThought = ""
    @State private var balancedResponse = ""
    @State private var copingAction = ""
    @State private var note = ""
    @State private var ateWithScreen = false
    @State private var ateFromPackage = false
    @State private var tookSecondServing = false
    @State private var ateUntilPain = false
    @State private var lossOfControl = false

    private let feelings = [
        "Calm", "Hungry", "Stressed", "Bored", "Tired", "Sad",
        "Frustrated", "Reward-seeking", "Social pressure", "Not sure",
    ]
    private let contexts = [
        "Physical hunger", "Habit", "Emotional eating", "Watching TV",
        "Food nearby", "Family meal", "Restaurant", "Work stress",
        "Late evening", "Poor sleep",
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let linkedMeal {
                        MealStateBadge(title: "Linked to \(linkedMeal.title)", systemImage: "link", tint: FitnessTheme.cyan)
                    }

                    CheckInSlider(title: "Hunger", value: $hunger)
                    CheckInSlider(title: "Urge", value: $urge)
                    ChipGroup(title: "Current feeling", options: feelings, selection: $selectedFeelings)
                    ChipGroup(title: "What is happening?", options: contexts, selection: $selectedContexts)

                    DisclosureGroup("Add more detail", isExpanded: $isExpanded) {
                        VStack(alignment: .leading, spacing: 12) {
                            CheckInSlider(title: "Fullness after", value: $fullness)
                            TextField("Automatic thought", text: $automaticThought, axis: .vertical)
                                .textFieldStyle(.roundedBorder)
                            TextField("Balanced response", text: $balancedResponse, axis: .vertical)
                                .textFieldStyle(.roundedBorder)
                            TextField("Coping action", text: $copingAction)
                                .textFieldStyle(.roundedBorder)
                            Toggle("Ate with screen", isOn: $ateWithScreen)
                            Toggle("Ate from package", isOn: $ateFromPackage)
                            Toggle("Took second serving", isOn: $tookSecondServing)
                            Toggle("Ate until pain", isOn: $ateUntilPain)
                            Toggle("Felt loss of control", isOn: $lossOfControl)
                            TextField("Note", text: $note, axis: .vertical)
                                .textFieldStyle(.roundedBorder)
                        }
                        .font(.subheadline)
                        .padding(.top, 8)
                    }
                    .tint(FitnessTheme.lime)
                }
                .padding(18)
            }
            .background(FitnessTheme.background.ignoresSafeArea())
            .navigationTitle("Quick check-in")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await onSave(draft)
                            dismiss()
                        }
                    }
                    .fontWeight(.bold)
                }
            }
        }
    }

    private var draft: EatingCheckInDraft {
        EatingCheckInDraft(
            linkedMealId: linkedMeal?.id.uuidString,
            hungerBefore: Int(hunger.rounded()),
            fullnessAfter: isExpanded ? Int(fullness.rounded()) : nil,
            urgeIntensity: Int(urge.rounded()),
            emotions: Array(selectedFeelings).sorted(),
            triggers: Array(selectedContexts).sorted(),
            automaticThought: trimmed(automaticThought),
            balancedResponse: trimmed(balancedResponse),
            eatingContext: selectedContexts.first.map(EatingContextChoice.from(title:)),
            lossOfControl: lossOfControl,
            ateUntilPain: ateUntilPain,
            ateWithScreen: ateWithScreen,
            ateFromPackage: ateFromPackage,
            tookSecondServing: tookSecondServing,
            copingAction: trimmed(copingAction),
            note: trimmed(note)
        )
    }
}

private struct PlannedMealAdjustmentSheet: View {
    let meal: PlannedMealDTO
    let onSave: ([PlannedMealIngredientDTO], String) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var quantities: [String: Double]

    init(
        meal: PlannedMealDTO,
        onSave: @escaping ([PlannedMealIngredientDTO], String) async -> Void
    ) {
        self.meal = meal
        self.onSave = onSave
        _quantities = State(initialValue: Dictionary(uniqueKeysWithValues: meal.ingredients.map { ($0.id, $0.quantity) }))
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Adjust quantities") {
                    ForEach(meal.ingredients) { ingredient in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(ingredient.displayName)
                                .font(.headline)
                            Stepper(
                                "\(formatQuantity(quantities[ingredient.id] ?? ingredient.quantity)) \(ingredient.unit)",
                                value: Binding(
                                    get: { quantities[ingredient.id] ?? ingredient.quantity },
                                    set: { quantities[ingredient.id] = max(0, $0) }
                                ),
                                in: 0...max(ingredient.quantity * 3, 1),
                                step: ingredient.unit == "g" ? 10 : 0.25
                            )
                        }
                    }
                }

                Section {
                    Text("The original planned meal stays visible for comparison. Only the logged meal uses these adjusted quantities.")
                        .font(.caption)
                        .foregroundStyle(FitnessTheme.secondaryText)
                }
            }
            .scrollContentBackground(.hidden)
            .background(FitnessTheme.background)
            .navigationTitle("Edit before logging")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Log") {
                        Task {
                            await onSave(adjustedIngredients, status)
                            dismiss()
                        }
                    }
                }
            }
        }
    }

    private var adjustedIngredients: [PlannedMealIngredientDTO] {
        meal.ingredients.map { ingredient in
            let quantity = quantities[ingredient.id] ?? ingredient.quantity
            let ratio = ingredient.quantity <= 0 ? 0 : quantity / ingredient.quantity
            return PlannedMealIngredientDTO(
                id: ingredient.id,
                displayName: ingredient.displayName,
                quantity: quantity,
                unit: ingredient.unit,
                grams: ingredient.grams.map { $0 * ratio },
                totals: ingredient.totals * ratio
            )
        }
    }

    private var status: String {
        let planned = meal.ingredients.map(\.quantity).reduce(0, +)
        let actual = adjustedIngredients.map(\.quantity).reduce(0, +)
        return planned > 0 && actual >= planned * 0.98 ? "confirmed" : "partially_eaten"
    }
}

private struct MovePlannedMealTimeSheet: View {
    let meal: PlannedMealDTO
    let onSave: (String?) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var time: Date

    init(meal: PlannedMealDTO, onSave: @escaping (String?) async -> Void) {
        self.meal = meal
        self.onSave = onSave
        _time = State(initialValue: Self.initialDate(from: meal.plannedTime))
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text(meal.title)
                    .font(.title3.bold())
                DatePicker("Planned time", selection: $time, displayedComponents: .hourAndMinute)
                    .datePickerStyle(.wheel)
                Button("Clear time") {
                    Task {
                        await onSave(nil)
                        dismiss()
                    }
                }
                .buttonStyle(SecondaryActionButtonStyle())
                Spacer()
            }
            .padding(18)
            .background(FitnessTheme.background.ignoresSafeArea())
            .navigationTitle("Move time")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await onSave(formattedTime)
                            dismiss()
                        }
                    }
                }
            }
        }
    }

    private var formattedTime: String {
        let calendar = Calendar.current
        return String(
            format: "%02d:%02d",
            calendar.component(.hour, from: time),
            calendar.component(.minute, from: time)
        )
    }

    private static func initialDate(from text: String?) -> Date {
        guard let text else {
            return Date()
        }
        let parts = text.split(separator: ":")
        guard parts.count == 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]) else {
            return Date()
        }
        return Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: Date()) ?? Date()
    }
}

private struct ReplacePlannedMealSheet: View {
    let meal: PlannedMealDTO
    let onSave: (String, String?) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var reason = ""

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text("Original: \(meal.title)")
                    .font(.headline)
                TextField("Replacement or open placeholder", text: $title)
                    .textFieldStyle(.roundedBorder)
                TextField("Optional note", text: $reason, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                Text("The original remains visible and the replacement is tracked as a plan adjustment.")
                    .font(.caption)
                    .foregroundStyle(FitnessTheme.secondaryText)
                Spacer()
            }
            .padding(18)
            .background(FitnessTheme.background.ignoresSafeArea())
            .navigationTitle("Replace meal")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Replace") {
                        Task {
                            await onSave(trimmed(title) ?? "Open replacement", trimmed(reason))
                            dismiss()
                        }
                    }
                }
            }
        }
    }
}

private struct PlanTodaySheet: View {
    let selectedDay: Date
    let onAddOpenMeal: (String, String?, String, String?) async -> Void
    let onCopyYesterday: () async -> Void
    let onAskCoach: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var mealType = "Lunch"
    @State private var title = "Open meal"
    @State private var note = ""
    @State private var time = Date()

    var body: some View {
        NavigationStack {
            Form {
                Section("Add placeholder") {
                    Picker("Meal", selection: $mealType) {
                        ForEach(["Breakfast", "Lunch", "Snack", "Dinner"], id: \.self) {
                            Text($0).tag($0)
                        }
                    }
                    TextField("Title", text: $title)
                    TextField("Note", text: $note, axis: .vertical)
                    DatePicker("Expected time", selection: $time, displayedComponents: .hourAndMinute)
                    Button("Add open meal") {
                        Task {
                            await onAddOpenMeal(mealType, formattedTime, trimmed(title) ?? mealType, trimmed(note))
                            dismiss()
                        }
                    }
                }

                Section("Reuse") {
                    Button("Copy yesterday") {
                        Task {
                            await onCopyYesterday()
                            dismiss()
                        }
                    }
                    Button("Ask coach to generate a plan") {
                        onAskCoach()
                        dismiss()
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(FitnessTheme.background)
            .navigationTitle("Plan today")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    private var formattedTime: String {
        let calendar = Calendar.current
        return String(
            format: "%02d:%02d",
            calendar.component(.hour, from: time),
            calendar.component(.minute, from: time)
        )
    }
}

private struct UrgeSupportSheet: View {
    let onSave: (EatingCheckInDraft) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var urge = 7.0
    @State private var hunger = 5.0
    @State private var selectedFeelings: Set<String> = []
    @State private var copingAction = "Start 10-minute pause"
    @State private var isTimerRunning = false
    @State private var remainingSeconds = 10 * 60
    @State private var urgeAfter = 4.0
    @State private var outcome = "Urge passed"
    @State private var timerTask: Task<Void, Never>?

    private let feelings = ["stressed", "bored", "tired", "reward", "other"]
    private let actions = [
        "Start 10-minute pause", "Drink water or tea", "Leave the kitchen",
        "Take a short walk", "Brush teeth", "Eat planned snack", "Choose another coping action",
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    CheckInSlider(title: "How strong is the urge?", value: $urge)
                    CheckInSlider(title: "Are you physically hungry?", value: $hunger)
                    ChipGroup(title: "What are you feeling?", options: feelings, selection: $selectedFeelings)
                    Picker("Action", selection: $copingAction) {
                        ForEach(actions, id: \.self) { Text($0).tag($0) }
                    }
                    .pickerStyle(.inline)

                    Button {
                        startTimer()
                    } label: {
                        ActionButtonLabel(title: timerText, systemImage: "timer")
                    }
                    .buttonStyle(PrimaryActionButtonStyle())

                    CheckInSlider(title: "Urge after pause", value: $urgeAfter)
                    Picker("Outcome", selection: $outcome) {
                        ForEach(["Eat planned food", "Wait 10 more minutes", "Log what I ate", "Urge passed"], id: \.self) {
                            Text($0).tag($0)
                        }
                    }
                    .pickerStyle(.segmented)
                }
                .padding(18)
            }
            .background(FitnessTheme.background.ignoresSafeArea())
            .navigationTitle("Urge support")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await onSave(draft)
                            dismiss()
                        }
                    }
                }
            }
            .onDisappear {
                timerTask?.cancel()
            }
        }
    }

    private var timerText: String {
        isTimerRunning
            ? "Pause \(remainingSeconds / 60):\(String(format: "%02d", remainingSeconds % 60))"
            : "Start 10-minute pause"
    }

    private var draft: EatingCheckInDraft {
        EatingCheckInDraft(
            hungerBefore: Int(hunger.rounded()),
            urgeIntensity: Int(urge.rounded()),
            emotionIntensity: Int(urgeAfter.rounded()),
            emotions: Array(selectedFeelings).sorted(),
            triggers: ["Urge"],
            eatingContext: .unknown,
            copingAction: copingAction,
            urgeDelayMinutes: remainingSeconds < 10 * 60 ? 10 : nil,
            outcome: outcome
        )
    }

    private func startTimer() {
        timerTask?.cancel()
        remainingSeconds = 10 * 60
        isTimerRunning = true
        timerTask = Task { @MainActor in
            while remainingSeconds > 0 && !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                remainingSeconds -= 1
            }
            isTimerRunning = false
        }
    }
}

private struct OvereatingRecoverySheet: View {
    let onSave: (EatingCheckInDraft) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var hunger = 7.0
    @State private var feeling = "Stressed"
    @State private var thought = ""
    @State private var helpNextTime = ""
    @State private var ateUntilPain = false
    @State private var lossOfControl = true

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("One eating event does not ruin the day.")
                        .font(.title3.bold())
                        .foregroundStyle(.white)
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Next steps:")
                        Text("1. Do not skip the next meal")
                        Text("2. Do not fast or exercise as punishment")
                        Text("3. Return to the regular plan")
                        Text("4. Record what happened briefly")
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    CheckInSlider(title: "Hunger before", value: $hunger)
                    TextField("Main feeling", text: $feeling)
                        .textFieldStyle(.roundedBorder)
                    TextField("Main thought", text: $thought, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                    TextField("What could help next time?", text: $helpNextTime, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                    Toggle("Ate until pain", isOn: $ateUntilPain)
                    Toggle("Felt loss of control", isOn: $lossOfControl)
                }
                .padding(18)
            }
            .background(FitnessTheme.background.ignoresSafeArea())
            .navigationTitle("Recovery")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await onSave(draft)
                            dismiss()
                        }
                    }
                }
            }
        }
    }

    private var draft: EatingCheckInDraft {
        EatingCheckInDraft(
            hungerBefore: Int(hunger.rounded()),
            emotions: [feeling].filter { !$0.isEmpty },
            triggers: ["Overeating recovery"],
            automaticThought: trimmed(thought),
            balancedResponse: "Return to the normal next meal. No compensation.",
            eatingContext: .emotionalEating,
            lossOfControl: lossOfControl,
            ateUntilPain: ateUntilPain,
            outcome: trimmed(helpNextTime),
            note: "Recovery check-in"
        )
    }
}

private struct WeeklyCBTInsightsView: View {
    let insights: EatingWeeklyInsights
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if !insights.hasEnoughData {
                        EmptyNutritionState(
                            title: "Not enough information yet.",
                            detail: "A few short check-ins this week will make insights more useful.",
                            systemImage: "chart.line.uptrend.xyaxis"
                        )
                    }

                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                        insightCard("Avg hunger", value: formattedAverage(insights.averageHunger), icon: "dial.low")
                        insightCard("Avg fullness", value: formattedAverage(insights.averageFullness), icon: "dial.medium")
                        insightCard("Strong urges", value: "\(insights.strongUrges)", icon: "pause.circle")
                        insightCard("Urges delayed", value: "\(insights.urgesDelayed)", icon: "timer")
                        insightCard("Screens", value: "\(insights.screenEating)", icon: "tv")
                        insightCard("Second servings", value: "\(insights.secondServings)", icon: "plus.square")
                        insightCard("Ate until pain", value: "\(insights.ateUntilPain)", icon: "heart.slash")
                        insightCard("Loss of control", value: "\(insights.lossOfControl)", icon: "waveform.path")
                    }

                    patternCard(
                        title: "Evening pattern",
                        detail: insights.mostCommonTime.map { "Most check-ins happened around \($0.lowercased())." } ?? "No common time yet."
                    )
                    patternCard(
                        title: "Most common trigger",
                        detail: insights.mostCommonTrigger ?? "No repeated trigger yet."
                    )
                    patternCard(
                        title: "Helpful pattern",
                        detail: insights.mostEffectiveCopingAction.map { "\($0) helped at least once this week." } ?? "No repeated coping action yet."
                    )
                }
                .padding(18)
            }
            .background(FitnessTheme.background.ignoresSafeArea())
            .navigationTitle("Weekly insights")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func insightCard(_ title: String, value: String, icon: String) -> some View {
        OverviewValueCard(
            label: title,
            value: value,
            unit: "",
            systemImage: icon,
            tint: FitnessTheme.cyan
        )
    }

    private func patternCard(title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.headline)
            Text(detail)
                .font(.caption.weight(.semibold))
                .foregroundStyle(FitnessTheme.secondaryText)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12))
    }

    private func formattedAverage(_ value: Double?) -> String {
        value.map { String(format: "%.1f/10", $0) } ?? "Open"
    }
}

private struct CheckInSlider: View {
    let title: String
    @Binding var value: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                    .font(.headline)
                Spacer()
                Text("\(Int(value.rounded()))/10")
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(FitnessTheme.lime)
            }
            Slider(value: $value, in: 0...10, step: 1)
                .tint(FitnessTheme.lime)
                .accessibilityValue("\(Int(value.rounded())) out of 10")
        }
    }
}

private struct ChipGroup: View {
    let title: String
    let options: [String]
    @Binding var selection: Set<String>

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
            FlowLayout(spacing: 7) {
                ForEach(options, id: \.self) { option in
                    Button {
                        if selection.contains(option) {
                            selection.remove(option)
                        } else {
                            selection.insert(option)
                        }
                    } label: {
                        Text(option)
                            .font(.caption.weight(.bold))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(
                                selection.contains(option) ? FitnessTheme.lime.opacity(0.2) : FitnessTheme.rowFill,
                                in: Capsule()
                            )
                            .overlay(Capsule().stroke(FitnessTheme.cardStroke, lineWidth: 1))
                    }
                    .foregroundStyle(selection.contains(option) ? FitnessTheme.lime : FitnessTheme.secondaryText)
                    .accessibilityLabel("\(option), \(selection.contains(option) ? "selected" : "not selected")")
                }
            }
        }
    }
}

private struct FlowLayout<Content: View>: View {
    let spacing: CGFloat
    @ViewBuilder let content: () -> Content

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: spacing)], alignment: .leading, spacing: spacing) {
            content()
        }
    }
}

private func trimmed(_ value: String) -> String? {
    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmedValue.isEmpty ? nil : trimmedValue
}

private func formatQuantity(_ value: Double) -> String {
    value.rounded() == value ? "\(Int(value))" : String(format: "%.1f", value)
}

private enum NutritionBreakdownMacro: String, Identifiable {
    case calories
    case protein
    case carbs
    case fat
    case fiber

    var id: String { rawValue }

    var title: String {
        switch self {
        case .calories:
            return "Calories"
        case .protein:
            return "Protein"
        case .carbs:
            return "Carbs"
        case .fat:
            return "Fat"
        case .fiber:
            return "Fiber"
        }
    }

    var unit: String {
        self == .calories ? "kcal" : "g"
    }

    func value(in totals: MacroTotals) -> Double {
        switch self {
        case .calories:
            return totals.calories
        case .protein:
            return totals.proteinGrams
        case .carbs:
            return totals.carbsGrams
        case .fat:
            return totals.fatGrams
        case .fiber:
            return totals.fiberGrams
        }
    }
}

private struct PendingIngredientDeletion {
    let ingredient: MealIngredientEntry
    let meal: MealLogEntry
}

private struct NutritionMacroBreakdownView: View {
    let macro: NutritionBreakdownMacro
    let meals: [MealLogEntry]
    let dayTotals: MacroTotals
    let date: Date
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                FitnessTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(macro.title.uppercased())
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                                .foregroundStyle(FitnessTheme.lime)
                            Text("\(wholeNumber(totalValue)) \(macro.unit)")
                                .font(.system(size: 30, weight: .black, design: .rounded))
                                .foregroundStyle(.white)
                            Text(nutritionDayLabel(date))
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(FitnessTheme.secondaryText)
                        }

                        ForEach(meals) { meal in
                            GlassCard {
                                VStack(alignment: .leading, spacing: 10) {
                                    HStack(alignment: .firstTextBaseline) {
                                        Text(meal.title)
                                            .font(.system(size: 15, weight: .black, design: .rounded))
                                            .foregroundStyle(.white)
                                        Spacer(minLength: 8)
                                        Text(contributionText(value: macro.value(in: meal.totals)))
                                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                                            .foregroundStyle(FitnessTheme.lime)
                                    }

                                    if meal.ingredients.isEmpty {
                                        Text("No ingredient breakdown saved.")
                                            .font(.system(size: 12, weight: .medium))
                                            .foregroundStyle(FitnessTheme.secondaryText)
                                    } else {
                                        VStack(spacing: 0) {
                                            ForEach(meal.ingredients) { ingredient in
                                                HStack(alignment: .firstTextBaseline, spacing: 8) {
                                                    Text(ingredient.name)
                                                        .font(.system(size: 12, weight: .semibold))
                                                        .foregroundStyle(.white)
                                                        .lineLimit(2)
                                                    Spacer(minLength: 8)
                                                    Text(contributionText(value: macro.value(in: ingredient.totals)))
                                                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                                                        .foregroundStyle(FitnessTheme.secondaryText)
                                                }
                                                .padding(.vertical, 7)

                                                if ingredient.id != meal.ingredients.last?.id {
                                                    Divider().overlay(FitnessTheme.cardStroke)
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 18)
                    .padding(.bottom, 32)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                    .foregroundStyle(FitnessTheme.lime)
                }
            }
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    private var totalValue: Double {
        macro.value(in: dayTotals)
    }

    private func contributionText(value: Double) -> String {
        guard totalValue > 0 else {
            return "\(wholeNumber(value)) \(macro.unit)"
        }

        let percent = value / totalValue * 100
        return "\(wholeNumber(value)) \(macro.unit) · \(wholeNumber(percent))%"
    }
}

private struct NutritionDayReviewView: View {
    let date: Date
    let meals: [MealLogEntry]
    let totals: MacroTotals
    let targets: NutritionTargets?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                FitnessTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("DAY REVIEW")
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                                .foregroundStyle(FitnessTheme.lime)
                            Text(nutritionDayLabel(date))
                                .font(.system(size: 30, weight: .black, design: .rounded))
                                .foregroundStyle(.white)
                        }

                        GlassCard {
                            VStack(alignment: .leading, spacing: 12) {
                                SectionHeader(title: "Keep", trailing: "\(meals.count) meals")
                                ForEach(keeps, id: \.self) { item in
                                    ReviewBullet(text: item, systemImage: "checkmark.circle.fill", color: FitnessTheme.lime)
                                }
                            }
                        }

                        GlassCard {
                            VStack(alignment: .leading, spacing: 12) {
                                SectionHeader(title: "Improve", trailing: "\(wholeNumber(totals.calories)) kcal")
                                ForEach(improvements, id: \.self) { item in
                                    ReviewBullet(text: item, systemImage: "arrow.up.right.circle.fill", color: FitnessTheme.orange)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 18)
                    .padding(.bottom, 32)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                    .foregroundStyle(FitnessTheme.lime)
                }
            }
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    private var keeps: [String] {
        var items: [String] = []

        if totals.proteinGrams >= Double(targets?.proteinGrams ?? 130) * 0.85 {
            items.append("Protein is close to target. Keep anchoring meals around protein.")
        }

        if meals.contains(where: { !$0.ingredients.isEmpty }) {
            items.append("Ingredient breakdowns are useful. Keep logging foods separately when you can.")
        }

        if items.isEmpty {
            items.append("You logged the day. That makes the next adjustment easier and less guessy.")
        }

        return items
    }

    private var improvements: [String] {
        guard let targets else {
            return ["Set targets to compare calories and macros against your current plan."]
        }

        var items: [String] = []
        let calorieGap = totals.calories - Double(targets.selectedCalories)
        let proteinGap = Double(targets.proteinGrams) - totals.proteinGrams
        let fiberGap = Double(targets.fiberGrams) - totals.fiberGrams

        if calorieGap > 150 {
            items.append("Calories are about \(wholeNumber(calorieGap)) kcal over target. Do not compensate hard; make the next meal normal and protein-forward.")
        } else if calorieGap < -300 {
            items.append("Calories are still low by about \(wholeNumber(abs(calorieGap))) kcal. Avoid turning that gap into late random snacks.")
        }

        if proteinGap > 20 {
            items.append("Protein is short by about \(wholeNumber(proteinGap))g. Add a lean protein serving earlier in the day.")
        }

        if fiberGap > 8 {
            items.append("Fiber is short by about \(wholeNumber(fiberGap))g. Add vegetables, fruit, legumes, or whole grains.")
        }

        if items.isEmpty {
            items.append("Nothing obvious needs a hard change. Keep the structure and log any missing snacks or drinks.")
        }

        return items
    }
}

private struct ReviewBullet: View {
    let text: String
    let systemImage: String
    let color: Color

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(color)
                .frame(width: 18, height: 18)

            Text(text)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(FitnessTheme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct FoodLogStickyHeader<Pager: View>: View {
    let mealCount: Int
    let isRefreshing: Bool
    let pager: Pager
    let onRefresh: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 10) {
                SectionHeader(title: "Food Log", trailing: "\(mealCount) meals")

                Button(action: onRefresh) {
                    if isRefreshing {
                        ProgressView()
                            .controlSize(.small)
                            .tint(FitnessTheme.lime)
                    } else {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(FitnessTheme.lime)
                    }
                }
                .buttonStyle(.plain)
                .disabled(isRefreshing)
                .accessibilityLabel("Refresh food log")
            }
            pager
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(FitnessTheme.background.opacity(0.96))
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(FitnessTheme.cardStroke)
                .frame(height: 1)
        }
    }
}

private struct DayChangePromptView: View {
    let date: Date
    let meals: [MealLogEntry]
    @Binding var request: String
    let onSubmit: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                FitnessTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("AI CHANGE")
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                                .foregroundStyle(FitnessTheme.lime)
                            Text(nutritionDayLabel(date))
                                .font(.system(size: 30, weight: .black, design: .rounded))
                                .foregroundStyle(.white)
                            Text("\(meals.count) current meal\(meals.count == 1 ? "" : "s")")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(FitnessTheme.secondaryText)
                        }

                        GlassCard {
                            VStack(alignment: .leading, spacing: 12) {
                                SectionHeader(title: "Request", trailing: "reviewed")

                                TextField("Add, remove, edit, or replace foods", text: $request, axis: .vertical)
                                    .lineLimit(4...9)
                                    .textInputAutocapitalization(.sentences)
                                    .padding(12)
                                    .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12))
                                    .foregroundStyle(.white)
                                    .accessibilityLabel("AI day change request")

                                DayChangeQuickActions(onPick: appendQuickAction)

                                Text("The next screen will show AI-estimated drafts for review before anything is saved.")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(FitnessTheme.secondaryText)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }

                        GlassCard {
                            VStack(alignment: .leading, spacing: 12) {
                                SectionHeader(title: "Current Day", trailing: "\(meals.count)")

                                if meals.isEmpty {
                                    Text("No meals logged.")
                                        .font(.system(size: 13, weight: .medium))
                                        .foregroundStyle(FitnessTheme.secondaryText)
                                } else {
                                    VStack(spacing: 0) {
                                        ForEach(meals) { meal in
                                            VStack(alignment: .leading, spacing: 4) {
                                                Text(meal.title)
                                                    .font(.system(size: 13, weight: .semibold))
                                                    .foregroundStyle(.white)
                                                Text(meal.ingredients.isEmpty
                                                     ? "\(wholeNumber(meal.totals.calories)) kcal"
                                                     : meal.ingredients.map(\.name).joined(separator: ", "))
                                                    .font(.system(size: 11, weight: .medium))
                                                    .foregroundStyle(FitnessTheme.secondaryText)
                                                    .lineLimit(2)
                                            }
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                            .padding(.vertical, 8)

                                            if meal.id != meals.last?.id {
                                                Divider().overlay(FitnessTheme.cardStroke)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 18)
                    .padding(.bottom, 32)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .foregroundStyle(FitnessTheme.secondaryText)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Review") {
                        onSubmit(request)
                    }
                    .fontWeight(.bold)
                    .foregroundStyle(FitnessTheme.lime)
                    .disabled(request.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    private func appendQuickAction(_ text: String) {
        let trimmed = request.trimmingCharacters(in: .whitespacesAndNewlines)
        request = trimmed.isEmpty ? text : "\(trimmed)\n\(text)"
    }
}

private struct DayChangeQuickActions: View {
    let onPick: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                quickAction("Add", text: "Add ")
                quickAction("Remove", text: "Remove ")
                quickAction("Edit", text: "Edit ")
                quickAction("Replace", text: "Replace  with ")
            }
            .padding(.vertical, 2)
        }
    }

    private func quickAction(_ title: String, text: String) -> some View {
        Button {
            onPick(text)
        } label: {
            Text(title)
                .font(.system(size: 12, weight: .bold, design: .monospaced))
                .foregroundStyle(FitnessTheme.lime)
                .padding(.horizontal, 12)
                .frame(height: 34)
                .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(FitnessTheme.cardStroke, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}

private struct NutritionDayPager: View {
    let date: Date
    let canMoveForward: Bool
    let onPrevious: () -> Void
    let onNext: () -> Void
    let onToday: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button(action: onPrevious) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 13, weight: .black))
                    .frame(width: 34, height: 34)
            }
            .buttonStyle(.plain)
            .foregroundStyle(FitnessTheme.lime)
            .background(FitnessTheme.rowFill, in: Circle())
            .accessibilityLabel("Previous day")

            VStack(alignment: .leading, spacing: 2) {
                Text(nutritionDayLabel(date))
                    .font(.system(size: 14, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
                Text(date.formatted(.dateTime.day().month(.wide).year()))
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.secondaryText)
            }

            Spacer(minLength: 8)

            Button(action: onToday) {
                Text("Today")
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                    .padding(.horizontal, 10)
                    .frame(height: 34)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Calendar.current.isDateInToday(date) ? FitnessTheme.secondaryText : FitnessTheme.lime)
            .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(FitnessTheme.cardStroke, lineWidth: 1)
            )
            .accessibilityLabel("Jump to today")

            Button(action: onNext) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .black))
                    .frame(width: 34, height: 34)
            }
            .buttonStyle(.plain)
            .foregroundStyle(canMoveForward ? FitnessTheme.lime : FitnessTheme.secondaryText.opacity(0.4))
            .background(FitnessTheme.rowFill, in: Circle())
            .disabled(!canMoveForward)
            .accessibilityLabel("Next day")
        }
        .padding(10)
        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(FitnessTheme.cardStroke, lineWidth: 1)
        )
        .gesture(
            DragGesture(minimumDistance: 35)
                .onEnded { value in
                    guard abs(value.translation.width) > abs(value.translation.height),
                          abs(value.translation.width) > 45 else {
                        return
                    }

                    if value.translation.width < 0 {
                        onNext()
                    } else {
                        onPrevious()
                    }
                }
        )
    }
}

private struct MacroProgressRow: View {
    let title: String
    let current: Double
    let target: Double
    let unit: String
    let tint: Color
    let onTap: (() -> Void)?

    init(
        title: String,
        current: Double,
        target: Double,
        unit: String,
        tint: Color,
        onTap: (() -> Void)? = nil
    ) {
        self.title = title
        self.current = current
        self.target = target
        self.unit = unit
        self.tint = tint
        self.onTap = onTap
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(title)
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    .textCase(.uppercase)

                Spacer(minLength: 8)

                if isOverTarget {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(FitnessTheme.orange)
                        .accessibilityLabel("Over target")
                }

                Text("\(wholeNumber(current)) / \(wholeNumber(target)) \(unit)")
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                    .foregroundStyle(isOverTarget ? FitnessTheme.orange : .white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
            }

            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(FitnessTheme.cardStroke)
                    Capsule()
                        .fill(tint)
                        .frame(width: geometry.size.width * cappedFraction)

                    if isOverTarget {
                        Capsule()
                            .stroke(FitnessTheme.orange.opacity(0.8), lineWidth: 1)
                    }
                }
                .clipShape(Capsule())
            }
            .frame(height: 7)
            .accessibilityHidden(true)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            onTap?()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(title)
        .accessibilityValue(
            isOverTarget
                ? "\(wholeNumber(current)) of \(wholeNumber(target)) \(unit), over target"
                : "\(wholeNumber(current)) of \(wholeNumber(target)) \(unit)"
        )
    }

    private var fraction: CGFloat {
        guard target > 0 else {
            return 0
        }

        return CGFloat(current / target)
    }

    private var cappedFraction: CGFloat {
        min(max(fraction, 0), 1)
    }

    private var isOverTarget: Bool {
        target > 0 && current > target
    }
}

private struct CompactMealRow: View {
    let meal: MealLogEntry
    let thumbnailData: Data?

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            if thumbnailData != nil || !meal.photoAttachments.isEmpty {
                MealThumbnail(
                    data: thumbnailData,
                    photoCount: meal.photoAttachments.count,
                    size: 42
                )
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(meal.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Text("\(meal.mealType) · \(meal.loggedAt.formatted(.dateTime.hour().minute()))")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(FitnessTheme.secondaryText)
            }

            Spacer(minLength: 8)

            HStack(spacing: 6) {
                if !meal.photoAttachments.isEmpty, thumbnailData == nil {
                    Image(systemName: "photo.fill")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(FitnessTheme.cyan)
                        .accessibilityLabel("Has photos")
                }

                if !meal.ingredients.isEmpty {
                    Image(systemName: "list.bullet.rectangle")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(FitnessTheme.lime)
                        .accessibilityLabel("Has ingredient breakdown")
                }

                Text("\(wholeNumber(meal.totals.calories)) kcal")
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.orange)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }
}

private struct HomeMealLogRow: View {
    let meal: MealLogEntry
    let dayTotals: MacroTotals
    let thumbnailData: Data?
    let linkedPlanTitle: String?
    let linkedCheckIns: [EatingCheckInRecord]
    let onEdit: () -> Void
    let onAddCheckIn: () -> Void
    let onDeleteMeal: () -> Void
    let onDeleteIngredient: (MealIngredientEntry) -> Void
    @Binding var draggingMealID: UUID?
    @Binding var draggingIngredientID: UUID?
    @Binding var dropTargetMealID: UUID?
    @Binding var dropTargetIngredientID: UUID?
    let onMoveMeal: (UUID, UUID) -> Void
    let onMoveIngredient: (UUID, UUID) -> Void
    let onMoveIngredientToMeal: (UUID) -> Void

    var body: some View {
        mealContent
        .contentShape(Rectangle())
        .onDrag {
            draggingMealID = meal.id
            return NSItemProvider(object: meal.id.uuidString as NSString)
        } preview: {
            DragPreviewCard(
                title: meal.title,
                subtitle: "\(wholeNumber(meal.totals.calories)) kcal"
            )
        }
        .onDrop(
            of: [UTType.text],
            delegate: MealSectionDropDelegate(
                targetMealID: meal.id,
                draggingMealID: $draggingMealID,
                draggingIngredientID: $draggingIngredientID,
                dropTargetMealID: $dropTargetMealID,
                dropTargetIngredientID: $dropTargetIngredientID,
                onMoveMeal: onMoveMeal,
                onMoveIngredientToMeal: onMoveIngredientToMeal
            )
        )
    }

    private var mealContent: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .top, spacing: 10) {
                DragHandle()
                    .onDrag {
                        draggingMealID = meal.id
                        return NSItemProvider(object: meal.id.uuidString as NSString)
                    } preview: {
                        DragPreviewCard(
                            title: meal.title,
                            subtitle: "\(wholeNumber(meal.totals.calories)) kcal"
                        )
                    }
                    .accessibilityLabel("Reorder meal")

                if thumbnailData != nil || !meal.photoAttachments.isEmpty {
                    MealThumbnail(
                        data: thumbnailData,
                        photoCount: meal.photoAttachments.count,
                        size: 48
                    )
                }

                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 6) {
                        Text(meal.title)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                            .lineLimit(2)
                        MealStateBadge(title: "Logged", systemImage: "checkmark.circle.fill", tint: FitnessTheme.lime)
                        MealStateBadge(
                            title: linkedPlanTitle == nil ? "Unplanned" : "From plan",
                            systemImage: linkedPlanTitle == nil ? "plus.circle" : "arrow.triangle.merge",
                            tint: linkedPlanTitle == nil ? FitnessTheme.orange : FitnessTheme.cyan
                        )
                        if meal.estimateStatus != .aiEstimated {
                            MealStateBadge(title: "Edited", systemImage: "pencil.circle", tint: FitnessTheme.violet)
                        }
                    }

                    if meal.ingredients.isEmpty, !meal.note.isEmpty, meal.note != meal.title {
                        Text(meal.note)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(FitnessTheme.secondaryText)
                            .lineLimit(3)
                    }

                    Text(mealMacroSummary(meal.totals, dayTotals: dayTotals))
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(FitnessTheme.secondaryText)
                        .lineLimit(2)
                        .minimumScaleFactor(0.72)

                    if let linkedPlanTitle {
                        Text("Plan link: \(linkedPlanTitle)")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(FitnessTheme.cyan)
                    }

                    if let checkIn = linkedCheckIns.last {
                        Label(checkIn.summaryText, systemImage: "book.closed.fill")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(FitnessTheme.secondaryText)
                            .lineLimit(2)
                    }
                }

                Spacer(minLength: 8)

                VStack(alignment: .trailing, spacing: 5) {
                    Text("\(wholeNumber(meal.totals.calories)) kcal")
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                        .foregroundStyle(FitnessTheme.orange)

                    HStack(spacing: 4) {
                        Button(action: onEdit) {
                            Image(systemName: "pencil")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(FitnessTheme.lime)
                                .frame(width: 32, height: 30)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Edit meal")

                        Button(action: onAddCheckIn) {
                            Image(systemName: "square.and.pencil")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(FitnessTheme.cyan)
                                .frame(width: 32, height: 30)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Add eating check-in")

                        Button(action: onDeleteMeal) {
                            Image(systemName: "trash")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(FitnessTheme.error)
                                .frame(width: 32, height: 30)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Delete meal")
                    }
                }
            }

            if !meal.ingredients.isEmpty {
                VStack(spacing: 0) {
                    ForEach(meal.ingredients) { ingredient in
                        HomeIngredientRow(
                            ingredient: ingredient,
                            dayTotals: dayTotals,
                            onDelete: {
                                onDeleteIngredient(ingredient)
                            },
                            draggingIngredientID: $draggingIngredientID,
                            dropTargetIngredientID: $dropTargetIngredientID,
                            onMoveIngredient: { draggedID, targetID in
                                onMoveIngredient(draggedID, targetID)
                            }
                        )

                        if ingredient.id != meal.ingredients.last?.id {
                            Divider().overlay(FitnessTheme.cardStroke)
                        }
                    }
                }
                .background(FitnessTheme.cardStroke.opacity(0.32), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
        .padding(12)
        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(
                    dropTargetMealID == meal.id
                        ? FitnessTheme.lime.opacity(0.9)
                        : FitnessTheme.cardStroke,
                    lineWidth: dropTargetMealID == meal.id ? 2 : 1
                )
        )
        .opacity(draggingMealID == meal.id ? 0.42 : 1)
        .scaleEffect(draggingMealID == meal.id ? 0.985 : 1)
        .animation(.snappy(duration: 0.18), value: draggingMealID)
        .animation(.snappy(duration: 0.18), value: dropTargetMealID)
    }
}

private struct HomeIngredientRow: View {
    let ingredient: MealIngredientEntry
    let dayTotals: MacroTotals
    let onDelete: () -> Void
    @Binding var draggingIngredientID: UUID?
    @Binding var dropTargetIngredientID: UUID?
    let onMoveIngredient: (UUID, UUID) -> Void

    var body: some View {
        ingredientContent
        .contentShape(Rectangle())
        .onDrag {
            draggingIngredientID = ingredient.id
            return NSItemProvider(object: ingredient.id.uuidString as NSString)
        } preview: {
            DragPreviewCard(
                title: ingredient.name,
                subtitle: "\(formatPortion(ingredient.quantity)) \(ingredient.unit)"
            )
        }
        .onDrop(
            of: [UTType.text],
            delegate: UUIDReorderDropDelegate(
                targetID: ingredient.id,
                draggingID: $draggingIngredientID,
                dropTargetID: $dropTargetIngredientID,
                onMove: onMoveIngredient
            )
        )
    }

    private var ingredientContent: some View {
        HStack(alignment: .top, spacing: 8) {
            DragHandle()
                .onDrag {
                    draggingIngredientID = ingredient.id
                    return NSItemProvider(object: ingredient.id.uuidString as NSString)
                } preview: {
                    DragPreviewCard(
                        title: ingredient.name,
                        subtitle: "\(formatPortion(ingredient.quantity)) \(ingredient.unit)"
                    )
                }
                .accessibilityLabel("Reorder ingredient")

            VStack(alignment: .leading, spacing: 4) {
                Text("\(formatPortion(ingredient.quantity)) \(ingredient.unit) \(ingredient.name)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(2)

                Text(ingredientMacroSummary(ingredient.totals, dayTotals: dayTotals))
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    .lineLimit(2)
                    .minimumScaleFactor(0.72)
            }

            Spacer(minLength: 8)

            Button(action: onDelete) {
                Image(systemName: "trash")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(FitnessTheme.error)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Delete \(ingredient.name)")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .background(
            dropTargetIngredientID == ingredient.id
                ? FitnessTheme.lime.opacity(0.12)
                : Color.clear,
            in: RoundedRectangle(cornerRadius: 9, style: .continuous)
        )
        .opacity(draggingIngredientID == ingredient.id ? 0.38 : 1)
        .animation(.snappy(duration: 0.18), value: draggingIngredientID)
        .animation(.snappy(duration: 0.18), value: dropTargetIngredientID)
    }
}

private struct DragHandle: View {
    var body: some View {
        Image(systemName: "line.3.horizontal")
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(FitnessTheme.secondaryText)
            .frame(width: 30, height: 30)
            .background(FitnessTheme.cardStroke.opacity(0.25), in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct DragPreviewCard: View {
    let title: String
    let subtitle: String

    var body: some View {
        HStack(spacing: 10) {
            DragHandle()

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    .lineLimit(1)
            }
        }
        .padding(12)
        .frame(width: 220, alignment: .leading)
        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(FitnessTheme.lime.opacity(0.8), lineWidth: 1)
        )
    }
}

private struct UUIDReorderDropDelegate: DropDelegate {
    let targetID: UUID
    @Binding var draggingID: UUID?
    @Binding var dropTargetID: UUID?
    let onMove: (UUID, UUID) -> Void

    func dropEntered(info: DropInfo) {
        guard let draggingID, draggingID != targetID else {
            return
        }

        dropTargetID = targetID
        onMove(draggingID, targetID)
    }

    func performDrop(info: DropInfo) -> Bool {
        self.draggingID = nil
        self.dropTargetID = nil
        return true
    }

    func dropExited(info: DropInfo) {
        if dropTargetID == targetID {
            dropTargetID = nil
        }
    }
}

private struct MealSectionDropDelegate: DropDelegate {
    let targetMealID: UUID
    @Binding var draggingMealID: UUID?
    @Binding var draggingIngredientID: UUID?
    @Binding var dropTargetMealID: UUID?
    @Binding var dropTargetIngredientID: UUID?
    let onMoveMeal: (UUID, UUID) -> Void
    let onMoveIngredientToMeal: (UUID) -> Void

    func dropEntered(info: DropInfo) {
        if let draggingMealID, draggingMealID != targetMealID {
            dropTargetMealID = targetMealID
            onMoveMeal(draggingMealID, targetMealID)
        } else if draggingIngredientID != nil {
            dropTargetMealID = targetMealID
        }
    }

    func performDrop(info: DropInfo) -> Bool {
        if let draggingIngredientID {
            onMoveIngredientToMeal(draggingIngredientID)
            self.draggingIngredientID = nil
            self.dropTargetIngredientID = nil
            self.dropTargetMealID = nil
            return true
        }

        draggingMealID = nil
        dropTargetMealID = nil
        return true
    }

    func dropExited(info: DropInfo) {
        if dropTargetMealID == targetMealID {
            dropTargetMealID = nil
        }
    }
}

private struct MealThumbnail: View {
    let data: Data?
    let photoCount: Int
    let size: CGFloat

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Group {
                if let data,
                   let image = UIImage(data: data) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                } else {
                    FitnessTheme.rowFill
                        .overlay {
                            Image(systemName: "photo.fill")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(FitnessTheme.cyan)
                        }
                }
            }
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(FitnessTheme.cardStroke, lineWidth: 1)
            )

            if photoCount > 1 {
                Text("\(photoCount)")
                    .font(.system(size: 9, weight: .black, design: .monospaced))
                    .foregroundStyle(FitnessTheme.actionText)
                    .padding(.horizontal, 5)
                    .frame(height: 16)
                    .background(FitnessTheme.cyan, in: Capsule())
                    .offset(x: 4, y: 4)
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel(photoCount == 1 ? "Meal photo" : "\(photoCount) meal photos")
    }
}

private struct NutritionCoachSummaryCard: View {
    let date: Date
    let mealCount: Int
    let totals: MacroTotals
    let targets: NutritionTargets

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "sparkles")
                .font(.system(size: 13, weight: .black))
                .foregroundStyle(FitnessTheme.actionText)
                .frame(width: 30, height: 30)
                .background(FitnessTheme.lime, in: Circle())

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 13, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
                Text(message)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(FitnessTheme.cardStroke, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    private var title: String {
        Calendar.current.isDateInToday(date) ? "Before Sleep Check-In" : "Day Summary"
    }

    private var message: String {
        guard mealCount > 0 else {
            return "No meals logged. Add even rough notes or photos so the coach can learn your real routine."
        }

        let calorieGap = Double(targets.selectedCalories) - totals.calories
        let proteinGap = Double(targets.proteinGrams) - totals.proteinGrams

        if calorieGap < -150 {
            return "You are about \(wholeNumber(abs(calorieGap))) kcal over target. Do not compensate hard; make the next meal normal and protein-forward."
        }

        if proteinGap > 20 {
            return "Protein is still short by about \(wholeNumber(proteinGap))g. A lean protein serving would help more than cutting calories."
        }

        if calorieGap > 300 {
            return "You have about \(wholeNumber(calorieGap)) kcal left. Keep dinner simple and avoid turning the gap into late snacks."
        }

        return "Calories and protein are close to plan. Finish the day normally and log anything else before sleep."
    }
}

private struct CoachSetupView: View {
    let existingProfile: CoachProfile?
    let healthDefaults: CoachHealthDefaults
    let onSave: (CoachProfile) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var goal: CoachGoal
    @State private var weightKg: Double
    @State private var estimatedStepsPerDay: Double
    @State private var estimatedActiveCaloriesPerDay: Double
    @State private var estimatedRestingCaloriesPerDay: Double
    @State private var useObservedEnergyEstimate: Bool
    @State private var wakeTimeMinutes: Int
    @State private var sleepTimeMinutes: Int
    @State private var mealSlots: [CoachMealSlot]
    @State private var mealRemindersEnabled: Bool

    init(
        existingProfile: CoachProfile?,
        healthDefaults: CoachHealthDefaults,
        onSave: @escaping (CoachProfile) -> Void
    ) {
        let draft = CoachProfile.draft(
            existingProfile: existingProfile,
            healthDefaults: healthDefaults
        )
        self.existingProfile = existingProfile
        self.healthDefaults = healthDefaults
        self.onSave = onSave
        _goal = State(initialValue: draft.goal)
        _weightKg = State(initialValue: draft.weightKg)
        _estimatedStepsPerDay = State(initialValue: Double(draft.estimatedStepsPerDay))
        _estimatedActiveCaloriesPerDay = State(initialValue: draft.estimatedActiveCaloriesPerDay ?? 900)
        _estimatedRestingCaloriesPerDay = State(initialValue: draft.estimatedRestingCaloriesPerDay ?? 2_100)
        _useObservedEnergyEstimate = State(
            initialValue: draft.estimatedActiveCaloriesPerDay != nil
                || draft.estimatedRestingCaloriesPerDay != nil
        )
        _wakeTimeMinutes = State(initialValue: draft.wakeTimeMinutes)
        _sleepTimeMinutes = State(initialValue: draft.sleepTimeMinutes)
        _mealSlots = State(initialValue: draft.effectiveMealSlots)
        _mealRemindersEnabled = State(initialValue: draft.mealRemindersEnabled)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                FitnessTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("QUESTIONNAIRE")
                                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                .foregroundStyle(FitnessTheme.lime)
                            Text("Coach Setup")
                                .font(.system(size: 30, weight: .black, design: .rounded))
                                .foregroundStyle(.white)
                        }

                        GlassCard {
                            VStack(alignment: .leading, spacing: 14) {
                                SectionHeader(title: "Goal", trailing: goal.title)

                                Picker("Goal", selection: $goal) {
                                    ForEach(CoachGoal.allCases) { goal in
                                        Text(goal.title).tag(goal)
                                    }
                                }
                                .pickerStyle(.segmented)

                                Text(goal.targetCaption)
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(FitnessTheme.secondaryText)
                            }
                        }

                        GlassCard {
                            VStack(alignment: .leading, spacing: 16) {
                                SectionHeader(title: "Baseline", trailing: "Health first")

                                WeightWheelInput(weightKg: $weightKg)

                                VStack(alignment: .leading, spacing: 8) {
                                    HStack {
                                        Text("Steps")
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(.white)
                                        Spacer()
                                        Text("\(Int(estimatedStepsPerDay).formatted(.number)) / day")
                                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                                            .foregroundStyle(FitnessTheme.lime)
                                    }

                                    Slider(
                                        value: $estimatedStepsPerDay,
                                        in: 3_000...25_000,
                                        step: 500
                                    )
                                    .tint(FitnessTheme.lime)
                                }

                                SettingsToggleRow(
                                    title: "Use Active Calories",
                                    subtitle: "Blend resting + active energy into maintenance. Leave off to use weight and steps only.",
                                    isOn: $useObservedEnergyEstimate
                                )

                                if useObservedEnergyEstimate {
                                    VStack(spacing: 10) {
                                        NumberStepperRow(
                                            title: "Active kcal",
                                            value: $estimatedActiveCaloriesPerDay,
                                            range: 0...10_000,
                                            step: 50,
                                            unit: "/ day"
                                        )
                                        NumberStepperRow(
                                            title: "Resting kcal",
                                            value: $estimatedRestingCaloriesPerDay,
                                            range: 500...5_000,
                                            step: 50,
                                            unit: "/ day"
                                        )
                                    }
                                }
                            }
                        }

                        GlassCard {
                            VStack(alignment: .leading, spacing: 14) {
                                SectionHeader(title: "Routine", trailing: "Daily")
                                TimePickerRow(title: "Wake", minutes: $wakeTimeMinutes)
                                TimePickerRow(title: "Sleep", minutes: $sleepTimeMinutes)
                                Divider().overlay(FitnessTheme.cardStroke)
                                VStack(spacing: 10) {
                                    ForEach($mealSlots) { slot in
                                        MealSlotEditorRow(
                                            slot: slot,
                                            canDelete: mealSlots.count > 1
                                        ) {
                                            removeMealSlot(slot.wrappedValue.id)
                                        }
                                    }
                                }

                                Button {
                                    addMealSlot()
                                } label: {
                                    Label("Add Meal", systemImage: "plus.circle.fill")
                                        .font(.system(size: 13, weight: .bold))
                                        .frame(maxWidth: .infinity)
                                }
                                .buttonStyle(SecondaryActionButtonStyle())

                                Divider().overlay(FitnessTheme.cardStroke)
                                SettingsToggleRow(
                                    title: "Meal Reminders",
                                    subtitle: "Use these meal times for local reminders.",
                                    isOn: $mealRemindersEnabled
                                )
                            }
                        }

                        GlassCard {
                            VStack(alignment: .leading, spacing: 12) {
                                SectionHeader(title: "Targets", trailing: goal.title)

                                let targets = currentTargets
                                SummaryRow(title: "Calories", value: "\(targets.selectedCalories) kcal")
                                SummaryRow(title: "Protein", value: "\(targets.proteinGrams)g")
                                SummaryRow(title: "Fat", value: "\(targets.fatGrams)g")
                                SummaryRow(title: "Carbs", value: "\(targets.carbGrams)g")
                                SummaryRow(title: "Fiber", value: "\(targets.fiberGrams)g")
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 18)
                    .padding(.bottom, 32)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .foregroundStyle(FitnessTheme.secondaryText)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") {
                        onSave(currentProfile)
                        dismiss()
                    }
                    .fontWeight(.bold)
                    .foregroundStyle(FitnessTheme.lime)
                }
            }
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    private var currentProfile: CoachProfile {
        CoachProfile(
            goal: goal,
            weightKg: weightKg,
            estimatedStepsPerDay: Int(estimatedStepsPerDay),
            estimatedActiveCaloriesPerDay: useObservedEnergyEstimate ? estimatedActiveCaloriesPerDay : nil,
            estimatedRestingCaloriesPerDay: useObservedEnergyEstimate ? estimatedRestingCaloriesPerDay : nil,
            wakeTimeMinutes: wakeTimeMinutes,
            sleepTimeMinutes: sleepTimeMinutes,
            breakfastTimeMinutes: slotTime(
                id: CoachMealSlot.breakfastId,
                fallback: CoachMealSlot.defaultSlots[0].timeMinutes
            ),
            lunchTimeMinutes: slotTime(
                id: CoachMealSlot.lunchId,
                fallback: CoachMealSlot.defaultSlots[1].timeMinutes
            ),
            snackTimeMinutes: slotTime(
                id: CoachMealSlot.snackId,
                fallback: CoachMealSlot.defaultSlots[2].timeMinutes
            ),
            dinnerTimeMinutes: slotTime(
                id: CoachMealSlot.dinnerId,
                fallback: CoachMealSlot.defaultSlots[3].timeMinutes
            ),
            mealRemindersEnabled: mealRemindersEnabled,
            mealSlots: normalizedMealSlots,
            completedAt: existingProfile?.completedAt ?? Date()
        )
    }

    private var currentTargets: NutritionTargets {
        NutritionTargetCalculator.targets(for: currentProfile)
    }

    private var normalizedMealSlots: [CoachMealSlot] {
        let slots = mealSlots.map { slot in
            CoachMealSlot(
                id: slot.id,
                name: slot.displayName,
                timeMinutes: min(max(slot.timeMinutes, 0), 23 * 60 + 59),
                remindersEnabled: slot.remindersEnabled
            )
        }

        return slots.isEmpty ? CoachMealSlot.defaultSlots : slots
    }

    private func addMealSlot() {
        let nextTime = mealSlots.last.map { min($0.timeMinutes + 180, 23 * 60) } ?? 12 * 60
        mealSlots.append(
            CoachMealSlot(
                id: UUID(),
                name: "Meal \(mealSlots.count + 1)",
                timeMinutes: nextTime,
                remindersEnabled: true
            )
        )
    }

    private func removeMealSlot(_ id: UUID) {
        guard mealSlots.count > 1 else {
            return
        }

        mealSlots.removeAll { $0.id == id }
    }

    private func slotTime(id: UUID, fallback: Int) -> Int {
        normalizedMealSlots.first { $0.id == id }?.timeMinutes ?? fallback
    }
}

private struct MealSlotEditorRow: View {
    @Binding var slot: CoachMealSlot
    let canDelete: Bool
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                TextField("Meal", text: $slot.name)
                    .textInputAutocapitalization(.words)
                    .font(.system(size: 14, weight: .semibold))
                    .padding(10)
                    .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 10))
                    .foregroundStyle(.white)

                Button(action: onDelete) {
                    Image(systemName: "trash")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(canDelete ? FitnessTheme.error : FitnessTheme.secondaryText)
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.plain)
                .disabled(!canDelete)
                .accessibilityLabel("Delete \(slot.displayName)")
            }

            HStack(spacing: 12) {
                TimePickerRow(title: "Time", minutes: $slot.timeMinutes)

                Toggle("Reminder", isOn: $slot.remindersEnabled)
                    .toggleStyle(.switch)
                    .tint(FitnessTheme.lime)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    .labelsHidden()
                    .accessibilityLabel("Reminder for \(slot.displayName)")
            }
        }
        .padding(12)
        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(FitnessTheme.cardStroke, lineWidth: 1)
        )
    }
}

private struct WeightWheelInput: View {
    @Binding var weightKg: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Weight")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                Spacer()
                Text("\(formatValue(weightKg)) kg")
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.lime)
            }

            HStack(spacing: 4) {
                Picker("Weight kilograms", selection: wholeBinding) {
                    ForEach(40...180, id: \.self) { value in
                        Text("\(value)").tag(value)
                    }
                }
                .pickerStyle(.wheel)
                .frame(maxWidth: .infinity)
                .clipped()

                Text(".")
                    .font(.system(size: 30, weight: .black, design: .rounded))
                    .foregroundStyle(.white)

                Picker("Weight decimal", selection: tenthBinding) {
                    ForEach(0...9, id: \.self) { value in
                        Text("\(value)").tag(value)
                    }
                }
                .pickerStyle(.wheel)
                .frame(width: 86)
                .clipped()

                Text("kg")
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.secondaryText)
            }
            .frame(height: 118)
            .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(FitnessTheme.cardStroke, lineWidth: 1)
            )
        }
    }

    private var wholeBinding: Binding<Int> {
        Binding(
            get: {
                Int(weightKg.rounded(.down))
            },
            set: { newValue in
                weightKg = Double(newValue) + Double(tenthBinding.wrappedValue) / 10
            }
        )
    }

    private var tenthBinding: Binding<Int> {
        Binding(
            get: {
                Int((weightKg * 10).rounded()) % 10
            },
            set: { newValue in
                weightKg = Double(wholeBinding.wrappedValue) + Double(newValue) / 10
            }
        )
    }
}

private struct TimePickerRow: View {
    let title: String
    @Binding var minutes: Int

    var body: some View {
        DatePicker(
            title,
            selection: dateBinding,
            displayedComponents: .hourAndMinute
        )
        .datePickerStyle(.compact)
        .tint(FitnessTheme.lime)
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(.white)
    }

    private var dateBinding: Binding<Date> {
        Binding(
            get: {
                Self.date(from: minutes)
            },
            set: { date in
                minutes = Self.minutes(from: date)
            }
        )
    }

    private static func date(from minutes: Int) -> Date {
        var components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        components.hour = minutes / 60
        components.minute = minutes % 60

        return Calendar.current.date(from: components) ?? Date()
    }

    private static func minutes(from date: Date) -> Int {
        let components = Calendar.current.dateComponents([.hour, .minute], from: date)

        return (components.hour ?? 0) * 60 + (components.minute ?? 0)
    }
}

private struct MealLogEditorView: View {
    let profile: CoachProfile?
    @ObservedObject var mealStore: MealLogStore
    @ObservedObject var savedMealStore: SavedMealStore
    @Environment(\.dismiss) private var dismiss
    let existingMeal: MealLogEntry?
    let mealEstimateClient: MealEstimateClient
    let mealPersistenceClient: MealPersistenceClient
    let onNeedsSignIn: () -> Void
    @State private var selectedMealType: String
    @State private var customMealType = ""
    @State private var title = ""
    @State private var note = ""
    @State private var loggedAt = Date()
    @State private var calories = 500.0
    @State private var protein = 35.0
    @State private var carbs = 45.0
    @State private var fat = 18.0
    @State private var fiber = 6.0
    @State private var ingredients: [MealIngredientEntry] = []
    @State private var saveForQuickFill = false
    @State private var showManualSaveConfirmation = false
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var selectedPhotoData: [Data] = []
    @State private var isLoadingPhotos = false
    @State private var photoError: String?
    @State private var isEstimating = false
    @State private var retryingIngredientId: UUID?
    @State private var estimateMessage: String?
    @State private var estimateError: String?
    @State private var estimateNeedsSignIn = false
    @State private var estimateStatus: MealEstimateStatus = .manual
    @State private var estimateConfidence: Double?
    @State private var estimatedMealDrafts: [MealLogEntry] = []
    @State private var recentFoodSearch = ""
    @State private var selectedRecentFoodIDs: Set<String> = []

    init(
        profile: CoachProfile?,
        mealStore: MealLogStore,
        savedMealStore: SavedMealStore,
        existingMeal: MealLogEntry?,
        initialLoggedAt: Date = Date(),
        initialPrompt: String = "",
        mealEstimateClient: MealEstimateClient = MealEstimateClient(),
        mealPersistenceClient: MealPersistenceClient = MealPersistenceClient(),
        onNeedsSignIn: @escaping () -> Void
    ) {
        let configuredTypes = ["Meal"]
        let existingMealType = existingMeal?.mealType
        let initialMealType: String
        let initialCustomMealType: String

        if let existingMealType,
           configuredTypes.contains(existingMealType) || existingMealType == "Custom" {
            initialMealType = existingMealType
            initialCustomMealType = ""
        } else if let existingMealType {
            initialMealType = "Custom"
            initialCustomMealType = existingMealType
        } else {
            initialMealType = configuredTypes.first ?? "Meal"
            initialCustomMealType = ""
        }

        self.profile = profile
        self.mealStore = mealStore
        self.savedMealStore = savedMealStore
        self.existingMeal = existingMeal
        self.mealEstimateClient = mealEstimateClient
        self.mealPersistenceClient = mealPersistenceClient
        self.onNeedsSignIn = onNeedsSignIn
        let existingNote = existingMeal?.note.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let existingTitle = existingMeal?.title.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let initialDescription = existingNote.isEmpty && !MealLogEntry.isGenericTitle(existingTitle)
            ? existingTitle
            : existingNote
        _selectedMealType = State(
            initialValue: initialMealType
        )
        _customMealType = State(initialValue: initialCustomMealType)
        _title = State(initialValue: existingMeal?.title ?? "")
        _note = State(initialValue: existingMeal == nil ? initialPrompt : initialDescription)
        _loggedAt = State(initialValue: existingMeal?.loggedAt ?? initialLoggedAt)
        _calories = State(initialValue: existingMeal?.totals.calories ?? 500)
        _protein = State(initialValue: existingMeal?.totals.proteinGrams ?? 35)
        _carbs = State(initialValue: existingMeal?.totals.carbsGrams ?? 45)
        _fat = State(initialValue: existingMeal?.totals.fatGrams ?? 18)
        _fiber = State(initialValue: existingMeal?.totals.fiberGrams ?? 6)
        _ingredients = State(initialValue: existingMeal?.ingredients ?? [])
        _saveForQuickFill = State(initialValue: true)
        _selectedPhotoData = State(
            initialValue: existingMeal.map(mealStore.photoData(for:)) ?? []
        )
        _estimateStatus = State(initialValue: existingMeal?.estimateStatus ?? .manual)
        _estimateConfidence = State(initialValue: existingMeal?.estimateConfidence)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                FitnessTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        MealLogEditorHeader(isEditing: existingMeal != nil)

                        MealDetailsEditorCard(
                            savedMealStore: savedMealStore,
                            mealTypeOptions: mealTypeOptions,
                            customMealTypeSentinel: customMealTypeSentinel,
                            selectedMealType: $selectedMealType,
                            customMealType: $customMealType,
                            title: $title,
                            loggedAt: $loggedAt,
                            note: $note,
                            saveForQuickFill: $saveForQuickFill,
                            estimateStatus: estimateStatus,
                            isEstimating: isEstimating,
                            canEstimate: canEstimate,
                            estimateMessage: estimateMessage,
                            estimateError: estimateError,
                            estimateNeedsSignIn: estimateNeedsSignIn,
                            onApplyTemplate: applyTemplate,
                            onEstimate: {
                                Task {
                                    await estimateMeal()
                                }
                            },
                            onNeedsSignIn: openSignInSettings
                        )

                        if !estimatedMealDrafts.isEmpty {
                            EstimatedMealDraftsReviewCard(
                                drafts: $estimatedMealDrafts
                            )
                        }

                        MealPhotosEditorCard(
                            selectedPhotoItems: $selectedPhotoItems,
                            selectedPhotoData: selectedPhotoData,
                            isLoadingPhotos: isLoadingPhotos,
                            photoError: photoError,
                            onRemove: removePhoto
                        )

                        if !recentFoodSuggestions.isEmpty {
                            RecentFoodOptionsCard(
                                suggestions: recentFoodSuggestions,
                                searchText: $recentFoodSearch,
                                selectedIDs: $selectedRecentFoodIDs,
                                onAddSelected: addSelectedFoodSuggestions
                            )
                        }

                        if !ingredients.isEmpty {
                            IngredientBreakdownEditorCard(
                                ingredients: $ingredients,
                                retryingIngredientId: retryingIngredientId,
                                onRetry: { ingredient in
                                    Task {
                                        await retryEstimateIngredient(ingredient)
                                    }
                                }
                            )
                        }

                        MealMacrosEditorCard(
                            calories: $calories,
                            protein: $protein,
                            carbs: $carbs,
                            fat: $fat,
                            fiber: $fiber,
                            estimateStatus: estimateStatus,
                            estimateConfidence: estimateConfidence
                        )
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 18)
                    .padding(.bottom, 32)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .foregroundStyle(FitnessTheme.secondaryText)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(saveButtonTitle) {
                        if !estimatedMealDrafts.isEmpty {
                            saveEstimatedDraftsAndDismiss()
                        } else if shouldPromptForEstimateBeforeSave {
                            showManualSaveConfirmation = true
                        } else {
                            saveMealAndDismiss()
                        }
                    }
                    .fontWeight(.bold)
                    .foregroundStyle(FitnessTheme.lime)
                }
            }
            .toolbarColorScheme(.dark, for: .navigationBar)
            .confirmationDialog(
                "Estimate this meal first?",
                isPresented: $showManualSaveConfirmation,
                titleVisibility: .visible
            ) {
                Button("Estimate With AI") {
                    Task {
                        await estimateMeal()
                    }
                }

                Button("Save Manual Entry") {
                    saveMealAndDismiss()
                }

                Button("Cancel", role: .cancel) {}
            } message: {
                Text("AI can break the meal into ingredients. You can also keep your manual numbers.")
            }
            .onChange(of: ingredients) { _, _ in
                syncTotalsFromIngredients()
            }
            .onChange(of: selectedPhotoItems) { _, items in
                Task {
                    await loadSelectedPhotos(items)
                }
            }
        }
    }

    private func saveMealAndDismiss() {
        saveMeal()
        dismiss()
    }

    private func saveEstimatedDraftsAndDismiss() {
        saveEstimatedDrafts()
        dismiss()
    }

    private func openSignInSettings() {
        dismiss()
        onNeedsSignIn()
    }

    private func saveMeal() {
        let cleanedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedTitle = cleanedTitle.isEmpty
            ? MealLogEntry.shortTitle(from: cleanedNote, fallback: selectedMealTypeName)
            : cleanedTitle
        let meal = MealLogEntry(
            id: existingMeal?.id ?? UUID(),
            loggedAt: loggedAt,
            mealType: selectedMealTypeName,
            title: resolvedTitle,
            note: cleanedNote,
            totals: MacroTotals(
                calories: calories,
                proteinGrams: protein,
                carbsGrams: carbs,
                fatGrams: fat,
                fiberGrams: fiber
            ),
            ingredients: ingredients,
            estimateStatus: estimateStatus,
            estimateConfidence: estimateConfidence,
            createdAt: existingMeal?.createdAt ?? Date()
        )

        let storedMeal: MealLogEntry

        if existingMeal == nil {
            storedMeal = mealStore.add(meal, photoData: selectedPhotoData)
        } else {
            storedMeal = mealStore.update(meal, photoData: selectedPhotoData)
        }
        let storedTemplate = saveForQuickFill
            ? savedMealStore.saveTemplate(from: storedMeal)
            : nil

        Task {
            try? await mealPersistenceClient.upsertMeal(storedMeal)

            if let storedTemplate {
                try? await mealPersistenceClient.upsertTemplate(storedTemplate)
            }
        }
    }

    private func saveEstimatedDrafts() {
        guard existingMeal == nil else {
            return
        }

        let drafts = estimatedMealDrafts
        for draft in drafts {
            let cleanedTitle = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
            let cleanedNote = draft.note.trimmingCharacters(in: .whitespacesAndNewlines)
            let meal = MealLogEntry(
                id: draft.id,
                loggedAt: draft.loggedAt,
                mealType: draft.mealType,
                title: cleanedTitle.isEmpty
                    ? MealLogEntry.shortTitle(from: cleanedNote, fallback: draft.mealType)
                    : cleanedTitle,
                note: cleanedNote,
                totals: draft.totals,
                ingredients: draft.ingredients,
                estimateStatus: draft.estimateStatus,
                estimateConfidence: draft.estimateConfidence,
                createdAt: draft.createdAt
            )
            let storedMeal = mealStore.add(meal)
            let storedTemplate = saveForQuickFill
                ? savedMealStore.saveTemplate(from: storedMeal)
                : nil

            Task {
                try? await mealPersistenceClient.upsertMeal(storedMeal)

                if let storedTemplate {
                    try? await mealPersistenceClient.upsertTemplate(storedTemplate)
                }
            }
        }
    }

    private var customMealTypeSentinel: String {
        "Custom"
    }

    private var mealTypeOptions: [String] {
        var options = ["Meal"]
        if options.isEmpty {
            options = ["Meal"]
        }

        if !options.contains(customMealTypeSentinel) {
            options.append(customMealTypeSentinel)
        }

        return Array(NSOrderedSet(array: options)) as? [String] ?? options
    }

    private var selectedMealTypeName: String {
        if selectedMealType == customMealTypeSentinel {
            let trimmed = customMealType.trimmingCharacters(in: .whitespacesAndNewlines)

            return trimmed.isEmpty ? "Meal" : trimmed
        }

        return selectedMealType
    }

    private var canEstimate: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            !selectedPhotoData.isEmpty
    }

    private var shouldPromptForEstimateBeforeSave: Bool {
        canEstimate && estimateStatus != .aiEstimated && !isEstimating
    }

    private var promptSections: [MealPromptSection] {
        MealLogEntry.promptSections(from: note, titleFallback: selectedMealTypeName)
    }

    private var saveButtonTitle: String {
        estimatedMealDrafts.isEmpty ? "Save" : "Save \(estimatedMealDrafts.count)"
    }

    private var recentFoodSuggestions: [FoodIngredientSuggestion] {
        FoodIngredientSuggestion.recent(
            meals: mealStore.meals,
            templates: savedMealStore.templates,
            excluding: ingredients,
            limit: 40
        )
    }

    private func applyTemplate(_ template: SavedMealTemplate) {
        estimatedMealDrafts = []
        selectedMealType = "Meal"
        customMealType = ""
        title = template.title
        note = template.note.isEmpty ? template.title : template.note
        calories = template.totals.calories
        protein = template.totals.proteinGrams
        carbs = template.totals.carbsGrams
        fat = template.totals.fatGrams
        fiber = template.totals.fiberGrams
        ingredients = template.ingredients
        estimateStatus = template.ingredients.isEmpty ? .manual : .aiEstimated
        estimateConfidence = nil
        estimateMessage = "Filled from saved meal."
        estimateError = nil
        estimateNeedsSignIn = false
        savedMealStore.markUsed(template)
    }

    private func addFoodSuggestion(_ suggestion: FoodIngredientSuggestion) {
        estimatedMealDrafts = []
        ingredients.append(suggestion.entryForMeal())
        estimateStatus = .manual
        estimateConfidence = nil
        estimateMessage = "Added \(suggestion.title)."
        estimateError = nil
        estimateNeedsSignIn = false
    }

    private func addSelectedFoodSuggestions(_ suggestions: [FoodIngredientSuggestion]) {
        let selectedSuggestions = suggestions.filter { selectedRecentFoodIDs.contains($0.id) }
        guard !selectedSuggestions.isEmpty else {
            return
        }

        estimatedMealDrafts = []
        ingredients.append(contentsOf: selectedSuggestions.map { $0.entryForMeal() })
        estimateStatus = .manual
        estimateConfidence = nil
        estimateMessage = "Added \(selectedSuggestions.count) foods."
        estimateError = nil
        estimateNeedsSignIn = false
        selectedRecentFoodIDs.removeAll()
        recentFoodSearch = ""
    }

    private func syncTotalsFromIngredients() {
        guard !ingredients.isEmpty else {
            return
        }

        let totals = ingredients.map(\.totals).reduce(.zero, +)
        calories = totals.calories
        protein = totals.proteinGrams
        carbs = totals.carbsGrams
        fat = totals.fatGrams
        fiber = totals.fiberGrams
    }

    @MainActor
    private func retryEstimateIngredient(_ ingredient: MealIngredientEntry) async {
        guard retryingIngredientId == nil else {
            return
        }

        retryingIngredientId = ingredient.id
        estimateError = nil
        estimateMessage = nil
        estimateNeedsSignIn = false
        defer { retryingIngredientId = nil }

        do {
            let description = "\(formatIngredientQuantity(ingredient.quantity)) \(ingredient.unit) \(ingredient.name)"
            let response = try await mealEstimateClient.estimate(
                mealType: "Ingredient",
                description: description,
                note: [
                    "Re-estimate only this single ingredient.",
                    "The previous estimate looked inaccurate.",
                    "Return nutrition for the edible/drained portion described by the user, not the whole meal.",
                    "If the food is canned tuna in oil, estimate the drained edible tuna portion unless the text says oil was eaten too."
                ].joined(separator: " "),
                photoData: []
            )
            let replacement = response.ingredients.first?.mealIngredientEntry()
                ?? MealIngredientEntry(
                    name: ingredient.name,
                    quantity: ingredient.quantity,
                    unit: ingredient.unit,
                    baseQuantity: ingredient.quantity,
                    baseUnit: ingredient.unit,
                    baseGrams: ingredient.unit == "g" ? ingredient.quantity : ingredient.baseGrams,
                    baseTotals: response.totals
                )

            if let index = ingredients.firstIndex(where: { $0.id == ingredient.id }) {
                ingredients[index] = MealIngredientEntry(
                    id: ingredient.id,
                    name: replacement.name,
                    quantity: replacement.quantity,
                    unit: replacement.unit,
                    baseQuantity: replacement.baseQuantity,
                    baseUnit: replacement.baseUnit,
                    baseGrams: replacement.baseGrams,
                    baseTotals: replacement.baseTotals
                )
                syncTotalsFromIngredients()
                estimateStatus = .manual
                estimateConfidence = nil
                estimateMessage = "Updated \(replacement.name)."
            }
        } catch let error as MealEstimateClientError {
            estimateStatus = .estimationFailed
            estimateError = error.localizedDescription
            estimateNeedsSignIn = error.needsSignIn
        } catch {
            estimateStatus = .estimationFailed
            estimateError = error.localizedDescription
            estimateNeedsSignIn = false
        }
    }

    @MainActor
    private func estimateMeal() async {
        guard canEstimate else {
            estimateError = "Describe the meal or add photos first."
            estimateNeedsSignIn = false
            return
        }

        let sections = promptSections
        if existingMeal == nil, selectedPhotoData.isEmpty, sections.count > 1 {
            await estimateSectionsForReview(sections)
            return
        }

        isEstimating = true
        estimateError = nil
        estimateMessage = nil
        estimateNeedsSignIn = false
        defer { isEstimating = false }

        do {
            let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
            let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
            let description = trimmedNote.isEmpty
                ? (trimmedTitle.isEmpty ? "\(selectedMealTypeName) photo" : trimmedTitle)
                : trimmedNote
            let response = try await mealEstimateClient.estimate(
                mealType: selectedMealTypeName,
                description: description,
                note: note,
                photoData: selectedPhotoData
            )

            ingredients = response.ingredients.map { $0.mealIngredientEntry() }
            if ingredients.isEmpty {
                calories = response.totals.calories
                protein = response.totals.proteinGrams
                carbs = response.totals.carbsGrams
                fat = response.totals.fatGrams
                fiber = response.totals.fiberGrams
            } else {
                syncTotalsFromIngredients()
            }
            estimateStatus = .aiEstimated
            estimateConfidence = response.confidence
            estimateMessage = response.summary
            if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                title = MealLogEntry.shortTitle(from: response.summary, fallback: selectedMealTypeName)
            }
            estimatedMealDrafts = []
        } catch let error as MealEstimateClientError {
            estimateStatus = .estimationFailed
            estimateError = error.localizedDescription
            estimateNeedsSignIn = error.needsSignIn
        } catch {
            estimateStatus = .estimationFailed
            estimateError = error.localizedDescription
            estimateNeedsSignIn = false
        }
    }

    @MainActor
    private func estimateSectionsForReview(_ sections: [MealPromptSection]) async {
        isEstimating = true
        estimateError = nil
        estimateMessage = nil
        estimateNeedsSignIn = false
        defer { isEstimating = false }

        var drafts: [MealLogEntry] = []

        do {
            for (index, section) in sections.enumerated() {
                let response = try await mealEstimateClient.estimate(
                    mealType: section.title,
                    description: section.prompt,
                    note: "This is one section from a multi-meal prompt. Generate a short title, description summary, and ingredient breakdown for only this section.",
                    photoData: []
                )
                let sectionLoggedAt = loggedAt.addingTimeInterval(Double(sections.count - index) * 60)
                let sectionIngredients = response.ingredients.map { $0.mealIngredientEntry() }
                let sectionTotals = sectionIngredients.isEmpty
                    ? response.totals
                    : sectionIngredients.map(\.totals).reduce(.zero, +)
                let meal = MealLogEntry(
                    id: UUID(),
                    loggedAt: sectionLoggedAt,
                    mealType: section.title,
                    title: MealLogEntry.shortTitle(from: response.summary, fallback: section.title),
                    note: section.prompt,
                    totals: sectionTotals,
                    ingredients: sectionIngredients,
                    estimateStatus: .aiEstimated,
                    estimateConfidence: response.confidence,
                    createdAt: Date()
                )
                drafts.append(meal)
            }

            estimatedMealDrafts = drafts
            estimateStatus = .aiEstimated
            estimateConfidence = drafts.compactMap(\.estimateConfidence).min()
            estimateMessage = "Review \(drafts.count) estimated meal sections before saving."
        } catch let error as MealEstimateClientError {
            estimateStatus = .estimationFailed
            estimateError = error.localizedDescription
            estimateNeedsSignIn = error.needsSignIn
        } catch {
            estimateStatus = .estimationFailed
            estimateError = error.localizedDescription
            estimateNeedsSignIn = false
        }
    }

    @MainActor
    private func loadSelectedPhotos(_ items: [PhotosPickerItem]) async {
        isLoadingPhotos = true
        photoError = nil
        defer { isLoadingPhotos = false }

        var loadedData: [Data] = []

        for item in items.prefix(6) {
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    continue
                }

                if let image = UIImage(data: data),
                   let compressed = image.jpegData(compressionQuality: 0.72) {
                    loadedData.append(compressed)
                } else {
                    loadedData.append(data)
                }
            } catch {
                photoError = "Some photos could not be loaded."
            }
        }

        selectedPhotoData = loadedData
    }

    private func removePhoto(at index: Int) {
        guard selectedPhotoData.indices.contains(index) else {
            return
        }

        selectedPhotoData.remove(at: index)
        if selectedPhotoItems.indices.contains(index) {
            selectedPhotoItems.remove(at: index)
        }
    }

    private func formatIngredientQuantity(_ value: Double) -> String {
        value.formatted(
            .number
                .precision(.fractionLength(0...2))
                .grouping(.never)
        )
    }
}

private struct MealLogEditorHeader: View {
    let isEditing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("MEAL")
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(FitnessTheme.lime)
            Text(isEditing ? "Edit Food" : "Log Food")
                .font(.system(size: 30, weight: .black, design: .rounded))
                .foregroundStyle(.white)
        }
    }
}

private struct MealDetailsEditorCard: View {
    @ObservedObject var savedMealStore: SavedMealStore
    let mealTypeOptions: [String]
    let customMealTypeSentinel: String
    @Binding var selectedMealType: String
    @Binding var customMealType: String
    @Binding var title: String
    @Binding var loggedAt: Date
    @Binding var note: String
    @Binding var saveForQuickFill: Bool
    let estimateStatus: MealEstimateStatus
    let isEstimating: Bool
    let canEstimate: Bool
    let estimateMessage: String?
    let estimateError: String?
    let estimateNeedsSignIn: Bool
    let onApplyTemplate: (SavedMealTemplate) -> Void
    let onEstimate: () -> Void
    let onNeedsSignIn: () -> Void

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                SectionHeader(title: "Prompt", trailing: estimateStatus.displayName)

                quickFillMenu
                shortTitleField
                mealPromptField
                DatePicker("Date", selection: $loggedAt, displayedComponents: .date)
                    .datePickerStyle(.compact)
                    .tint(FitnessTheme.lime)
                    .foregroundStyle(.white)
                estimateButton
                estimateFeedback
                saveTemplateToggle
            }
        }
    }

    @ViewBuilder
    private var quickFillMenu: some View {
        if !savedMealStore.templates.isEmpty {
            Menu {
                ForEach(savedMealStore.templates.prefix(10)) { template in
                    Button {
                        onApplyTemplate(template)
                    } label: {
                        Text(template.title)
                    }
                }
            } label: {
                ActionButtonLabel(
                    title: "Quick Fill",
                    systemImage: "text.badge.plus"
                )
            }
            .buttonStyle(SecondaryActionButtonStyle())
        }
    }

    private var mealTypePicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("Type", selection: $selectedMealType) {
                ForEach(mealTypeOptions, id: \.self) { mealType in
                    Text(mealType).tag(mealType)
                }
            }
            .pickerStyle(.menu)
            .tint(FitnessTheme.lime)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.white)

            if selectedMealType == customMealTypeSentinel {
                TextField("Custom meal type", text: $customMealType)
                    .textInputAutocapitalization(.words)
                    .padding(12)
                    .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12))
                    .foregroundStyle(.white)
            }
        }
    }

    private var shortTitleField: some View {
        TextField("Optional short title", text: $title)
            .textInputAutocapitalization(.sentences)
            .padding(12)
            .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12))
            .foregroundStyle(.white)
            .accessibilityLabel("Optional short title")
    }

    private var mealPromptField: some View {
        TextField("Prompt meals and foods", text: $note, axis: .vertical)
            .lineLimit(4...9)
            .textInputAutocapitalization(.sentences)
            .padding(12)
            .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12))
            .foregroundStyle(.white)
            .accessibilityLabel("Meal prompt")
    }

    private var mealContextControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Optional context")
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundStyle(FitnessTheme.secondaryText)
                .textCase(.uppercase)

            mealTypePicker
        }
    }

    private var estimateButton: some View {
        Button(action: onEstimate) {
            ActionButtonLabel(
                title: isEstimating ? "Estimating" : "Estimate With AI",
                systemImage: "sparkles"
            )
        }
        .buttonStyle(PrimaryActionButtonStyle())
        .disabled(isEstimating || !canEstimate)
    }

    @ViewBuilder
    private var estimateFeedback: some View {
        if let estimateMessage {
            Text(estimateMessage)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(FitnessTheme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }

        if let estimateError {
            VStack(alignment: .leading, spacing: 10) {
                Text(estimateError)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(FitnessTheme.error)
                    .fixedSize(horizontal: false, vertical: true)

                if estimateNeedsSignIn {
                    Button(action: onNeedsSignIn) {
                        ActionButtonLabel(
                            title: "Open Settings",
                            systemImage: "person.crop.circle.badge.checkmark"
                        )
                    }
                    .buttonStyle(SecondaryActionButtonStyle())
                }
            }
        }
    }

    private var saveTemplateToggle: some View {
        Toggle("Remember for quick fill", isOn: $saveForQuickFill)
            .tint(FitnessTheme.lime)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.white)
    }
}

private struct MealMacrosEditorCard: View {
    @Binding var calories: Double
    @Binding var protein: Double
    @Binding var carbs: Double
    @Binding var fat: Double
    @Binding var fiber: Double
    let estimateStatus: MealEstimateStatus
    let estimateConfidence: Double?

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                SectionHeader(title: "Macros", trailing: "\(wholeNumber(calories)) kcal")

                if estimateStatus == .aiEstimated,
                   let estimateConfidence {
                    Text("AI estimate · \(wholeNumber(estimateConfidence * 100))% confidence. Adjust before saving if needed.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(FitnessTheme.secondaryText)
                }

                MacroStepperRow(title: "Calories", value: $calories, step: 50, unit: "kcal")
                MacroStepperRow(title: "Protein", value: $protein, step: 5, unit: "g")
                MacroStepperRow(title: "Carbs", value: $carbs, step: 5, unit: "g")
                MacroStepperRow(title: "Fat", value: $fat, step: 5, unit: "g")
                MacroStepperRow(title: "Fiber", value: $fiber, step: 1, unit: "g")
            }
        }
    }
}

private struct MealPhotoPreviewStrip: View {
    let photoData: [Data]
    let onRemove: (Int) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(Array(photoData.enumerated()), id: \.offset) { index, data in
                    ZStack(alignment: .topTrailing) {
                        if let image = UIImage(data: data) {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 72, height: 72)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        } else {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(FitnessTheme.rowFill)
                                .frame(width: 72, height: 72)
                                .overlay {
                                    Image(systemName: "photo")
                                        .foregroundStyle(FitnessTheme.secondaryText)
                                }
                        }

                        Button {
                            onRemove(index)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 18, weight: .bold))
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.black, .white)
                                .background(Circle().fill(.white))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove photo")
                        .offset(x: 6, y: -6)
                    }
                    .frame(width: 80, height: 80)
                }
            }
            .padding(.vertical, 6)
        }
        .accessibilityLabel("\(photoData.count) selected meal photos")
    }
}

private struct MealPhotosEditorCard: View {
    @Binding var selectedPhotoItems: [PhotosPickerItem]
    let selectedPhotoData: [Data]
    let isLoadingPhotos: Bool
    let photoError: String?
    let onRemove: (Int) -> Void

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                SectionHeader(title: "Photos", trailing: "\(selectedPhotoData.count)/6")

                PhotosPicker(
                    selection: $selectedPhotoItems,
                    maxSelectionCount: 6,
                    matching: .images
                ) {
                    ActionButtonLabel(
                        title: "Add Photos",
                        systemImage: "photo.on.rectangle"
                    )
                }
                .buttonStyle(SecondaryActionButtonStyle())
                .disabled(isLoadingPhotos)

                if let photoError {
                    Text(photoError)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(FitnessTheme.error)
                }

                if !selectedPhotoData.isEmpty {
                    MealPhotoPreviewStrip(
                        photoData: selectedPhotoData,
                        onRemove: onRemove
                    )
                }
            }
        }
    }
}

private struct MacroStepperRow: View {
    let title: String
    @Binding var value: Double
    let step: Double
    let unit: String

    var body: some View {
        Stepper(value: $value, in: 0...5_000, step: step) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                Spacer()
                Text("\(wholeNumber(value)) \(unit)")
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.lime)
            }
        }
        .tint(FitnessTheme.lime)
    }
}

private struct NumberStepperRow: View {
    let title: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double
    let unit: String

    var body: some View {
        Stepper(value: $value, in: range, step: step) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                Spacer()
                Text("\(wholeNumber(value)) \(unit)")
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.lime)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
        }
        .tint(FitnessTheme.lime)
    }
}

private struct RecentFoodOptionsCard: View {
    let suggestions: [FoodIngredientSuggestion]
    @Binding var searchText: String
    @Binding var selectedIDs: Set<String>
    let onAddSelected: ([FoodIngredientSuggestion]) -> Void

    private var selectedCount: Int {
        suggestions.filter { selectedIDs.contains($0.id) }.count
    }

    private var filteredSuggestions: [FoodIngredientSuggestion] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            return suggestions
        }

        return suggestions.filter {
            $0.title.localizedCaseInsensitiveContains(query) ||
                $0.detail.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: "Recent Foods", trailing: "\(selectedCount)/\(suggestions.count)")

                TextField("Search previous ingredients", text: $searchText)
                    .textInputAutocapitalization(.never)
                    .padding(12)
                    .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12))
                    .foregroundStyle(.white)
                    .accessibilityLabel("Search previous ingredients")

                if filteredSuggestions.isEmpty {
                    Text("No matching foods.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(FitnessTheme.secondaryText)
                } else {
                    LazyVGrid(
                        columns: [
                            GridItem(.adaptive(minimum: 142), spacing: 10, alignment: .top)
                        ],
                        alignment: .leading,
                        spacing: 10
                    ) {
                        ForEach(filteredSuggestions) { suggestion in
                            Button {
                                toggle(suggestion)
                            } label: {
                                RecentFoodOptionChip(
                                    suggestion: suggestion,
                                    isSelected: selectedIDs.contains(suggestion.id)
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                Button {
                    onAddSelected(suggestions)
                } label: {
                    ActionButtonLabel(
                        title: selectedCount == 0 ? "Add Selected" : "Add \(selectedCount) Foods",
                        systemImage: "plus.circle.fill"
                    )
                }
                .buttonStyle(SecondaryActionButtonStyle())
                .disabled(selectedCount == 0)
            }
        }
    }

    private func toggle(_ suggestion: FoodIngredientSuggestion) {
        if selectedIDs.contains(suggestion.id) {
            selectedIDs.remove(suggestion.id)
        } else {
            selectedIDs.insert(suggestion.id)
        }
    }
}

private struct RecentFoodOptionChip: View {
    let suggestion: FoodIngredientSuggestion
    let isSelected: Bool

    var body: some View {
        ZStack(alignment: .topTrailing) {
            VStack(alignment: .leading, spacing: 5) {
                Text(suggestion.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .frame(minHeight: 32, alignment: .topLeading)

                Text(suggestion.detail)
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 72, alignment: .topLeading)
            .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(isSelected ? FitnessTheme.lime : FitnessTheme.cardStroke, lineWidth: 1)
            )

            if isSelected {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 18, weight: .bold))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.black, FitnessTheme.lime)
                    .padding(7)
            }
        }
    }
}

private struct EstimatedMealDraftsReviewCard: View {
    @Binding var drafts: [MealLogEntry]

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                SectionHeader(title: "Review Estimate", trailing: "\(drafts.count) meals")

                Text("Nothing is saved yet. Review titles, remove mistakes, then Save.")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(spacing: 10) {
                    ForEach($drafts) { $draft in
                        EstimatedMealDraftRow(
                            draft: $draft,
                            onDelete: {
                                drafts.removeAll { $0.id == draft.id }
                            }
                        )
                    }
                }
            }
        }
    }
}

private struct EstimatedMealDraftRow: View {
    @Binding var draft: MealLogEntry
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 10) {
                TextField("Meal title", text: $draft.title)
                    .textInputAutocapitalization(.sentences)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .frame(height: 38)
                    .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 10))
                    .accessibilityLabel("Estimated meal title")

                Button(action: onDelete) {
                    Image(systemName: "trash")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(FitnessTheme.error)
                        .frame(width: 38, height: 38)
                        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove estimated meal")
            }

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(draft.mealType)
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.lime)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text("\(wholeNumber(draft.totals.calories)) kcal")
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.orange)
            }

            if !draft.ingredients.isEmpty {
                VStack(spacing: 0) {
                    ForEach(draft.ingredients.prefix(6)) { ingredient in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(ingredient.name)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(.white)
                                .lineLimit(2)
                            Spacer(minLength: 8)
                            Text("\(formatDraftPortion(ingredient.quantity)) \(ingredient.unit)")
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                                .foregroundStyle(FitnessTheme.secondaryText)
                        }
                        .padding(.vertical, 5)
                    }

                    if draft.ingredients.count > 6 {
                        Text("+\(draft.ingredients.count - 6) more")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundStyle(FitnessTheme.secondaryText)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.top, 5)
                    }
                }
            }
        }
        .padding(12)
        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(FitnessTheme.cardStroke, lineWidth: 1)
        )
    }

    private func formatDraftPortion(_ value: Double) -> String {
        if value.rounded() == value {
            return wholeNumber(value)
        }

        let text = String(format: "%.2f", value)

        return text
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

private struct IngredientBreakdownEditorCard: View {
    @Binding var ingredients: [MealIngredientEntry]
    let retryingIngredientId: UUID?
    let onRetry: (MealIngredientEntry) -> Void
    @State private var draggingIngredientID: UUID?
    @State private var dropTargetIngredientID: UUID?

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                SectionHeader(title: "Ingredients", trailing: "\(ingredients.count)")
                Text("Adjust portions here. Totals update without another AI request.")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(spacing: 0) {
                    ForEach($ingredients) { $ingredient in
                        IngredientPortionRow(
                            ingredient: $ingredient,
                            isRetrying: retryingIngredientId == ingredient.id,
                            onRetry: {
                                onRetry(ingredient)
                            },
                            onDelete: {
                                ingredients.removeAll { $0.id == ingredient.id }
                            },
                            draggingIngredientID: $draggingIngredientID,
                            dropTargetIngredientID: $dropTargetIngredientID,
                            onMoveIngredient: moveIngredient
                        )

                        if ingredient.id != ingredients.last?.id {
                            Divider().overlay(FitnessTheme.cardStroke)
                        }
                    }
                }
            }
        }
    }

    private func moveIngredient(_ draggedID: UUID, before targetID: UUID) {
        guard draggedID != targetID,
              let fromIndex = ingredients.firstIndex(where: { $0.id == draggedID }),
              let toIndex = ingredients.firstIndex(where: { $0.id == targetID }) else {
            return
        }

        let movedIngredient = ingredients.remove(at: fromIndex)
        let insertionIndex = min(max(0, toIndex), ingredients.count)
        withAnimation(.snappy(duration: 0.18)) {
            ingredients.insert(movedIngredient, at: insertionIndex)
        }
    }
}

private struct IngredientPortionRow: View {
    @Binding var ingredient: MealIngredientEntry
    let isRetrying: Bool
    let onRetry: () -> Void
    let onDelete: () -> Void
    @Binding var draggingIngredientID: UUID?
    @Binding var dropTargetIngredientID: UUID?
    let onMoveIngredient: (UUID, UUID) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                DragHandle()
                    .onDrag {
                        draggingIngredientID = ingredient.id
                        return NSItemProvider(object: ingredient.id.uuidString as NSString)
                    } preview: {
                        DragPreviewCard(
                            title: ingredient.name,
                            subtitle: portionText
                        )
                    }
                    .accessibilityLabel("Reorder ingredient")

                VStack(alignment: .leading, spacing: 3) {
                    Text(ingredient.name)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                    Text(macroSummary)
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(FitnessTheme.secondaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }

                Spacer(minLength: 8)

                HStack(spacing: 8) {
                    Text("\(wholeNumber(ingredient.totals.calories)) kcal")
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                        .foregroundStyle(FitnessTheme.orange)
                        .lineLimit(1)

                    Button(action: onDelete) {
                        Image(systemName: "trash")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(FitnessTheme.error)
                            .frame(width: 30, height: 30)
                            .background(
                                FitnessTheme.rowFill,
                                in: RoundedRectangle(cornerRadius: 8)
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Delete \(ingredient.name)")

                    Button(action: onRetry) {
                        if isRetrying {
                            ProgressView()
                                .tint(FitnessTheme.lime)
                                .frame(width: 30, height: 30)
                        } else {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(FitnessTheme.lime)
                                .frame(width: 30, height: 30)
                                .background(
                                    FitnessTheme.rowFill,
                                    in: RoundedRectangle(cornerRadius: 8)
                                )
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(isRetrying)
                    .accessibilityLabel("Retry estimate for \(ingredient.name)")
                }
            }

            HStack(spacing: 10) {
                Stepper(value: $ingredient.quantity, in: 0...10_000, step: ingredient.quantityStep) {
                    HStack(spacing: 6) {
                        TextField("Amount", value: $ingredient.quantity, format: .number.precision(.fractionLength(0...2)))
                            .keyboardType(.decimalPad)
                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                            .foregroundStyle(FitnessTheme.lime)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 72)
                            .textFieldStyle(.plain)
                            .padding(.horizontal, 8)
                            .frame(height: 30)
                            .background(
                                FitnessTheme.rowFill,
                                in: RoundedRectangle(cornerRadius: 8)
                            )

                        Text(ingredient.unit)
                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                            .foregroundStyle(FitnessTheme.secondaryText)
                            .lineLimit(1)
                    }
                }
                .tint(FitnessTheme.lime)

                if ingredient.availableUnits.count > 1 {
                    Menu {
                        ForEach(ingredient.availableUnits, id: \.self) { unit in
                            Button(unit) {
                                ingredient.changeUnit(to: unit)
                            }
                        }
                    } label: {
                        Text(ingredient.unit)
                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 10)
                            .frame(height: 30)
                            .background(
                                FitnessTheme.rowFill,
                                in: RoundedRectangle(cornerRadius: 10)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.vertical, 4)
        .background(
            dropTargetIngredientID == ingredient.id
                ? FitnessTheme.lime.opacity(0.12)
                : Color.clear,
            in: RoundedRectangle(cornerRadius: 9, style: .continuous)
        )
        .opacity(draggingIngredientID == ingredient.id ? 0.38 : 1)
        .animation(.snappy(duration: 0.18), value: draggingIngredientID)
        .animation(.snappy(duration: 0.18), value: dropTargetIngredientID)
        .onDrop(
            of: [UTType.text],
            delegate: UUIDReorderDropDelegate(
                targetID: ingredient.id,
                draggingID: $draggingIngredientID,
                dropTargetID: $dropTargetIngredientID,
                onMove: onMoveIngredient
            )
        )
        .accessibilityElement(children: .combine)
    }

    private var portionText: String {
        "\(formatPortion(ingredient.quantity)) \(ingredient.unit)"
    }

    private var macroSummary: String {
        "P \(wholeNumber(ingredient.totals.proteinGrams)) C \(wholeNumber(ingredient.totals.carbsGrams)) F \(wholeNumber(ingredient.totals.fatGrams))"
    }

    private func formatPortion(_ value: Double) -> String {
        if ingredient.unit == "g" || value.rounded() == value {
            return wholeNumber(value)
        }

        let text = String(format: "%.2f", value)

        return text
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

private struct NutritionDashboardView: View {
    @ObservedObject var mealStore: MealLogStore
    let profile: CoachProfile
    let onEditMeal: (MealLogEntry) -> Void
    let onDeleteMeal: (MealLogEntry) -> Void

    var body: some View {
        ZStack {
            FitnessTheme.background.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    NutritionDashboardHeader()

                    GlassCard {
                        VStack(alignment: .leading, spacing: 14) {
                            SectionHeader(title: "Consistency", trailing: "30D")
                            NutritionDailyChart(
                                summaries: mealStore.dailySummaries(days: 30),
                                targets: NutritionTargetCalculator.targets(for: profile)
                            )
                        }
                    }

                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader(title: "Meals", trailing: "\(mealStore.meals.count) logged")

                            if mealStore.meals.isEmpty {
                                Text("No meals logged yet.")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundStyle(FitnessTheme.secondaryText)
                                    .frame(maxWidth: .infinity, minHeight: 96, alignment: .center)
                            } else {
                                VStack(spacing: 12) {
                                    ForEach(historySections) { section in
                                        VStack(alignment: .leading, spacing: 0) {
                                            MealHistoryDateHeader(date: section.date, count: section.meals.count)

                                            ForEach(section.meals) { meal in
                                                MealHistoryEntryRow(
                                                    meal: meal,
                                                    thumbnailData: mealStore.thumbnailData(for: meal),
                                                    onEdit: {
                                                        onEditMeal(meal)
                                                    },
                                                    onDelete: {
                                                        onDeleteMeal(meal)
                                                    }
                                                )

                                                if meal.id != section.meals.last?.id {
                                                    Divider().overlay(FitnessTheme.cardStroke)
                                                }
                                            }
                                        }
                                        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 12)
                                                .stroke(FitnessTheme.cardStroke, lineWidth: 1)
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 32)
            }
        }
        .navigationTitle("Nutrition")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }

    private var historySections: [MealHistoryDateSection] {
        let calendar = Calendar.current
        var sectionsByDate: [Date: [MealLogEntry]] = [:]

        for meal in mealStore.meals.prefix(40) {
            let day = calendar.startOfDay(for: meal.loggedAt)
            sectionsByDate[day, default: []].append(meal)
        }

        return sectionsByDate
            .map { date, meals in
                MealHistoryDateSection(
                    date: date,
                    meals: meals.sorted { $0.loggedAt > $1.loggedAt }
                )
            }
            .sorted { $0.date > $1.date }
    }
}

private struct MealHistoryDateSection: Identifiable {
    let date: Date
    let meals: [MealLogEntry]

    var id: Date { date }
}

private struct MealHistoryDateHeader: View {
    let date: Date
    let count: Int

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(nutritionDayLabel(date))
                .font(.system(size: 13, weight: .black, design: .rounded))
                .foregroundStyle(.white)

            Spacer(minLength: 8)

            Text("\(count) meal\(count == 1 ? "" : "s")")
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundStyle(FitnessTheme.secondaryText)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(FitnessTheme.cardStroke.opacity(0.35))
    }
}

private struct NutritionDashboardHeader: View {
    var body: some View {
        HStack(spacing: 14) {
            IconBadge(systemImage: "fork.knife", color: FitnessTheme.orange, size: 50)

            VStack(alignment: .leading, spacing: 4) {
                Text("Nutrition")
                    .font(.system(size: 28, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.75)
                Text("Manual meal log")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(FitnessTheme.secondaryText)
            }

            Spacer(minLength: 0)
        }
    }
}

private struct NutritionDailyChart: View {
    let summaries: [NutritionDaySummary]
    let targets: NutritionTargets

    var body: some View {
        Chart {
            ForEach(summaries) { summary in
                BarMark(
                    x: .value("Date", summary.date),
                    y: .value("Calories", summary.totals.calories)
                )
                .foregroundStyle(FitnessTheme.orange.opacity(0.72))

                LineMark(
                    x: .value("Date", summary.date),
                    y: .value("Protein", summary.totals.proteinGrams * 10)
                )
                .interpolationMethod(.catmullRom)
                .foregroundStyle(FitnessTheme.lime)
            }

            RuleMark(y: .value("Calorie target", targets.selectedCalories))
                .foregroundStyle(FitnessTheme.orange.opacity(0.55))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 4)) { value in
                AxisGridLine()
                    .foregroundStyle(FitnessTheme.cardStroke)
                AxisValueLabel {
                    if let date = value.as(Date.self) {
                        Text(MetricChartAnalysis.axisDateText(date))
                            .foregroundStyle(FitnessTheme.secondaryText)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine()
                    .foregroundStyle(FitnessTheme.cardStroke)
                AxisValueLabel {
                    if let amount = value.as(Double.self) {
                        Text(wholeNumber(amount))
                            .foregroundStyle(FitnessTheme.secondaryText)
                    }
                }
            }
        }
        .frame(height: 220)
        .accessibilityLabel("30 day nutrition chart")
    }
}

private struct MealHistoryEntryRow: View {
    let meal: MealLogEntry
    let thumbnailData: Data?
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if thumbnailData != nil || !meal.photoAttachments.isEmpty {
                MealThumbnail(
                    data: thumbnailData,
                    photoCount: meal.photoAttachments.count,
                    size: 48
                )
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(meal.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                Text("\(meal.mealType) · \(nutritionMealTimestamp(meal.loggedAt))")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(FitnessTheme.secondaryText)
                if !meal.note.isEmpty {
                    Text(meal.note)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(FitnessTheme.secondaryText)
                        .lineLimit(2)
                }
                if !meal.photoAttachments.isEmpty, thumbnailData == nil {
                    HStack(spacing: 6) {
                        Image(systemName: "photo.fill")
                            .font(.system(size: 11, weight: .bold))
                        Text("\(meal.photoAttachments.count) photo\(meal.photoAttachments.count == 1 ? "" : "s")")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                    }
                    .foregroundStyle(FitnessTheme.cyan)
                }
                if !meal.ingredients.isEmpty {
                    HStack(spacing: 6) {
                        Image(systemName: "list.bullet.rectangle")
                            .font(.system(size: 11, weight: .bold))
                        Text("\(meal.ingredients.count) ingredient\(meal.ingredients.count == 1 ? "" : "s")")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                    }
                    .foregroundStyle(FitnessTheme.lime)
                }
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 4) {
                Text("\(wholeNumber(meal.totals.calories)) kcal")
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.orange)
                Text("P \(wholeNumber(meal.totals.proteinGrams)) C \(wholeNumber(meal.totals.carbsGrams)) F \(wholeNumber(meal.totals.fatGrams))")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.secondaryText)

                Button(action: onEdit) {
                    Image(systemName: "pencil")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(FitnessTheme.lime)
                        .frame(width: 32, height: 30)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Edit meal")

                Button(action: onDelete) {
                    Image(systemName: "trash")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(FitnessTheme.error)
                        .frame(width: 32, height: 30)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Delete meal")
                .accessibilityHint("Opens a confirmation before deleting")
            }
        }
        .padding(12)
        .accessibilityElement(children: .combine)
    }
}

private struct CompactSyncCard: View {
    let authorizationSummary: HealthKitAuthorizationSummary
    let syncProgress: HealthKitSyncProgress?
    let lastSyncResult: HealthKitSyncResult?
    let isRequestingAuthorization: Bool
    let isSyncing: Bool
    let onRequestAccess: () -> Void
    let onSignIn: () -> Void

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                    StatusPulse(isActive: isSyncing || authorizationSummary.isReady)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Sync")
                            .sectionLabel()
                        Text(statusTitle)
                            .font(.system(size: 18, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer(minLength: 8)
                }

                if isSyncing, let syncProgress {
                    SyncProgressRow(progress: syncProgress)
                } else {
                    Text(statusDetail)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(FitnessTheme.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                actionButtons
            }
        }
    }

    private var statusTitle: String {
        if isSyncing || lastSyncResult == .alreadyRunning {
            return "Syncing Apple Health"
        }

        switch authorizationSummary {
        case .requested:
            return "Ready to sync"
        case .notRequested:
            return "Permission needed"
        case .unavailable:
            return "Health unavailable"
        case .failed:
            return "Permission issue"
        }
    }

    private var statusDetail: String {
        if let lastSyncResult {
            return lastSyncResult.compactSummary
        }

        return authorizationSummary.displayText
    }

    @ViewBuilder
    private var actionButtons: some View {
        if lastSyncResult?.requiresGoogleSignIn == true {
            Button(action: onSignIn) {
                ActionButtonLabel(
                    title: "Sign In with Google",
                    systemImage: "person.crop.circle.badge.checkmark"
                )
            }
            .buttonStyle(PrimaryActionButtonStyle())
            .disabled(isSyncing)
        } else if authorizationSummary.shouldShowReadAccessButton {
            Button(action: onRequestAccess) {
                ActionButtonLabel(
                    title: isRequestingAuthorization
                        ? "Requesting Access"
                        : authorizationSummary.readAccessButtonTitle,
                    systemImage: isRequestingAuthorization
                        ? "hourglass"
                        : "heart.text.square"
                )
            }
            .buttonStyle(PrimaryActionButtonStyle())
            .disabled(isRequestingAuthorization || isSyncing)
        }
    }
}

private struct SettingsView: View {
    let authorizationSummary: HealthKitAuthorizationSummary
    let backendDisplayText: String
    let liveUploadDisplayText: String
    let authSessionStatus: String
    let authSessionMessage: String?
    let isAuthSessionSignedIn: Bool
    let isSigningIn: Bool
    @ObservedObject var notificationSettings: HealthSyncNotificationSettings
    @Binding var autoSyncOnForeground: Bool
    @Binding var completionNotificationsEnabled: Bool
    @Binding var staleSyncRemindersEnabled: Bool
    let onSignIn: () -> Void
    let onSignOut: () -> Void
    let onRequestAccess: () -> Void
    let onRequestNotifications: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                FitnessTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        SettingsHeader()

                        GlassCard {
                            VStack(alignment: .leading, spacing: 14) {
                                SectionHeader(
                                    title: "Account",
                                    trailing: authSessionStatus
                                )
                                Text("Google sign-in authorizes this iPhone for hosted HealthKit sync. Tokens stay in the device Keychain.")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundStyle(FitnessTheme.secondaryText)
                                    .fixedSize(horizontal: false, vertical: true)

                                if isAuthSessionSignedIn {
                                    Button(action: onSignOut) {
                                        ActionButtonLabel(
                                            title: "Sign Out",
                                            systemImage: "rectangle.portrait.and.arrow.right"
                                        )
                                    }
                                    .buttonStyle(SecondaryActionButtonStyle())
                                    .disabled(isSigningIn)
                                } else {
                                    Button(action: onSignIn) {
                                        ActionButtonLabel(
                                            title: isSigningIn ? "Signing In" : "Sign In with Google",
                                            systemImage: isSigningIn
                                                ? "hourglass"
                                                : "person.crop.circle.badge.checkmark"
                                        )
                                    }
                                    .buttonStyle(PrimaryActionButtonStyle())
                                    .disabled(isSigningIn)
                                }

                                if let authSessionMessage {
                                    Text(authSessionMessage)
                                        .font(.system(size: 13, weight: .medium))
                                        .foregroundStyle(FitnessTheme.secondaryText)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }

                        GlassCard {
                            VStack(alignment: .leading, spacing: 14) {
                                SectionHeader(title: "ChatGPT MCP", trailing: "Meals + stats")
                                Text("Connect ChatGPT to the hosted MCP server to read health summaries, meal history by date or range, create meal logs, update meals, delete meals after approval, and generate reports.")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundStyle(FitnessTheme.secondaryText)
                                    .fixedSize(horizontal: false, vertical: true)

                                SourceDetailRow(title: "Server", value: "https://fitness-ten-fawn.vercel.app/mcp")
                                SourceDetailRow(title: "Client ID", value: "fitness-chatgpt")
                                SourceDetailRow(title: "Scopes", value: "health:read meal:write coach:read report:read")

                                Text("Ask ChatGPT to use `get_meal_log` for dates or ranges, `get_health_summary` for stats, `upsert_meal_log` to create meals, and `get_mcp_capabilities` when it needs the full tool list.")
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(FitnessTheme.secondaryText)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }

                        GlassCard {
                            VStack(alignment: .leading, spacing: 14) {
                                SectionHeader(
                                    title: "Apple Health",
                                    trailing: authorizationSummary.shortStatus
                                )
                                Text(authorizationSummary.settingsText)
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundStyle(FitnessTheme.secondaryText)
                                    .fixedSize(horizontal: false, vertical: true)

                                if authorizationSummary.shouldShowReadAccessButton {
                                    Button(action: onRequestAccess) {
                                        ActionButtonLabel(
                                            title: authorizationSummary.readAccessButtonTitle,
                                            systemImage: "heart.text.square"
                                        )
                                    }
                                    .buttonStyle(SecondaryActionButtonStyle())
                                }

                                Divider().overlay(FitnessTheme.cardStroke)

                                SourceDetailRow(title: "Backend", value: backendDisplayText)
                                SourceDetailRow(title: "Live Upload", value: liveUploadDisplayText)
                                SourceDetailRow(
                                    title: "Metric Access",
                                    value: "\(HealthKitStore.firstSliceReadDescriptors.count) read types"
                                )
                            }
                        }

                        GlassCard {
                            VStack(alignment: .leading, spacing: 14) {
                                SectionHeader(title: "Sync Automation", trailing: "iOS managed")
                                SettingsToggleRow(
                                    title: "Auto-sync on Open",
                                    subtitle: "Runs when you open the app, with a short cooldown.",
                                    isOn: $autoSyncOnForeground
                                )
                                Divider().overlay(FitnessTheme.cardStroke)
                                SourceDetailRow(title: "Health Changes", value: "Hourly HealthKit wakes")
                                SourceDetailRow(title: "Background Catch-up", value: "Earliest retry: 15 min")
                                Text("iOS decides the exact time. Background sync needs Health permission, Background App Refresh, a stored session, and the app not being force-quit.")
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(FitnessTheme.secondaryText)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }

                        GlassCard {
                            VStack(alignment: .leading, spacing: 14) {
                                SectionHeader(title: "App", trailing: AppBuildInfo.displayText)
                                SourceDetailRow(title: "Version", value: AppBuildInfo.displayText)
                            }
                        }

                        GlassCard {
                            VStack(alignment: .leading, spacing: 14) {
                                SectionHeader(
                                    title: "Notifications",
                                    trailing: notificationSettings.authorizationStatus.displayText
                                )
                                Text("Only long successful background syncs can send a completion alert. Foreground sync stays in-app.")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundStyle(FitnessTheme.secondaryText)
                                    .fixedSize(horizontal: false, vertical: true)

                                SettingsToggleRow(
                                    title: "Long Sync Done",
                                    subtitle: "Alert only after a long successful sync finishes outside the app.",
                                    isOn: $completionNotificationsEnabled
                                )
                                SettingsToggleRow(
                                    title: "Stale Reminder",
                                    subtitle: "Remind me after 8 hours without a successful sync.",
                                    isOn: $staleSyncRemindersEnabled
                                )

                                if notificationSettings.authorizationStatus != .authorized {
                                    Button(action: notificationAction) {
                                        ActionButtonLabel(
                                            title: notificationButtonTitle,
                                            systemImage: notificationButtonIcon
                                        )
                                    }
                                    .buttonStyle(SecondaryActionButtonStyle())
                                }

                                if notificationSettings.authorizationStatus == .denied {
                                    Text("Notifications are disabled in iOS Settings.")
                                        .font(.system(size: 13, weight: .medium))
                                        .foregroundStyle(FitnessTheme.secondaryText)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 18)
                    .padding(.bottom, 32)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                    .foregroundStyle(FitnessTheme.lime)
                }
            }
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .task {
            await notificationSettings.refresh()
        }
        .onChange(of: staleSyncRemindersEnabled) { _, isEnabled in
            guard !isEnabled else {
                return
            }

            notificationSettings.cancelStaleReminder()
        }
    }

    private var notificationButtonTitle: String {
        notificationSettings.authorizationStatus == .denied
            ? "Open iOS Settings"
            : "Enable Notifications"
    }

    private var notificationButtonIcon: String {
        notificationSettings.authorizationStatus == .denied
            ? "gearshape"
            : "bell.badge"
    }

    private func notificationAction() {
        if notificationSettings.authorizationStatus == .denied,
           let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
            return
        }

        onRequestNotifications()
    }
}

private struct SettingsHeader: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("SETTINGS")
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(FitnessTheme.lime)
            Text("Sync Controls")
                .font(.system(size: 30, weight: .black, design: .rounded))
                .foregroundStyle(.white)
        }
    }
}

private struct MetricsCard: View {
    let authorizationSummary: HealthKitAuthorizationSummary
    @ObservedObject var healthKitStore: HealthKitStore

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                SectionHeader(
                    title: "Metrics",
                    trailing: "\(HealthKitStore.firstSliceReadDescriptors.count) trends"
                )

                if !authorizationSummary.isReady {
                    Text("Request Apple Health access to view local trend charts.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(FitnessTheme.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                VStack(spacing: 10) {
                    ForEach(HealthKitStore.firstSliceReadDescriptors) { descriptor in
                        NavigationLink {
                            MetricDetailView(
                                descriptor: descriptor,
                                healthKitStore: healthKitStore
                            )
                        } label: {
                            MetricRow(descriptor: descriptor)
                        }
                        .buttonStyle(.plain)
                        .disabled(!authorizationSummary.isReady)
                    }
                }
            }
        }
    }
}

private struct MetricRow: View {
    let descriptor: HealthKitMetricDescriptor

    var body: some View {
        HStack(spacing: 12) {
            IconBadge(systemImage: descriptor.systemImage, color: descriptor.accentColor, size: 38)

            VStack(alignment: .leading, spacing: 3) {
                Text(descriptor.displayName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                Text("Daily trend • \(descriptor.normalizedUnit.uppercased())")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(FitnessTheme.secondaryText)
            }

            Spacer()

            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(descriptor.accentColor)
                .accessibilityHidden(true)

            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(FitnessTheme.secondaryText.opacity(0.75))
                .accessibilityHidden(true)
        }
        .padding(10)
        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(FitnessTheme.cardStroke, lineWidth: 1)
        )
    }
}

private struct UnavailableMetricDeepLinkView: View {
    let metricName: String

    var body: some View {
        ZStack {
            FitnessTheme.background.ignoresSafeArea()

            GlassCard {
                VStack(alignment: .leading, spacing: 10) {
                    SectionHeader(title: "Metric Unavailable", trailing: "Link")
                    Text("This widget link points to \(metricName.replacingOccurrences(of: "_", with: " ")), which is not available in the current HealthKit metric set.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(FitnessTheme.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(20)
        }
        .navigationTitle("Metric")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

private struct MetricDetailView: View {
    let descriptor: HealthKitMetricDescriptor
    @ObservedObject var healthKitStore: HealthKitStore
    @State private var points: [HealthMetricChartPoint] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            FitnessTheme.background.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    MetricDetailHeader(descriptor: descriptor)

                    GlassCard {
                        VStack(alignment: .leading, spacing: 14) {
                            SectionHeader(title: "Trend", trailing: descriptor.normalizedUnit.uppercased())

                            if isLoading {
                                HStack(spacing: 10) {
                                    ProgressView()
                                        .controlSize(.small)
                                        .tint(FitnessTheme.lime)
                                    Text("Loading data")
                                        .font(.system(size: 14, weight: .medium))
                                        .foregroundStyle(FitnessTheme.secondaryText)
                                }
                                .frame(maxWidth: .infinity, minHeight: 220, alignment: .center)
                            } else if let errorMessage {
                                Text(errorMessage)
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(FitnessTheme.error)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .frame(maxWidth: .infinity, minHeight: 220, alignment: .center)
                            } else if points.isEmpty {
                                Text("No recent HealthKit data for this metric.")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundStyle(FitnessTheme.secondaryText)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .frame(maxWidth: .infinity, minHeight: 220, alignment: .center)
                            } else {
                                MetricTrendChart(points: points, descriptor: descriptor)
                            }
                        }
                    }

                    if !points.isEmpty {
                        GlassCard {
                            VStack(alignment: .leading, spacing: 12) {
                                SectionHeader(title: "Snapshot", trailing: "\(points.count) days")
                                SummaryRow(title: "Latest", value: formattedLatestValue)
                                SummaryRow(title: "Range", value: formattedValueRange)
                            }
                        }

                        MetricHistoryTableCard(points: points, descriptor: descriptor)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 32)
            }
        }
        .toolbarColorScheme(.dark, for: .navigationBar)
        .navigationTitle(descriptor.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: descriptor.id) {
            await loadPoints()
        }
        .refreshable {
            await loadPoints()
        }
    }

    private var formattedLatestValue: String {
        guard let latest = points.max(by: { $0.date < $1.date }) else {
            return "No data"
        }

        return MetricChartAnalysis.valueText(latest.value, unit: latest.unit)
    }

    private var formattedValueRange: String {
        let values = points.map(\.value)

        guard let min = values.min(),
              let max = values.max() else {
            return "No data"
        }

        return MetricChartAnalysis.rangeValueText(
            min: min,
            max: max,
            unit: descriptor.normalizedUnit
        )
    }

    @MainActor
    private func loadPoints() async {
        isLoading = true
        errorMessage = nil

        do {
            points = try await healthKitStore.metricChartPoints(
                for: descriptor,
                days: 365
            )
        } catch {
            points = []
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }
}

private struct MetricDetailHeader: View {
    let descriptor: HealthKitMetricDescriptor

    var body: some View {
        HStack(spacing: 14) {
            IconBadge(systemImage: descriptor.systemImage, color: descriptor.accentColor, size: 50)

            VStack(alignment: .leading, spacing: 4) {
                Text(descriptor.displayName)
                    .font(.system(size: 28, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.75)
                Text("Daily HealthKit aggregate")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(FitnessTheme.secondaryText)
            }

            Spacer(minLength: 0)
        }
    }
}

private struct MetricTrendChart: View {
    let points: [HealthMetricChartPoint]
    let descriptor: HealthKitMetricDescriptor
    @State private var selectedPoint: HealthMetricChartPoint?
    @State private var displayMode = MetricChartDisplayMode.daily
    @State private var selectedPreset: MetricChartWindowPreset? = .thirtyDays
    @State private var selectedRange: ClosedRange<Date>?
    @State private var chartZoomStartRange: ClosedRange<Date>?
    @State private var chartDragIntent: MetricChartDragIntent?

    var body: some View {
        let chartPoints = MetricChartAnalysis.displayPoints(
            from: points,
            mode: displayMode,
            calendar: .current
        )
        let range = activeRange(in: chartPoints)
        let visiblePoints = MetricChartAnalysis.points(
            in: range,
            from: chartPoints
        )
        let focusCandidates = MetricChartAnalysis.focusCandidatePoints(
            in: visiblePoints,
            mode: displayMode,
            calendar: .current
        )
        let focus = focusedPoint(in: focusCandidates)
        let linePoints = MetricChartAnalysis.linePoints(
            in: range,
            from: chartPoints
        )
        let pointMarkPoints = MetricChartAnalysis.pointMarkPoints(
            in: visiblePoints,
            mode: displayMode,
            focusedPoint: focus,
            calendar: .current
        )
        let progress = MetricChartAnalysis.progressItems(
            visiblePoints: visiblePoints,
            descriptor: descriptor,
            displayMode: displayMode,
            calendar: .current
        )
        VStack(alignment: .leading, spacing: 14) {
            MetricChartSeriesSelector(displayMode: $displayMode)

            MetricProgressStrip(items: progress)

            MetricChartFocusSummary(
                point: focus,
                descriptor: descriptor,
                displayMode: displayMode
            )

            Chart {
                ForEach(linePoints) { point in
                    LineMark(
                        x: .value("Date", point.date),
                        y: .value(descriptor.normalizedUnit, point.value)
                    )
                    .interpolationMethod(.catmullRom)
                    .foregroundStyle(descriptor.accentColor)
                }

                ForEach(pointMarkPoints) { point in
                    PointMark(
                        x: .value("Date", point.date),
                        y: .value(descriptor.normalizedUnit, point.value)
                    )
                    .foregroundStyle(descriptor.accentColor)
                    .symbolSize(displayMode.isDaily ? 18 : 28)
                }

                if let focus {
                    RuleMark(x: .value("Focused date", focus.date))
                        .foregroundStyle(descriptor.accentColor.opacity(0.55))
                        .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 4]))

                    PointMark(
                        x: .value("Focused date", focus.date),
                        y: .value(descriptor.normalizedUnit, focus.value)
                    )
                    .foregroundStyle(.white)
                    .symbolSize(62)
                }
            }
            .chartXScale(domain: range)
            .chartYScale(domain: MetricChartAnalysis.valueDomain(for: linePoints))
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 4)) { value in
                    AxisGridLine()
                        .foregroundStyle(FitnessTheme.cardStroke)
                    AxisValueLabel {
                        if let date = value.as(Date.self) {
                            Text(MetricChartAnalysis.axisDateText(date))
                                .foregroundStyle(FitnessTheme.secondaryText)
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading) { value in
                    AxisGridLine()
                        .foregroundStyle(FitnessTheme.cardStroke)
                    AxisValueLabel {
                        if let amount = value.as(Double.self) {
                            Text(MetricChartAnalysis.valueText(amount, unit: descriptor.normalizedUnit))
                                .foregroundStyle(FitnessTheme.secondaryText)
                        }
                    }
                }
            }
            .chartOverlay { proxy in
                GeometryReader { geometry in
                    Rectangle()
                        .fill(.clear)
                        .contentShape(Rectangle())
                        .simultaneousGesture(
                            SpatialTapGesture()
                                .onEnded { value in
                                    selectPoint(
                                        at: value.location,
                                        in: focusCandidates,
                                        proxy: proxy,
                                        geometry: geometry
                                    )
                                }
                        )
                        .simultaneousGesture(
                            DragGesture(minimumDistance: 8)
                                .onChanged { value in
                                    handleChartDragChanged(
                                        value,
                                        focusCandidates: focusCandidates,
                                        proxy: proxy,
                                        geometry: geometry
                                    )
                                }
                                .onEnded { _ in
                                    chartDragIntent = nil
                                }
                        )
                }
            }
            .chartPlotStyle { plotArea in
                plotArea.clipped()
            }
            .frame(height: 260)
            .accessibilityIdentifier("metricTrendChart")
            .simultaneousGesture(
                MagnificationGesture()
                    .onChanged { magnification in
                        zoomVisibleWindow(
                            magnification: magnification,
                            currentRange: range,
                            chartPoints: chartPoints,
                            focus: focus
                        )
                    }
                    .onEnded { _ in
                        chartZoomStartRange = nil
                    }
            )

            MetricChartTimelineControls(
                range: range,
                selectedPreset: selectedPreset,
                canMoveEarlier: MetricChartAnalysis.canMoveEarlier(
                    range,
                    in: chartPoints
                ),
                canMoveLater: MetricChartAnalysis.canMoveLater(
                    range,
                    in: chartPoints
                ),
                onMoveEarlier: {
                    moveVisibleWindow(direction: -1, chartPoints: chartPoints)
                },
                onMoveLater: {
                    moveVisibleWindow(direction: 1, chartPoints: chartPoints)
                },
                onSelectPreset: { preset in
                    selectPreset(preset, chartPoints: chartPoints)
                }
            )

            if shouldShowRangeSelector(range: range, chartPoints: chartPoints) {
                MetricChartRangeSelector(
                    points: chartPoints,
                    selectedRange: Binding(
                        get: { activeRange(in: chartPoints) },
                        set: { newRange in
                            selectedPreset = nil
                            selectedRange = newRange
                            selectedPoint = nil
                        }
                    ),
                    tint: descriptor.accentColor
                )
                .accessibilityIdentifier("metricChartRangeSelector")
            }
        }
        .accessibilityLabel("\(descriptor.displayName) trend chart")
        .accessibilityValue(accessibilityValue(focus))
        .onAppear {
            normalizeRange(in: chartPoints)
        }
        .onChange(of: points) { _, newPoints in
            let updatedChartPoints = MetricChartAnalysis.displayPoints(
                from: newPoints,
                mode: displayMode,
                calendar: .current
            )

            normalizeRange(in: updatedChartPoints)
            selectedPoint = nil
        }
        .onChange(of: displayMode) { _, newMode in
            let updatedChartPoints = MetricChartAnalysis.displayPoints(
                from: points,
                mode: newMode,
                calendar: .current
            )

            if let defaultPreset = newMode.defaultWindowPreset {
                selectPreset(defaultPreset, chartPoints: updatedChartPoints)
            } else {
                normalizeRange(in: updatedChartPoints)
            }
            selectedPoint = nil
        }
    }

    private func activeRange(
        in chartPoints: [HealthMetricChartPoint]
    ) -> ClosedRange<Date> {
        let fallback = MetricChartAnalysis.presetRange(
            selectedPreset ?? .allTime,
            in: chartPoints,
            calendar: .current
        )

        return MetricChartAnalysis.clampedRange(
            selectedRange ?? fallback,
            in: chartPoints,
            minimumDays: MetricChartWindowPreset.minimumCustomDays,
            calendar: .current
        )
    }

    private func shouldShowRangeSelector(
        range: ClosedRange<Date>,
        chartPoints: [HealthMetricChartPoint]
    ) -> Bool {
        selectedPreset != .allTime
            && chartPoints.count > 1
            && !MetricChartAnalysis.isFullRange(range, in: chartPoints)
    }

    private func focusedPoint(
        in visiblePoints: [HealthMetricChartPoint]
    ) -> HealthMetricChartPoint? {
        if let selectedPoint,
           visiblePoints.contains(where: { $0.id == selectedPoint.id }) {
            return selectedPoint
        }

        return visiblePoints.max { $0.date < $1.date }
    }

    private func accessibilityValue(
        _ focusedPoint: HealthMetricChartPoint?
    ) -> String {
        guard let focusedPoint else {
            return "No focused day"
        }

        return "\(formattedDate(focusedPoint.date)), \(MetricChartAnalysis.valueText(focusedPoint.value, unit: focusedPoint.unit))"
    }

    private func selectPoint(
        at location: CGPoint,
        in visiblePoints: [HealthMetricChartPoint],
        proxy: ChartProxy,
        geometry: GeometryProxy
    ) {
        guard let plotFrame = proxy.plotFrame else {
            return
        }

        let plotAreaFrame = geometry[plotFrame]
        let xPosition = location.x - plotAreaFrame.origin.x

        guard xPosition >= 0,
              xPosition <= plotAreaFrame.width,
              let selectedDate = proxy.value(atX: xPosition, as: Date.self),
              let nearestPoint = MetricChartAnalysis.nearestPoint(
                to: selectedDate,
                in: visiblePoints
              ) else {
            return
        }

        selectedPoint = nearestPoint
    }

    private func handleChartDragChanged(
        _ value: DragGesture.Value,
        focusCandidates: [HealthMetricChartPoint],
        proxy: ChartProxy,
        geometry: GeometryProxy
    ) {
        if chartDragIntent == nil {
            chartDragIntent = MetricChartDragIntent(
                translation: value.translation
            )
        }

        guard chartDragIntent == .horizontal else {
            return
        }

        selectPoint(
            at: value.location,
            in: focusCandidates,
            proxy: proxy,
            geometry: geometry
        )
    }

    private func moveVisibleWindow(
        direction: Int,
        chartPoints: [HealthMetricChartPoint]
    ) {
        let range = activeRange(in: chartPoints)
        let duration = range.upperBound.timeIntervalSince(range.lowerBound)
        let step = duration * 0.85 * Double(direction)

        selectedPreset = nil
        selectedPoint = nil
        selectedRange = MetricChartAnalysis.translatedRange(
            range,
            by: step,
            domain: MetricChartAnalysis.fullRange(in: chartPoints),
            minimumDays: MetricChartWindowPreset.minimumCustomDays
        )
    }

    private func selectPreset(
        _ preset: MetricChartWindowPreset,
        chartPoints: [HealthMetricChartPoint]
    ) {
        let requestedRange = MetricChartAnalysis.presetRange(
            preset,
            in: chartPoints,
            calendar: .current
        )
        let normalizedPreset = MetricChartAnalysis.normalizedPreset(
            preset,
            requestedRange: requestedRange,
            in: chartPoints
        )

        selectedPreset = normalizedPreset
        selectedRange = MetricChartAnalysis.presetRange(
            normalizedPreset,
            in: chartPoints,
            calendar: .current
        )
        selectedPoint = nil
    }

    private func normalizeRange(in chartPoints: [HealthMetricChartPoint]) {
        if let selectedPreset {
            selectPreset(selectedPreset, chartPoints: chartPoints)
            return
        }

        selectedRange = MetricChartAnalysis.clampedRange(
            selectedRange ?? MetricChartAnalysis.fullRange(in: chartPoints),
            in: chartPoints,
            minimumDays: MetricChartWindowPreset.minimumCustomDays,
            calendar: .current
        )
    }

    private func zoomVisibleWindow(
        magnification: CGFloat,
        currentRange: ClosedRange<Date>,
        chartPoints: [HealthMetricChartPoint],
        focus: HealthMetricChartPoint?
    ) {
        let startRange = chartZoomStartRange ?? currentRange
        chartZoomStartRange = startRange
        selectedPreset = nil
        selectedPoint = nil
        selectedRange = MetricChartAnalysis.zoomedRange(
            startRange,
            magnification: magnification,
            center: focus?.date,
            domain: MetricChartAnalysis.fullRange(in: chartPoints),
            minimumDays: MetricChartWindowPreset.minimumCustomDays
        )
    }
}

private enum MetricChartDragIntent {
    case horizontal
    case vertical

    init(translation: CGSize) {
        if abs(translation.height) > abs(translation.width) * 1.2 {
            self = .vertical
        } else {
            self = .horizontal
        }
    }
}

private struct MetricChartFocusSummary: View {
    let point: HealthMetricChartPoint?
    let descriptor: HealthKitMetricDescriptor
    let displayMode: MetricChartDisplayMode

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 3) {
                Text(dateText)
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.secondaryText)
                Text(valueText)
                    .font(.system(size: 24, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
            }

            Spacer(minLength: 12)

            Text(displayMode.label)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(descriptor.accentColor)
                .textCase(.uppercase)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(12)
        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(FitnessTheme.cardStroke, lineWidth: 1)
        )
    }

    private var dateText: String {
        guard let point else {
            return "No point in range"
        }

        return formattedDate(point.date)
    }

    private var valueText: String {
        guard let point else {
            return "N/A"
        }

        return MetricChartAnalysis.valueText(point.value, unit: point.unit)
    }
}

private struct MetricChartSeriesSelector: View {
    @Binding var displayMode: MetricChartDisplayMode

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Series")
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    .textCase(.uppercase)
                Text("1D values or rolling averages")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(FitnessTheme.secondaryText.opacity(0.85))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }

            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4),
                spacing: 8
            ) {
                ForEach(MetricChartDisplayMode.allCases) { mode in
                    Button {
                        displayMode = mode
                    } label: {
                        Text(mode.compactLabel)
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .frame(maxWidth: .infinity)
                            .frame(height: 34)
                            .foregroundStyle(
                                displayMode == mode ? FitnessTheme.actionText : FitnessTheme.secondaryText
                            )
                            .background(
                                displayMode == mode ? FitnessTheme.lime : FitnessTheme.rowFill,
                                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(FitnessTheme.cardStroke, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(mode.accessibilityLabel)
                    .accessibilityIdentifier("metricChartDisplayMode.\(mode.id)")
                }
            }
            .accessibilityIdentifier("metricChartDisplayMode")
        }
    }
}

private struct MetricProgressStrip: View {
    let items: [MetricChartProgressItem]

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.title)
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(FitnessTheme.secondaryText)
                        .textCase(.uppercase)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    Text(item.value)
                        .font(.system(size: 15, weight: .black, design: .rounded))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                    Text(item.caption)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(FitnessTheme.secondaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)

                if index < items.count - 1 {
                    Rectangle()
                        .fill(FitnessTheme.cardStroke)
                        .frame(width: 1)
                        .padding(.horizontal, 10)
                        .accessibilityHidden(true)
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityIdentifier("metricChartProgressStrip")
    }
}

private struct MetricChartTimelineControls: View {
    let range: ClosedRange<Date>
    let selectedPreset: MetricChartWindowPreset?
    let canMoveEarlier: Bool
    let canMoveLater: Bool
    let onMoveEarlier: () -> Void
    let onMoveLater: () -> Void
    let onSelectPreset: (MetricChartWindowPreset) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Button(action: onMoveEarlier) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 14, weight: .bold))
                        .frame(width: 42, height: 38)
                }
                .disabled(!canMoveEarlier)
                .buttonStyle(MetricChartIconButtonStyle())
                .accessibilityLabel("Show earlier dates")
                .accessibilityIdentifier("metricChartMoveEarlier")

                Menu {
                    ForEach(MetricChartWindowPreset.menuCases) { preset in
                        Button {
                            onSelectPreset(preset)
                        } label: {
                            if selectedPreset == preset {
                                Label(preset.menuLabel, systemImage: "checkmark")
                            } else {
                                Text(preset.menuLabel)
                            }
                        }
                        .accessibilityIdentifier("metricChartRangePreset.\(preset.id)")
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "calendar")
                            .font(.system(size: 13, weight: .bold))
                        Text(selectedPreset?.label.uppercased() ?? "CUSTOM")
                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                            .lineLimit(1)
                    }
                    .frame(width: 92, height: 38)
                }
                .buttonStyle(MetricChartIconButtonStyle(isActive: selectedPreset != nil))
                .accessibilityLabel("Choose date range")
                .accessibilityIdentifier("metricChartRangeMenu")

                VStack(alignment: .leading, spacing: 2) {
                    Text("Visible Range")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(FitnessTheme.secondaryText)
                        .textCase(.uppercase)
                    Text(MetricChartAnalysis.rangeText(range))
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                        .foregroundStyle(FitnessTheme.secondaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Visible range")
                .accessibilityValue(MetricChartAnalysis.rangeText(range))

                Button(action: onMoveLater) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .bold))
                        .frame(width: 42, height: 38)
                }
                .disabled(!canMoveLater)
                .buttonStyle(MetricChartIconButtonStyle())
                .accessibilityLabel("Show later dates")
                .accessibilityIdentifier("metricChartMoveLater")
            }
        }
    }
}

private struct MetricChartIconButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    var isActive = false

    init(isActive: Bool = false) {
        self.isActive = isActive
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(foregroundColor)
            .background(backgroundColor, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(
                        isEnabled ? FitnessTheme.lime.opacity(isActive ? 0.72 : 0.30) : FitnessTheme.cardStroke,
                        lineWidth: 1
                    )
            )
            .opacity(configuration.isPressed ? 0.78 : 1)
    }

    private var foregroundColor: Color {
        guard isEnabled else {
            return FitnessTheme.secondaryText.opacity(0.45)
        }

        return isActive ? FitnessTheme.actionText : FitnessTheme.lime
    }

    private var backgroundColor: Color {
        isActive ? FitnessTheme.lime : FitnessTheme.rowFill
    }
}

private struct MetricChartRangeSelector: View {
    let points: [HealthMetricChartPoint]
    @Binding var selectedRange: ClosedRange<Date>
    let tint: Color
    @State private var dragStartRange: ClosedRange<Date>?

    var body: some View {
        GeometryReader { geometry in
            let width = max(geometry.size.width, 1)
            let domain = MetricChartAnalysis.fullRange(in: points)
            let range = MetricChartAnalysis.clampedRange(
                selectedRange,
                in: points,
                minimumDays: MetricChartWindowPreset.minimumCustomDays,
                calendar: .current
            )
            let startX = xPosition(for: range.lowerBound, in: domain, width: width)
            let endX = xPosition(for: range.upperBound, in: domain, width: width)
            let rangeWidth = max(endX - startX, 2)
            let handleWidth = min(max(rangeWidth, 54), 92)
            let handleX = min(
                max(startX + (rangeWidth / 2) - (handleWidth / 2), 0),
                max(width - handleWidth, 0)
            )

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(FitnessTheme.cardStroke)
                    .frame(width: width, height: 6)
                    .offset(y: 17)

                Capsule()
                    .fill(tint.opacity(0.48))
                    .frame(width: rangeWidth, height: 6)
                    .offset(x: startX, y: 17)

                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(FitnessTheme.rowFill)
                    .frame(width: handleWidth, height: 30)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(tint.opacity(0.55), lineWidth: 1)
                    )
                    .overlay {
                        HStack(spacing: 4) {
                            ForEach(0..<3, id: \.self) { _ in
                                Capsule()
                                    .fill(tint.opacity(0.78))
                                    .frame(width: 3, height: 13)
                            }
                        }
                    }
                    .offset(x: handleX, y: 5)
            }
            .contentShape(Rectangle())
            .gesture(rangeDragGesture(width: width, domain: domain))
        }
        .frame(height: 40)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Visible date range")
        .accessibilityValue(MetricChartAnalysis.rangeText(selectedRange))
    }

    private func rangeDragGesture(
        width: CGFloat,
        domain: ClosedRange<Date>
    ) -> some Gesture {
        DragGesture(minimumDistance: 6)
            .onChanged { value in
                if dragStartRange == nil {
                    dragStartRange = selectedRange
                }

                guard let dragStartRange else {
                    return
                }

                let domainDuration = max(domain.upperBound.timeIntervalSince(domain.lowerBound), 1)
                let seconds = domainDuration * Double(value.translation.width / width)
                selectedRange = MetricChartAnalysis.translatedRange(
                    dragStartRange,
                    by: seconds,
                    domain: domain,
                    minimumDays: MetricChartWindowPreset.minimumCustomDays
                )
            }
            .onEnded { _ in
                dragStartRange = nil
            }
    }

    private func xPosition(
        for date: Date,
        in domain: ClosedRange<Date>,
        width: CGFloat
    ) -> CGFloat {
        let duration = max(domain.upperBound.timeIntervalSince(domain.lowerBound), 1)
        let offset = date.timeIntervalSince(domain.lowerBound)

        return min(max(CGFloat(offset / duration) * width, 0), width)
    }
}

enum MetricChartDisplayMode: String, CaseIterable, Identifiable {
    case daily
    case rollingThreeDay
    case rollingSevenDay
    case rollingTwoWeek
    case rollingThirtyDay
    case rollingNinetyDay
    case rollingSixMonth
    case rollingOneYear

    var id: String { rawValue }

    var label: String {
        switch self {
        case .daily:
            return "1D"
        case .rollingThreeDay:
            return "3D Avg"
        case .rollingSevenDay:
            return "1W Avg"
        case .rollingTwoWeek:
            return "2W Avg"
        case .rollingThirtyDay:
            return "1M Avg"
        case .rollingNinetyDay:
            return "90D Avg"
        case .rollingSixMonth:
            return "6M Avg"
        case .rollingOneYear:
            return "1Y Avg"
        }
    }

    var compactLabel: String {
        switch self {
        case .daily:
            return "1D"
        case .rollingThreeDay:
            return "3D"
        case .rollingSevenDay:
            return "1W"
        case .rollingTwoWeek:
            return "2W"
        case .rollingThirtyDay:
            return "1M"
        case .rollingNinetyDay:
            return "90D"
        case .rollingSixMonth:
            return "6M"
        case .rollingOneYear:
            return "1Y"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .daily:
            return "1D values"
        default:
            return "\(label) values"
        }
    }

    var defaultWindowPreset: MetricChartWindowPreset? {
        switch self {
        case .rollingThreeDay, .rollingSevenDay:
            return .thirtyDays
        case .daily,
             .rollingTwoWeek,
             .rollingThirtyDay,
             .rollingNinetyDay,
             .rollingSixMonth,
             .rollingOneYear:
            return nil
        }
    }

    var isDaily: Bool {
        self == .daily
    }

    var rollingWindowDays: Int? {
        switch self {
        case .daily:
            return nil
        case .rollingThreeDay:
            return 3
        case .rollingSevenDay:
            return 7
        case .rollingTwoWeek:
            return 14
        case .rollingThirtyDay:
            return 30
        case .rollingNinetyDay:
            return 90
        case .rollingSixMonth:
            return 180
        case .rollingOneYear:
            return 365
        }
    }

    var markerSpacingDays: Int {
        switch self {
        case .daily:
            return 1
        case .rollingThreeDay:
            return 3
        case .rollingSevenDay:
            return 7
        case .rollingTwoWeek:
            return 14
        case .rollingThirtyDay:
            return 30
        case .rollingNinetyDay,
             .rollingSixMonth,
             .rollingOneYear:
            return 30
        }
    }
}

enum MetricChartWindowPreset: String, CaseIterable, Identifiable {
    case thirtyDays
    case ninetyDays
    case sixMonths
    case oneYear
    case allTime

    static let minimumCustomDays = 7
    static let windowedCases: [MetricChartWindowPreset] = [
        .thirtyDays,
        .ninetyDays,
        .sixMonths,
        .oneYear,
    ]
    static let menuCases: [MetricChartWindowPreset] = [
        .allTime,
        .thirtyDays,
        .ninetyDays,
        .sixMonths,
        .oneYear,
    ]

    var id: String { rawValue }

    var label: String {
        switch self {
        case .thirtyDays:
            return "1M"
        case .ninetyDays:
            return "90D"
        case .sixMonths:
            return "6M"
        case .oneYear:
            return "1Y"
        case .allTime:
            return "All"
        }
    }

    var menuLabel: String {
        switch self {
        case .allTime:
            return "All data"
        default:
            return label
        }
    }

    var days: Int? {
        switch self {
        case .thirtyDays:
            return 30
        case .ninetyDays:
            return 90
        case .sixMonths:
            return 180
        case .oneYear:
            return 365
        case .allTime:
            return nil
        }
    }
}

struct MetricChartProgressItem: Equatable, Identifiable {
    let title: String
    let value: String
    let caption: String

    var id: String { "\(title)-\(caption)" }
}

enum MetricChartAnalysis {
    static func displayPoints(
        from points: [HealthMetricChartPoint],
        mode: MetricChartDisplayMode,
        calendar: Calendar
    ) -> [HealthMetricChartPoint] {
        let sortedPoints = sorted(points)

        if let rollingWindowDays = mode.rollingWindowDays {
            return rollingAverage(
                from: sortedPoints,
                days: rollingWindowDays,
                calendar: calendar
            )
        }

        return sortedPoints
    }

    static func rollingAverage(
        from sortedPoints: [HealthMetricChartPoint],
        days: Int,
        calendar: Calendar
    ) -> [HealthMetricChartPoint] {
        sortedPoints.map { point in
            let dayStart = calendar.startOfDay(for: point.date)
            let windowStart = calendar.date(
                byAdding: .day,
                value: -max(0, days - 1),
                to: dayStart
            ) ?? dayStart
            let window = sortedPoints.filter {
                $0.date >= windowStart && $0.date <= point.date
            }
            let average = window.map(\.value).reduce(0, +) / Double(max(window.count, 1))

            return HealthMetricChartPoint(
                date: point.date,
                value: average,
                unit: point.unit
            )
        }
    }

    static func trailingRange(
        in points: [HealthMetricChartPoint],
        days: Int,
        calendar: Calendar
    ) -> ClosedRange<Date> {
        let domain = fullRange(in: points)
        let requestedStart = calendar.date(
            byAdding: .day,
            value: -max(1, days),
            to: domain.upperBound
        ) ?? domain.lowerBound

        return clampedRange(
            max(requestedStart, domain.lowerBound)...domain.upperBound,
            to: domain,
            minimumDays: min(MetricChartWindowPreset.minimumCustomDays, max(1, days))
        )
    }

    static func presetRange(
        _ preset: MetricChartWindowPreset,
        in points: [HealthMetricChartPoint],
        calendar: Calendar
    ) -> ClosedRange<Date> {
        guard let days = preset.days else {
            return fullRange(in: points)
        }

        return trailingRange(
            in: points,
            days: days,
            calendar: calendar
        )
    }

    static func normalizedPreset(
        _ preset: MetricChartWindowPreset,
        requestedRange: ClosedRange<Date>,
        in points: [HealthMetricChartPoint]
    ) -> MetricChartWindowPreset {
        guard preset != .allTime,
              sorted(points).count > 1,
              self.points(in: requestedRange, from: points).count < 2 else {
            return preset
        }

        return .allTime
    }

    static func clampedRange(
        _ range: ClosedRange<Date>,
        in points: [HealthMetricChartPoint],
        minimumDays: Int,
        calendar _: Calendar
    ) -> ClosedRange<Date> {
        clampedRange(
            range,
            to: fullRange(in: points),
            minimumDays: minimumDays
        )
    }

    static func clampedRange(
        _ range: ClosedRange<Date>,
        to domain: ClosedRange<Date>,
        minimumDays: Int
    ) -> ClosedRange<Date> {
        let domainDuration = domain.upperBound.timeIntervalSince(domain.lowerBound)
        let minimumDuration = TimeInterval(max(1, minimumDays) * 24 * 60 * 60)

        guard domainDuration > minimumDuration else {
            return domain
        }

        var lower = max(range.lowerBound, domain.lowerBound)
        var upper = min(range.upperBound, domain.upperBound)

        if lower > upper {
            lower = domain.lowerBound
            upper = domain.upperBound
        }

        if upper.timeIntervalSince(lower) < minimumDuration {
            let center = lower.addingTimeInterval(upper.timeIntervalSince(lower) / 2)
            lower = center.addingTimeInterval(-minimumDuration / 2)
            upper = center.addingTimeInterval(minimumDuration / 2)
        }

        if lower < domain.lowerBound {
            upper = upper.addingTimeInterval(domain.lowerBound.timeIntervalSince(lower))
            lower = domain.lowerBound
        }

        if upper > domain.upperBound {
            lower = lower.addingTimeInterval(domain.upperBound.timeIntervalSince(upper))
            upper = domain.upperBound
        }

        return max(lower, domain.lowerBound)...min(upper, domain.upperBound)
    }

    static func points(
        in range: ClosedRange<Date>,
        from points: [HealthMetricChartPoint]
    ) -> [HealthMetricChartPoint] {
        sorted(points).filter {
            $0.date >= range.lowerBound && $0.date <= range.upperBound
        }
    }

    static func linePoints(
        in range: ClosedRange<Date>,
        from points: [HealthMetricChartPoint]
    ) -> [HealthMetricChartPoint] {
        let sortedPoints = sorted(points)
        let visiblePoints = sortedPoints.filter {
            $0.date >= range.lowerBound && $0.date <= range.upperBound
        }
        let previousPoint = sortedPoints.last { $0.date < range.lowerBound }
        let nextPoint = sortedPoints.first { $0.date > range.upperBound }
        var result: [HealthMetricChartPoint] = []

        if let previousPoint,
           let afterLowerBound = visiblePoints.first ?? nextPoint,
           let boundaryPoint = interpolatedPoint(
            at: range.lowerBound,
            lowerPoint: previousPoint,
            upperPoint: afterLowerBound
           ) {
            result.append(boundaryPoint)
        }

        result.append(contentsOf: visiblePoints)

        if let nextPoint,
           let beforeUpperBound = visiblePoints.last ?? previousPoint,
           let boundaryPoint = interpolatedPoint(
            at: range.upperBound,
            lowerPoint: beforeUpperBound,
            upperPoint: nextPoint
           ) {
            result.append(boundaryPoint)
        }

        return result
    }

    static func focusCandidatePoints(
        in visiblePoints: [HealthMetricChartPoint],
        mode: MetricChartDisplayMode,
        calendar: Calendar
    ) -> [HealthMetricChartPoint] {
        let sortedPoints = sorted(visiblePoints)

        guard !mode.isDaily else {
            return sortedPoints
        }

        return sampledPoints(
            from: sortedPoints,
            daySpacing: mode.markerSpacingDays,
            calendar: calendar
        )
    }

    static func pointMarkPoints(
        in visiblePoints: [HealthMetricChartPoint],
        mode: MetricChartDisplayMode,
        focusedPoint _: HealthMetricChartPoint?,
        calendar: Calendar
    ) -> [HealthMetricChartPoint] {
        let sortedPoints = sorted(visiblePoints)

        guard !mode.isDaily else {
            return sortedPoints
        }

        return sampledPoints(
            from: sortedPoints,
            daySpacing: mode.markerSpacingDays,
            calendar: calendar
        )
    }

    static func fullRange(
        in points: [HealthMetricChartPoint]
    ) -> ClosedRange<Date> {
        let sortedPoints = sorted(points)

        guard let first = sortedPoints.first,
              let last = sortedPoints.last else {
            let now = Date()
            return now.addingTimeInterval(-24 * 60 * 60)...now
        }

        if first.date == last.date {
            return first.date.addingTimeInterval(-24 * 60 * 60)...last.date.addingTimeInterval(24 * 60 * 60)
        }

        return first.date...last.date
    }

    static func isFullRange(
        _ range: ClosedRange<Date>,
        in points: [HealthMetricChartPoint]
    ) -> Bool {
        let domain = fullRange(in: points)
        let tolerance: TimeInterval = 1

        return abs(range.lowerBound.timeIntervalSince(domain.lowerBound)) <= tolerance
            && abs(range.upperBound.timeIntervalSince(domain.upperBound)) <= tolerance
    }

    static func valueDomain(
        for points: [HealthMetricChartPoint]
    ) -> ClosedRange<Double> {
        let values = points.map(\.value)

        guard let minValue = values.min(),
              let maxValue = values.max() else {
            return 0...1
        }

        let span = maxValue - minValue
        let padding = max(span * 0.14, max(abs(maxValue), 1) * 0.035)

        return (minValue - padding)...(maxValue + padding)
    }

    static func nearestPoint(
        to date: Date,
        in points: [HealthMetricChartPoint]
    ) -> HealthMetricChartPoint? {
        points.min {
            abs($0.date.timeIntervalSince(date)) < abs($1.date.timeIntervalSince(date))
        }
    }

    static func canMoveEarlier(
        _ range: ClosedRange<Date>,
        in points: [HealthMetricChartPoint]
    ) -> Bool {
        range.lowerBound > fullRange(in: points).lowerBound
    }

    static func canMoveLater(
        _ range: ClosedRange<Date>,
        in points: [HealthMetricChartPoint]
    ) -> Bool {
        range.upperBound < fullRange(in: points).upperBound
    }

    static func translatedRange(
        _ range: ClosedRange<Date>,
        by seconds: TimeInterval,
        domain: ClosedRange<Date>,
        minimumDays: Int
    ) -> ClosedRange<Date> {
        let rangeDuration = max(range.upperBound.timeIntervalSince(range.lowerBound), 1)
        let domainDuration = max(domain.upperBound.timeIntervalSince(domain.lowerBound), 1)

        guard rangeDuration < domainDuration else {
            return domain
        }

        var lower = range.lowerBound.addingTimeInterval(seconds)
        var upper = lower.addingTimeInterval(rangeDuration)

        if lower < domain.lowerBound {
            lower = domain.lowerBound
            upper = lower.addingTimeInterval(rangeDuration)
        }

        if upper > domain.upperBound {
            upper = domain.upperBound
            lower = upper.addingTimeInterval(-rangeDuration)
        }

        return clampedRange(
            lower...upper,
            to: domain,
            minimumDays: minimumDays
        )
    }

    static func zoomedRange(
        _ range: ClosedRange<Date>,
        magnification: CGFloat,
        center: Date?,
        domain: ClosedRange<Date>,
        minimumDays: Int
    ) -> ClosedRange<Date> {
        let domainDuration = max(domain.upperBound.timeIntervalSince(domain.lowerBound), 1)
        let rangeDuration = max(range.upperBound.timeIntervalSince(range.lowerBound), 1)
        let minimumDuration = TimeInterval(max(1, minimumDays) * 24 * 60 * 60)
        let scale = max(Double(magnification), 0.01)
        let targetDuration = min(
            max(rangeDuration / scale, minimumDuration),
            domainDuration
        )

        guard targetDuration < domainDuration else {
            return domain
        }

        let midpoint = range.lowerBound.addingTimeInterval(rangeDuration / 2)
        let centerDate = min(max(center ?? midpoint, domain.lowerBound), domain.upperBound)
        var lower = centerDate.addingTimeInterval(-targetDuration / 2)
        var upper = centerDate.addingTimeInterval(targetDuration / 2)

        if lower < domain.lowerBound {
            lower = domain.lowerBound
            upper = lower.addingTimeInterval(targetDuration)
        }

        if upper > domain.upperBound {
            upper = domain.upperBound
            lower = upper.addingTimeInterval(-targetDuration)
        }

        return clampedRange(
            lower...upper,
            to: domain,
            minimumDays: minimumDays
        )
    }

    static func progressItems(
        visiblePoints: [HealthMetricChartPoint],
        descriptor: HealthKitMetricDescriptor,
        displayMode: MetricChartDisplayMode,
        calendar: Calendar
    ) -> [MetricChartProgressItem] {
        let sortedPoints = sorted(visiblePoints)

        guard let latest = sortedPoints.last else {
            return unavailableProgressItems(
                displayMode: displayMode,
                caption: "No data in range"
            )
        }

        var items: [MetricChartProgressItem] = []

        if let highPoint = sortedPoints.max(by: { $0.value < $1.value }) {
            items.append(
                MetricChartProgressItem(
                    title: "Since High",
                    value: deltaText(latest.value - highPoint.value, unit: descriptor.normalizedUnit),
                    caption: "\(displayMode.label) • \(shortDate(highPoint.date))"
                )
            )
        }

        if let weekAgo = comparisonPoint(
            before: latest.date,
            days: 7,
            in: sortedPoints,
            calendar: calendar
        ) {
            items.append(
                MetricChartProgressItem(
                    title: "1W",
                    value: deltaText(latest.value - weekAgo.value, unit: descriptor.normalizedUnit),
                    caption: "\(displayMode.label) • \(shortDate(weekAgo.date))"
                )
            )
        } else {
            items.append(
                MetricChartProgressItem(
                    title: "1W",
                    value: "N/A",
                    caption: "\(displayMode.label) • no comparison"
                )
            )
        }

        if let monthAgo = comparisonPoint(
            before: latest.date,
            days: 30,
            in: sortedPoints,
            calendar: calendar
        ) {
            items.append(
                MetricChartProgressItem(
                    title: "1M",
                    value: deltaText(latest.value - monthAgo.value, unit: descriptor.normalizedUnit),
                    caption: "\(displayMode.label) • \(shortDate(monthAgo.date))"
                )
            )
        } else {
            items.append(
                MetricChartProgressItem(
                    title: "1M",
                    value: "N/A",
                    caption: "\(displayMode.label) • no comparison"
                )
            )
        }

        return Array(items.prefix(3))
    }

    private static func unavailableProgressItems(
        displayMode: MetricChartDisplayMode,
        caption: String
    ) -> [MetricChartProgressItem] {
        [
            MetricChartProgressItem(
                title: "Since High",
                value: "N/A",
                caption: "\(displayMode.label) • \(caption)"
            ),
            MetricChartProgressItem(
                title: "1W",
                value: "N/A",
                caption: "\(displayMode.label) • \(caption)"
            ),
            MetricChartProgressItem(
                title: "1M",
                value: "N/A",
                caption: "\(displayMode.label) • \(caption)"
            ),
        ]
    }

    static func rangeText(_ range: ClosedRange<Date>) -> String {
        "\(shortDate(range.lowerBound)) to \(shortDate(range.upperBound))"
    }

    static func axisDateText(_ date: Date) -> String {
        date.formatted(.dateTime.month(.abbreviated).day().year(.twoDigits))
    }

    private static func sorted(
        _ points: [HealthMetricChartPoint]
    ) -> [HealthMetricChartPoint] {
        points.sorted { $0.date < $1.date }
    }

    private static func interpolatedPoint(
        at date: Date,
        lowerPoint: HealthMetricChartPoint,
        upperPoint: HealthMetricChartPoint
    ) -> HealthMetricChartPoint? {
        let duration = upperPoint.date.timeIntervalSince(lowerPoint.date)

        guard duration > 0 else {
            return nil
        }

        let fraction = min(
            max(date.timeIntervalSince(lowerPoint.date) / duration, 0),
            1
        )
        let value = lowerPoint.value + ((upperPoint.value - lowerPoint.value) * fraction)

        return HealthMetricChartPoint(
            date: date,
            value: value,
            unit: lowerPoint.unit
        )
    }

    private static func sampledPoints(
        from sortedPoints: [HealthMetricChartPoint],
        daySpacing: Int,
        calendar: Calendar
    ) -> [HealthMetricChartPoint] {
        guard daySpacing > 1 else {
            return sortedPoints
        }

        guard let latestPoint = sortedPoints.last else {
            return []
        }

        let latestDay = calendar.startOfDay(for: latestPoint.date)

        return sortedPoints.filter { point in
            let pointDay = calendar.startOfDay(for: point.date)
            let daysFromLatest = calendar.dateComponents(
                [.day],
                from: pointDay,
                to: latestDay
            ).day ?? 0

            return daysFromLatest % daySpacing == 0
        }
    }

    private static func comparisonPoint(
        before date: Date,
        days: Int,
        in points: [HealthMetricChartPoint],
        calendar: Calendar
    ) -> HealthMetricChartPoint? {
        guard let target = calendar.date(
            byAdding: .day,
            value: -days,
            to: date
        ) else {
            return nil
        }

        guard let point = nearestPoint(to: target, in: points),
              abs(point.date.timeIntervalSince(date)) > 18 * 60 * 60 else {
            return nil
        }

        return point
    }

    private static func deltaText(_ value: Double, unit: String) -> String {
        if abs(value) < 0.05 {
            return deltaValueText(0, unit: unit)
        }

        let sign = value > 0 ? "+" : "-"

        return "\(sign)\(deltaValueText(abs(value), unit: unit))"
    }

    static func valueText(_ value: Double, unit: String) -> String {
        switch unit {
        case "minute":
            return durationText(minutes: value)
        default:
            return "\(formatValue(value)) \(unit)"
        }
    }

    static func rangeValueText(min: Double, max: Double, unit: String) -> String {
        "\(valueText(min, unit: unit)) - \(valueText(max, unit: unit))"
    }

    private static func deltaValueText(_ value: Double, unit: String) -> String {
        switch unit {
        case "minute":
            return compactDurationDeltaText(minutes: value)
        default:
            return "\(formatValue(value)) \(unit)"
        }
    }

    private static func durationText(minutes value: Double) -> String {
        let totalMinutes = max(0, Int(value.rounded()))
        let hours = totalMinutes / 60
        let minutes = totalMinutes % 60

        if hours == 0 {
            return "\(minutes)m"
        }

        if minutes == 0 {
            return "\(hours)h"
        }

        return "\(hours)h \(minutes)m"
    }

    private static func compactDurationDeltaText(minutes value: Double) -> String {
        let totalMinutes = max(0, Int(value.rounded()))

        guard totalMinutes >= 60 else {
            return "\(totalMinutes)m"
        }

        return durationText(minutes: Double(totalMinutes))
    }

    private static func shortDate(_ date: Date) -> String {
        date.formatted(.dateTime.month(.abbreviated).day().year(.twoDigits))
    }
}

private struct MetricHistoryTableCard: View {
    let points: [HealthMetricChartPoint]
    let descriptor: HealthKitMetricDescriptor
    @State private var page = 0

    private let pageSize = 24

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: "History", trailing: pageRangeText)

                VStack(spacing: 0) {
                    ForEach(pagePoints) { point in
                        MetricHistoryRow(point: point, descriptor: descriptor)

                        if point.id != pagePoints.last?.id {
                            Divider().overlay(FitnessTheme.cardStroke)
                        }
                    }
                }
                .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(FitnessTheme.cardStroke, lineWidth: 1)
                )

                HStack(spacing: 10) {
                    Button {
                        page = max(page - 1, 0)
                    } label: {
                        Label("Newer", systemImage: "chevron.up")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .frame(maxWidth: .infinity)
                            .frame(height: 38)
                    }
                    .buttonStyle(MetricChartIconButtonStyle())
                    .disabled(page == 0)
                    .accessibilityIdentifier("metricHistoryNewer")

                    Button {
                        page = min(page + 1, maxPage)
                    } label: {
                        Label("Older", systemImage: "chevron.down")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .frame(maxWidth: .infinity)
                            .frame(height: 38)
                    }
                    .buttonStyle(MetricChartIconButtonStyle())
                    .disabled(page >= maxPage)
                    .accessibilityIdentifier("metricHistoryOlder")
                }
            }
        }
        .onChange(of: points) { _, _ in
            page = min(page, maxPage)
        }
    }

    private var sortedPoints: [HealthMetricChartPoint] {
        points.sorted { $0.date > $1.date }
    }

    private var pagePoints: [HealthMetricChartPoint] {
        let start = min(page * pageSize, sortedPoints.count)
        let end = min(start + pageSize, sortedPoints.count)

        guard start < end else {
            return []
        }

        return Array(sortedPoints[start..<end])
    }

    private var maxPage: Int {
        max(0, Int(ceil(Double(sortedPoints.count) / Double(pageSize))) - 1)
    }

    private var pageRangeText: String {
        guard !sortedPoints.isEmpty else {
            return "No data"
        }

        let start = min(page * pageSize, sortedPoints.count - 1) + 1
        let end = min(start + pageSize - 1, sortedPoints.count)

        return "\(start)-\(end) of \(sortedPoints.count)"
    }
}

private struct MetricHistoryRow: View {
    let point: HealthMetricChartPoint
    let descriptor: HealthKitMetricDescriptor

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(point.date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).year()))
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(FitnessTheme.secondaryText)
                .lineLimit(1)
                .minimumScaleFactor(0.72)

            Spacer(minLength: 8)

            Text(MetricChartAnalysis.valueText(point.value, unit: descriptor.normalizedUnit))
                .font(.system(size: 13, weight: .bold, design: .monospaced))
                .foregroundStyle(.white)
                .multilineTextAlignment(.trailing)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }
}

private struct LastSyncResultView: View {
    let result: HealthKitSyncResult
    let onSignIn: () -> Void

    var body: some View {
        switch result {
        case .completed(let metrics, let upload):
            SummaryRow(title: "Status", value: "Synced")
                .accessibilityIdentifier("lastSyncStatus")
            SummaryRow(title: "Data updated", value: upload.displayText)
            .accessibilityIdentifier("lastSyncSamples")

            let metricRows = Self.metricRows(metrics)

            if !metricRows.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Metrics")
                        .sectionLabel()
                    Text(metricRows.joined(separator: "\n"))
                        .font(.system(size: 12))
                        .foregroundStyle(FitnessTheme.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 4)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("lastSyncMetrics")
            }
        case .healthDataUnavailable:
            Text("Health data is unavailable on this device.")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(FitnessTheme.secondaryText)
                .accessibilityIdentifier("lastSyncUnavailable")
        case .alreadyRunning:
            HStack(spacing: 10) {
                ProgressView()
                    .controlSize(.small)
                    .tint(FitnessTheme.lime)
                Text("A HealthKit sync is already running.")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityIdentifier("lastSyncAlreadyRunning")
        case .failed(let message):
            VStack(alignment: .leading, spacing: 10) {
                Text("Sync failed: \(message)")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(FitnessTheme.error)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("lastSyncFailure")

                if result.requiresGoogleSignIn {
                    Button(action: onSignIn) {
                        ActionButtonLabel(
                            title: "Sign In with Google",
                            systemImage: "person.crop.circle.badge.checkmark"
                        )
                    }
                    .buttonStyle(PrimaryActionButtonStyle())
                }
            }
        }
    }

    private static func metricRows(_ metrics: [HealthKitMetricSyncSummary]) -> [String] {
        metrics
            .filter { $0.samples > 0 }
            .map {
                "\($0.displayMetricName): \(formatCount($0.samples)) daily rows"
            }
    }

    private static func formatCount(_ value: Int) -> String {
        value.formatted(.number)
    }
}

private struct SyncProgressRow: View {
    let progress: HealthKitSyncProgress

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                ProgressView()
                    .controlSize(.small)
                    .tint(FitnessTheme.lime)
                Text(progress.detailText)
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let secondaryText = progress.secondaryText {
                Text(secondaryText)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let fractionCompleted = progress.fractionCompleted {
                ProgressView(value: fractionCompleted)
                    .tint(FitnessTheme.lime)
                    .accessibilityHidden(true)
            }

            if let etaText = progress.etaText {
                Text(etaText)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(FitnessTheme.secondaryText)
            }
        }
        .padding(12)
        .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("healthSyncProgress")
        .accessibilityLabel("Health sync progress")
        .accessibilityValue(progress.accessibilityText)
    }
}

private struct SectionHeader: View {
    let title: String
    let trailing: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .sectionLabel()
            Spacer(minLength: 10)
            Text(trailing)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(FitnessTheme.secondaryText)
                .multilineTextAlignment(.trailing)
        }
    }
}

private struct SummaryRow: View {
    let title: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(FitnessTheme.secondaryText)
            Spacer(minLength: 10)
            Text(value)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
                .multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct SourceDetailRow: View {
    let title: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(FitnessTheme.secondaryText)
            Spacer(minLength: 10)
            Text(value)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
                .multilineTextAlignment(.trailing)
                .lineLimit(2)
                .minimumScaleFactor(0.74)
        }
    }
}

private struct SettingsToggleRow: View {
    let title: String
    let subtitle: String
    @Binding var isOn: Bool

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                Text(subtitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(FitnessTheme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .toggleStyle(.switch)
        .tint(FitnessTheme.lime)
        .accessibilityElement(children: .combine)
    }
}

private struct IconBadge: View {
    let systemImage: String
    let color: Color
    var size: CGFloat = 46

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(color)
            .frame(width: size, height: size)
            .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(color.opacity(0.22), lineWidth: 1)
            )
    }
}

private struct StatusPulse: View {
    let isActive: Bool

    var body: some View {
        Circle()
            .fill(isActive ? FitnessTheme.lime : FitnessTheme.secondaryText)
            .frame(width: 11, height: 11)
            .shadow(color: isActive ? FitnessTheme.lime.opacity(0.75) : .clear, radius: 8)
            .padding(.top, 9)
    }
}

private struct ActionButtonLabel: View {
    let title: String
    let systemImage: String

    var body: some View {
        Label(title.uppercased(), systemImage: systemImage)
            .font(.system(size: 12, weight: .bold, design: .monospaced))
            .labelStyle(.titleAndIcon)
            .frame(maxWidth: .infinity)
            .frame(height: 46)
    }
}

private struct GlassCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(16)
            .background(FitnessTheme.cardFill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(FitnessTheme.cardStroke, lineWidth: 1)
            )
    }
}

private struct PrimaryActionButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(isEnabled ? FitnessTheme.actionText : FitnessTheme.secondaryText)
            .background(
                isEnabled ? FitnessTheme.lime : FitnessTheme.rowFill,
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .opacity(configuration.isPressed ? 0.82 : 1)
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
    }
}

private struct SecondaryActionButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(isEnabled ? FitnessTheme.lime : FitnessTheme.secondaryText)
            .background(FitnessTheme.rowFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(
                        isEnabled ? FitnessTheme.lime.opacity(0.35) : FitnessTheme.cardStroke,
                        lineWidth: 1
                    )
            )
            .opacity(configuration.isPressed ? 0.82 : 1)
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
    }
}

private extension Text {
    func sectionLabel() -> some View {
        font(.system(size: 11, weight: .semibold, design: .monospaced))
            .foregroundStyle(FitnessTheme.secondaryText)
            .textCase(.uppercase)
    }
}

private extension HealthKitAuthorizationSummary {
    var isReady: Bool {
        switch self {
        case .requested:
            return true
        case .unavailable, .notRequested, .failed:
            return false
        }
    }

    var shortStatus: String {
        switch self {
        case .requested:
            return "Requested"
        case .notRequested:
            return "Not requested"
        case .unavailable:
            return "Unavailable"
        case .failed:
            return "Failed"
        }
    }

    var shouldShowReadAccessButton: Bool {
        switch self {
        case .notRequested, .failed:
            return true
        case .requested, .unavailable:
            return false
        }
    }

    var readAccessButtonTitle: String {
        switch self {
        case .failed:
            return "Retry Read Access"
        case .notRequested, .requested, .unavailable:
            return "Request Read Access"
        }
    }

    var settingsText: String {
        switch self {
        case .requested:
            return "Read access was requested. Apple keeps per-metric grant details inside the Health app."
        case .notRequested:
            return "Fitness Coach needs read access before it can sync or chart HealthKit metrics."
        case .unavailable:
            return "Apple Health is unavailable on this device."
        case .failed(let message):
            return "The last permission request failed: \(message)"
        }
    }
}

private extension HealthKitSyncResult {
    var shortStatus: String {
        switch self {
        case .completed:
            return "Synced"
        case .healthDataUnavailable:
            return "Unavailable"
        case .alreadyRunning:
            return "Running"
        case .failed:
            return "Failed"
        }
    }

    var compactSummary: String {
        switch self {
        case .completed(_, let upload):
            return upload.compactSummaryText
        case .healthDataUnavailable:
            return "Health data is unavailable on this device."
        case .alreadyRunning:
            return "A HealthKit sync is already running."
        case .failed(let message):
            return "Sync failed: \(message)"
        }
    }
}

private extension HealthKitMetricSyncSummary {
    var displayMetricName: String {
        metricName.replacingOccurrences(of: "_", with: " ")
    }
}

private extension HealthKitMetricDescriptor {
    var dashboardTitle: String {
        switch metricName {
        case "active_energy":
            return "Active"
        case "resting_energy":
            return "Resting"
        case "heart_rate":
            return "Heart"
        case "resting_heart_rate":
            return "Rest HR"
        case "walking_heart_rate":
            return "Walk HR"
        case "dietary_energy":
            return "Calories"
        case "protein":
            return "Protein"
        case "carbs":
            return "Carbs"
        case "fat":
            return "Fat"
        case "fiber":
            return "Fiber"
        default:
            return displayName
        }
    }

    var displayName: String {
        switch metricName {
        case "dietary_energy":
            return "Calories"
        case "carbs":
            return "Carbs"
        case "fat":
            return "Fat"
        case "fiber":
            return "Fiber"
        case "protein":
            return "Protein"
        default:
            break
        }

        return metricName
            .split(separator: "_")
            .map { $0.capitalized }
            .joined(separator: " ")
    }

    var systemImage: String {
        switch metricName {
        case "weight":
            return "scalemass"
        case "steps":
            return "figure.walk"
        case "active_energy":
            return "flame.fill"
        case "resting_energy":
            return "battery.100"
        case "sleep":
            return "bed.double.fill"
        case "heart_rate":
            return "waveform.path.ecg"
        case "resting_heart_rate":
            return "heart.fill"
        case "walking_heart_rate":
            return "figure.walk.motion"
        case "dietary_energy":
            return "fork.knife"
        case "protein":
            return "fish"
        case "carbs":
            return "takeoutbag.and.cup.and.straw"
        case "fat":
            return "drop.fill"
        case "fiber":
            return "leaf.fill"
        default:
            return "circle.grid.2x2"
        }
    }

    var accentColor: Color {
        switch metricName {
        case "active_energy", "heart_rate", "resting_heart_rate", "dietary_energy":
            return FitnessTheme.orange
        case "sleep", "carbs":
            return FitnessTheme.cyan
        case "fat":
            return FitnessTheme.violet
        default:
            return FitnessTheme.lime
        }
    }

    var accentColorName: HealthDashboardMetric.AccentColorName {
        switch metricName {
        case "active_energy", "heart_rate", "resting_heart_rate", "dietary_energy":
            return .orange
        case "sleep", "carbs":
            return .cyan
        case "fat":
            return .violet
        default:
            return .lime
        }
    }
}

private extension HealthMetricUploadResult {
    var displayText: String {
        switch self {
        case .skippedEmptyBatch:
            return "No new data"
        case .skippedLiveHealthDataDisabled:
            return "Sync did not finish"
        case .skippedMissingBackendURL:
            return "Sign in required"
        case .skippedMissingAuthToken:
            return "Sign in required"
        case .skippedNonDisposableBackend:
            return "Sync blocked"
        case .uploaded(let count):
            return "\(count.formatted(.number)) daily rows"
        }
    }

    var compactSummaryText: String {
        switch self {
        case .skippedEmptyBatch:
            return "Sync complete. No new data."
        case .uploaded(let count):
            return "\(count.formatted(.number)) daily rows synced."
        case .skippedLiveHealthDataDisabled,
             .skippedMissingBackendURL,
             .skippedMissingAuthToken,
             .skippedNonDisposableBackend:
            return "Sync did not finish."
        }
    }
}

private func formatValue(_ value: Double) -> String {
    value.formatted(
        .number
            .precision(.fractionLength(0...1))
    )
}

private func wholeNumber(_ value: Double) -> String {
    value.rounded().formatted(.number.precision(.fractionLength(0)))
}

private func formatPortion(_ value: Double) -> String {
    if value.rounded() == value {
        return wholeNumber(value)
    }

    return value.formatted(
        .number
            .precision(.fractionLength(0...2))
            .grouping(.never)
    )
}

private func mealMacroSummary(_ totals: MacroTotals, dayTotals: MacroTotals) -> String {
    [
        "\(percentText(totals.calories, of: dayTotals.calories)) day kcal",
        "P \(wholeNumber(totals.proteinGrams))g \(percentText(totals.proteinGrams, of: dayTotals.proteinGrams))",
        "C \(wholeNumber(totals.carbsGrams))g \(percentText(totals.carbsGrams, of: dayTotals.carbsGrams))",
        "F \(wholeNumber(totals.fatGrams))g \(percentText(totals.fatGrams, of: dayTotals.fatGrams))",
        "Fiber \(wholeNumber(totals.fiberGrams))g"
    ].joined(separator: " · ")
}

private func ingredientMacroSummary(_ totals: MacroTotals, dayTotals: MacroTotals) -> String {
    [
        "\(wholeNumber(totals.calories)) kcal \(percentText(totals.calories, of: dayTotals.calories))",
        "P \(wholeNumber(totals.proteinGrams))g \(percentText(totals.proteinGrams, of: dayTotals.proteinGrams))",
        "C \(wholeNumber(totals.carbsGrams))g \(percentText(totals.carbsGrams, of: dayTotals.carbsGrams))",
        "F \(wholeNumber(totals.fatGrams))g \(percentText(totals.fatGrams, of: dayTotals.fatGrams))",
        "Fiber \(wholeNumber(totals.fiberGrams))g"
    ].joined(separator: " · ")
}

private func percentText(_ value: Double, of total: Double) -> String {
    guard total > 0 else {
        return "0%"
    }

    return "\(wholeNumber(value / total * 100))%"
}

private func formattedDate(_ date: Date) -> String {
    date.formatted(
        .dateTime
            .weekday(.abbreviated)
            .day()
            .month(.abbreviated)
            .year()
    )
}

private func nutritionDayLabel(_ date: Date, now: Date = Date()) -> String {
    let calendar = Calendar.current

    if calendar.isDate(date, inSameDayAs: now) {
        return "Today"
    }

    if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
       calendar.isDate(date, inSameDayAs: yesterday) {
        return "Yesterday"
    }

    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "d MMM yy EEE"

    return formatter.string(from: date)
}

private func nutritionMealTimestamp(_ date: Date, now: Date = Date()) -> String {
    "\(nutritionDayLabel(date, now: now)) · \(date.formatted(.dateTime.hour().minute()))"
}

private enum FitnessTheme {
    static let background = Color(red: 0.075, green: 0.075, blue: 0.075)
    static let cardFill = Color.white.opacity(0.065)
    static let rowFill = Color.white.opacity(0.045)
    static let cardStroke = Color.white.opacity(0.10)
    static let secondaryText = Color(red: 0.77, green: 0.79, blue: 0.67)
    static let lime = Color(red: 0.76, green: 0.96, blue: 0.0)
    static let orange = Color(red: 1.0, green: 0.36, blue: 0.02)
    static let cyan = Color(red: 0.49, green: 0.96, blue: 1.0)
    static let violet = Color(red: 0.68, green: 0.54, blue: 1.0)
    static let error = Color(red: 1.0, green: 0.45, blue: 0.40)
    static let actionText = Color(red: 0.09, green: 0.13, blue: 0.0)
}
