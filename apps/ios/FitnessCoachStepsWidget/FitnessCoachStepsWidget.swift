import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

enum FitnessWidgetMetricSetOption: String, AppEnum {
    case all
    case activity
    case heart
    case nutrition
    case body

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Metric Set")
    static let caseDisplayRepresentations: [FitnessWidgetMetricSetOption: DisplayRepresentation] = [
        .all: "All Metrics",
        .activity: "Activity",
        .heart: "Heart",
        .nutrition: "Nutrition",
        .body: "Body",
    ]

    var metricNames: Set<String> {
        switch self {
        case .all:
            return []
        case .activity:
            return ["steps", "active_energy", "resting_energy"]
        case .heart:
            return ["heart_rate", "resting_heart_rate", "walking_heart_rate"]
        case .nutrition:
            return ["dietary_energy", "protein", "carbs", "fat", "fiber"]
        case .body:
            return ["weight", "sleep"]
        }
    }

    var headerText: String {
        switch self {
        case .all:
            return "All"
        case .activity:
            return "Activity"
        case .heart:
            return "Heart"
        case .nutrition:
            return "Nutrition"
        case .body:
            return "Body"
        }
    }
}

enum FitnessWidgetFeaturedMetricOption: String, AppEnum {
    case steps
    case weight
    case activeEnergy = "active_energy"
    case restingEnergy = "resting_energy"
    case sleep
    case heartRate = "heart_rate"
    case restingHeartRate = "resting_heart_rate"
    case walkingHeartRate = "walking_heart_rate"
    case dietaryEnergy = "dietary_energy"
    case protein
    case carbs
    case fat
    case fiber

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Featured Metric")
    static let caseDisplayRepresentations: [FitnessWidgetFeaturedMetricOption: DisplayRepresentation] = [
        .steps: "Steps",
        .weight: "Weight",
        .activeEnergy: "Active Energy",
        .restingEnergy: "Resting Energy",
        .sleep: "Sleep",
        .heartRate: "Heart Rate",
        .restingHeartRate: "Resting Heart Rate",
        .walkingHeartRate: "Walking Heart Rate",
        .dietaryEnergy: "Calories",
        .protein: "Protein",
        .carbs: "Carbs",
        .fat: "Fat",
        .fiber: "Fiber",
    ]

    var metricName: String {
        rawValue
    }
}

enum FitnessWidgetLayoutOption: String, AppEnum {
    case balanced
    case compactAll

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Layout")
    static let caseDisplayRepresentations: [FitnessWidgetLayoutOption: DisplayRepresentation] = [
        .balanced: "Balanced",
        .compactAll: "Compact",
    ]
}

struct FitnessCoachWidgetConfigurationIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Fitness Coach Widget"
    static let description = IntentDescription("Choose the widget metric set, featured metric, and density.")

    @Parameter(title: "Metric Set")
    var metricSet: FitnessWidgetMetricSetOption

    @Parameter(title: "Featured Metric")
    var featuredMetric: FitnessWidgetFeaturedMetricOption

    @Parameter(title: "Layout")
    var layout: FitnessWidgetLayoutOption

    init() {
        metricSet = .all
        featuredMetric = .steps
        layout = .balanced
    }

    init(
        metricSet: FitnessWidgetMetricSetOption = .all,
        featuredMetric: FitnessWidgetFeaturedMetricOption = .steps,
        layout: FitnessWidgetLayoutOption = .balanced
    ) {
        self.metricSet = metricSet
        self.featuredMetric = featuredMetric
        self.layout = layout
    }
}

struct FitnessCoachStepsEntry: TimelineEntry {
    let date: Date
    let stepSnapshot: StepSnapshot
    let dashboardSnapshot: HealthDashboardSnapshot
    let nutritionSnapshot: NutritionCoachSnapshot
    let configuration: FitnessCoachWidgetConfigurationIntent
}

struct FitnessCoachStepsProvider: AppIntentTimelineProvider {
    func placeholder(in _: Context) -> FitnessCoachStepsEntry {
        FitnessCoachStepsEntry(
            date: Date(),
            stepSnapshot: .placeholder,
            dashboardSnapshot: .placeholder,
            nutritionSnapshot: .placeholder,
            configuration: FitnessCoachWidgetConfigurationIntent()
        )
    }

    func snapshot(
        for configuration: FitnessCoachWidgetConfigurationIntent,
        in context: Context
    ) async -> FitnessCoachStepsEntry {
        entry(isPreview: context.isPreview, configuration: configuration)
    }

    func timeline(
        for configuration: FitnessCoachWidgetConfigurationIntent,
        in _: Context
    ) async -> Timeline<FitnessCoachStepsEntry> {
        let entry = entry(isPreview: false, configuration: configuration)
        let nextRefresh = Calendar.current.date(
            byAdding: .minute,
            value: 20,
            to: Date()
        ) ?? Date().addingTimeInterval(20 * 60)

        return Timeline(entries: [entry], policy: .after(nextRefresh))
    }

    private func entry(
        isPreview: Bool,
        configuration: FitnessCoachWidgetConfigurationIntent
    ) -> FitnessCoachStepsEntry {
        let stepSnapshot = isPreview
            ? StepSnapshot.placeholder
            : StepSnapshotStore.load() ?? .permissionNeeded()
        let dashboardSnapshot = isPreview
            ? HealthDashboardSnapshot.placeholder
            : HealthDashboardSnapshotStore.load() ?? dashboardSnapshotFallback(from: stepSnapshot)
        let nutritionSnapshot = isPreview
            ? NutritionCoachSnapshot.placeholder
            : NutritionCoachSnapshotStore.load() ?? NutritionCoachSnapshot.placeholder

        return FitnessCoachStepsEntry(
            date: Date(),
            stepSnapshot: stepSnapshot,
            dashboardSnapshot: dashboardSnapshot,
            nutritionSnapshot: nutritionSnapshot,
            configuration: configuration
        )
    }

    private func dashboardSnapshotFallback(
        from stepSnapshot: StepSnapshot
    ) -> HealthDashboardSnapshot {
        let state: HealthDashboardSnapshot.State
        switch stepSnapshot.state {
        case .ready:
            state = .ready
        case .noData:
            state = .noData
        case .permissionNeeded:
            state = .permissionNeeded
        case .failed:
            state = .failed
        }

        return HealthDashboardSnapshot.ready(
            metrics: [Self.metric(from: stepSnapshot, sortOrder: 1)],
            now: stepSnapshot.updatedAt
        ).withState(state, message: stepSnapshot.message)
    }

    private static func metric(
        from snapshot: StepSnapshot,
        sortOrder: Int
    ) -> HealthDashboardMetric {
        HealthDashboardMetric(
            metricName: "steps",
            title: "Steps",
            valueText: snapshot.valueText,
            caption: snapshot.captionText,
            detailText: snapshot.detailText,
            systemImage: "figure.walk",
            accentColorName: .lime,
            sortOrder: sortOrder
        )
    }
}

private extension HealthDashboardSnapshot {
    func withState(
        _ state: HealthDashboardSnapshot.State,
        message: String?
    ) -> HealthDashboardSnapshot {
        HealthDashboardSnapshot(
            state: state,
            metrics: metrics,
            localDate: localDate,
            timezoneIdentifier: timezoneIdentifier,
            updatedAt: updatedAt,
            message: message
        )
    }
}

struct FitnessCoachStepsWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FitnessCoachStepsEntry

    var body: some View {
        switch family {
        case .systemSmall:
            smallView
                .widgetURL(primaryURL)
        case .systemMedium:
            dashboardView(preset: .medium)
                .widgetURL(primaryURL)
        case .systemLarge:
            dashboardView(preset: .large)
                .widgetURL(primaryURL)
        case .systemExtraLarge:
            dashboardView(preset: .extraLarge)
                .widgetURL(primaryURL)
        case .accessoryCircular:
            circularAccessory
                .widgetURL(primaryURL)
        case .accessoryRectangular:
            rectangularAccessory
                .widgetURL(primaryURL)
        case .accessoryInline:
            inlineAccessory
                .widgetURL(primaryURL)
        @unknown default:
            smallView
                .widgetURL(primaryURL)
        }
    }

    private var allMetrics: [HealthDashboardMetric] {
        if entry.dashboardSnapshot.metrics.isEmpty {
            return [Self.metric(from: entry.stepSnapshot, sortOrder: 1)]
        }

        return entry.dashboardSnapshot.metrics
    }

    private var metrics: [HealthDashboardMetric] {
        let metricSetNames = entry.configuration.metricSet.metricNames
        var selectedMetrics = entry.configuration.metricSet == .all
            ? allMetrics
            : allMetrics.filter { metricSetNames.contains($0.metricName) }

        if let featuredMetric = allMetrics.first(where: {
            $0.metricName == entry.configuration.featuredMetric.metricName
        }) {
            selectedMetrics.removeAll { $0.metricName == featuredMetric.metricName }
            selectedMetrics.insert(featuredMetric, at: 0)
        }

        return selectedMetrics.isEmpty ? allMetrics : selectedMetrics
    }

    private var primaryMetric: HealthDashboardMetric {
        allMetrics.first {
            $0.metricName == entry.configuration.featuredMetric.metricName
        } ?? entry.dashboardSnapshot.primaryMetric ?? metrics[0]
    }

    private var primaryMetricURL: URL? {
        FitnessCoachDeepLink.metricURL(metricName: primaryMetric.metricName)
    }

    private var primaryURL: URL? {
        entry.configuration.metricSet == .nutrition
            ? entry.nutritionSnapshot.quickActionURL
            : primaryMetricURL
    }

    @ViewBuilder
    private var smallView: some View {
        if entry.configuration.metricSet == .nutrition {
            nutritionSmallView
        } else {
            metricSmallView
        }
    }

    private var metricSmallView: some View {
        VStack(alignment: .leading, spacing: 7) {
            WidgetMetricIcon(metric: primaryMetric, size: 34, cornerRadius: 999)

            Spacer(minLength: 0)

            Text(primaryMetric.valueText)
                .font(.system(size: 38, weight: .black, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.45)

            VStack(alignment: .leading, spacing: 4) {
                Text(primaryMetric.title)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(WidgetTheme.color(for: primaryMetric.accentColorName))
                    .lineLimit(1)

                Text(primaryMetric.detailText ?? primaryMetric.caption)
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(WidgetTheme.secondaryText)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(13)
        .widgetBackground()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(primaryMetric.accessibilityText)
    }

    private var nutritionSmallView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "fork.knife.circle.fill")
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(WidgetTheme.lime)
                Spacer()
                Text(entry.nutritionSnapshot.hungerText)
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(WidgetTheme.secondaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
            }

            Text(entry.nutritionSnapshot.calorieText)
                .font(.system(size: 22, weight: .black, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.52)

            Text(entry.nutritionSnapshot.proteinText)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(WidgetTheme.lime)
                .lineLimit(1)

            Text(entry.nutritionSnapshot.nextMealText)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(WidgetTheme.secondaryText)
                .lineLimit(2)
                .minimumScaleFactor(0.72)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(13)
        .widgetBackground()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Nutrition, \(entry.nutritionSnapshot.calorieText), \(entry.nutritionSnapshot.proteinText), \(entry.nutritionSnapshot.nextMealText), \(entry.nutritionSnapshot.hungerText)")
    }

    private func dashboardView(
        preset: WidgetDashboardPreset
    ) -> some View {
        let style = WidgetDashboardStyle(preset: preset, layout: entry.configuration.layout)
        let tileStyle = WidgetMetricTileStyle(preset: preset, layout: entry.configuration.layout)

        return VStack(alignment: .leading, spacing: style.outerSpacing) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Fitness Coach")
                        .font(.system(size: style.titleSize, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                    Text("\(entry.configuration.metricSet.headerText) • \(entry.dashboardSnapshot.statusText)")
                        .font(.system(size: style.statusSize, weight: .semibold, design: .monospaced))
                        .foregroundStyle(WidgetTheme.secondaryText)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                WidgetMetricIcon(metric: primaryMetric, size: style.iconSize, cornerRadius: 8)
            }

            if entry.configuration.metricSet == .nutrition {
                NutritionWidgetStrip(snapshot: entry.nutritionSnapshot)
            }

            LazyVGrid(
                columns: Array(
                    repeating: GridItem(.flexible(minimum: 0), spacing: style.gridSpacing),
                    count: style.columns
                ),
                alignment: .leading,
                spacing: style.gridSpacing
            ) {
                ForEach(metrics.prefix(style.limit)) { metric in
                    metricTileLink(metric: metric, style: tileStyle)
                }
            }
        }
        .padding(.horizontal, style.horizontalPadding)
        .padding(.vertical, style.verticalPadding)
        .widgetBackground()
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func metricTileLink(
        metric: HealthDashboardMetric,
        style: WidgetMetricTileStyle
    ) -> some View {
        if let url = FitnessCoachDeepLink.metricURL(metricName: metric.metricName) {
            Link(destination: url) {
                WidgetMetricTile(metric: metric, style: style)
            }
            .buttonStyle(.plain)
        } else {
            WidgetMetricTile(metric: metric, style: style)
        }
    }

    private var circularAccessory: some View {
        VStack(spacing: 2) {
            Image(systemName: primaryMetric.systemImage)
                .font(.system(size: 13, weight: .bold))
            Text(accessoryValue(primaryMetric.valueText))
                .font(.system(size: 13, weight: .black, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.62)
            Text(primaryMetric.title)
                .font(.system(size: 8, weight: .semibold))
                .lineLimit(1)
        }
        .foregroundStyle(.white)
        .widgetAccentable()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(primaryMetric.accessibilityText)
    }

    private var rectangularAccessory: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(primaryMetric.title, systemImage: primaryMetric.systemImage)
                .font(.system(size: 11, weight: .semibold))
                .lineLimit(1)
            Text(primaryMetric.valueText)
                .font(.system(size: 17, weight: .black, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(entry.dashboardSnapshot.statusText)
                .font(.system(size: 9, weight: .medium))
                .lineLimit(1)
        }
        .widgetAccentable()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(primaryMetric.accessibilityText)
    }

    private var inlineAccessory: some View {
        Text("\(primaryMetric.title) \(primaryMetric.valueText)")
    }

    private func accessoryValue(_ value: String) -> String {
        value
            .replacingOccurrences(of: " steps", with: "")
            .replacingOccurrences(of: " kcal", with: "")
            .replacingOccurrences(of: " bpm", with: "")
            .replacingOccurrences(of: " kg", with: "")
    }

    private static func metric(
        from snapshot: StepSnapshot,
        sortOrder: Int
    ) -> HealthDashboardMetric {
        HealthDashboardMetric(
            metricName: "steps",
            title: "Steps",
            valueText: snapshot.valueText,
            caption: snapshot.captionText,
            detailText: snapshot.detailText,
            systemImage: "figure.walk",
            accentColorName: .lime,
            sortOrder: sortOrder
        )
    }
}

private enum WidgetDashboardPreset {
    case medium
    case large
    case extraLarge
}

private struct WidgetDashboardStyle {
    let limit: Int
    let columns: Int
    let horizontalPadding: CGFloat
    let verticalPadding: CGFloat
    let outerSpacing: CGFloat
    let gridSpacing: CGFloat
    let titleSize: CGFloat
    let statusSize: CGFloat
    let iconSize: CGFloat

    init(preset: WidgetDashboardPreset, layout: FitnessWidgetLayoutOption) {
        let isCompact = layout == .compactAll

        switch (preset, isCompact) {
        case (.medium, false):
            limit = 4
            columns = 2
            horizontalPadding = 8
            verticalPadding = 14
            outerSpacing = 5
            gridSpacing = 5
            titleSize = 12
            statusSize = 9
            iconSize = 22
        case (.medium, true):
            limit = 6
            columns = 3
            horizontalPadding = 6
            verticalPadding = 13
            outerSpacing = 4
            gridSpacing = 4
            titleSize = 11
            statusSize = 8
            iconSize = 20
        case (.large, false):
            limit = 8
            columns = 2
            horizontalPadding = 14
            verticalPadding = 14
            outerSpacing = 9
            gridSpacing = 7
            titleSize = 13
            statusSize = 10
            iconSize = 28
        case (.large, true):
            limit = 13
            columns = 4
            horizontalPadding = 12
            verticalPadding = 12
            outerSpacing = 7
            gridSpacing = 5
            titleSize = 12
            statusSize = 9
            iconSize = 24
        case (.extraLarge, false):
            limit = 12
            columns = 4
            horizontalPadding = 16
            verticalPadding = 16
            outerSpacing = 9
            gridSpacing = 7
            titleSize = 13
            statusSize = 10
            iconSize = 28
        case (.extraLarge, true):
            limit = 13
            columns = 4
            horizontalPadding = 14
            verticalPadding = 14
            outerSpacing = 7
            gridSpacing = 6
            titleSize = 12
            statusSize = 9
            iconSize = 24
        }
    }
}

private struct WidgetMetricTileStyle {
    let titleSize: CGFloat
    let valueSize: CGFloat
    let detailSize: CGFloat
    let iconSize: CGFloat
    let padding: CGFloat
    let minHeight: CGFloat
    let verticalSpacing: CGFloat
    let detailLineLimit: Int

    init(preset: WidgetDashboardPreset, layout: FitnessWidgetLayoutOption) {
        let isCompact = layout == .compactAll

        switch (preset, isCompact) {
        case (.medium, false):
            titleSize = 9
            valueSize = 14
            detailSize = 8
            iconSize = 13
            padding = 6
            minHeight = 44
            verticalSpacing = 3
            detailLineLimit = 1
        case (.medium, true):
            titleSize = 8.5
            valueSize = 13
            detailSize = 7.5
            iconSize = 12
            padding = 5
            minHeight = 38
            verticalSpacing = 3
            detailLineLimit = 1
        case (.large, false):
            titleSize = 10.5
            valueSize = 17
            detailSize = 9.5
            iconSize = 15
            padding = 8
            minHeight = 62
            verticalSpacing = 4
            detailLineLimit = 2
        case (.large, true):
            titleSize = 8.5
            valueSize = 13
            detailSize = 7.5
            iconSize = 12
            padding = 6
            minHeight = 44
            verticalSpacing = 3
            detailLineLimit = 1
        case (.extraLarge, false):
            titleSize = 10.5
            valueSize = 17
            detailSize = 9.5
            iconSize = 15
            padding = 8
            minHeight = 58
            verticalSpacing = 4
            detailLineLimit = 2
        case (.extraLarge, true):
            titleSize = 9
            valueSize = 14
            detailSize = 8
            iconSize = 12
            padding = 7
            minHeight = 48
            verticalSpacing = 3
            detailLineLimit = 1
        }
    }
}

private struct WidgetMetricTile: View {
    let metric: HealthDashboardMetric
    let style: WidgetMetricTileStyle

    var body: some View {
        VStack(alignment: .leading, spacing: style.verticalSpacing) {
            HStack(spacing: 5) {
                Image(systemName: metric.systemImage)
                    .font(.system(size: style.iconSize * 0.72, weight: .bold))
                    .foregroundStyle(WidgetTheme.color(for: metric.accentColorName))
                    .frame(width: style.iconSize, height: style.iconSize)
                Text(metric.title)
                    .font(.system(size: style.titleSize, weight: .semibold, design: .monospaced))
                    .foregroundStyle(WidgetTheme.secondaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.55)
            }

            Text(metric.valueText)
                .font(.system(size: style.valueSize, weight: .black, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.48)

            Text(metric.detailText ?? metric.caption)
                .font(.system(size: style.detailSize, weight: .medium))
                .foregroundStyle(WidgetTheme.secondaryText)
                .lineLimit(style.detailLineLimit)
                .minimumScaleFactor(0.62)
        }
        .padding(style.padding)
        .frame(maxWidth: .infinity, minHeight: style.minHeight, alignment: .topLeading)
        .background(WidgetTheme.tileFill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(metric.accessibilityText)
    }
}

private struct WidgetMetricIcon: View {
    let metric: HealthDashboardMetric
    let size: CGFloat
    let cornerRadius: CGFloat

    var body: some View {
        let color = WidgetTheme.color(for: metric.accentColorName)

        Image(systemName: metric.systemImage)
            .font(.system(size: size * 0.52, weight: .bold))
            .foregroundStyle(color)
            .frame(width: size, height: size)
            .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: cornerRadius))
            .accessibilityHidden(true)
    }
}

private struct NutritionWidgetStrip: View {
    let snapshot: NutritionCoachSnapshot

    var body: some View {
        HStack(spacing: 5) {
            NutritionWidgetPill(title: "Eaten", value: snapshot.calorieText, icon: "checkmark.circle.fill")
            NutritionWidgetPill(title: "Protein", value: snapshot.proteinText, icon: "fish.fill")
            NutritionWidgetPill(title: "Next", value: snapshot.nextMealText, icon: "calendar")
            NutritionWidgetPill(title: "Hunger", value: snapshot.hungerText, icon: "dial.low")
        }
        .accessibilityElement(children: .combine)
    }
}

private struct NutritionWidgetPill: View {
    let title: String
    let value: String
    let icon: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(title, systemImage: icon)
                .font(.system(size: 7.5, weight: .bold, design: .monospaced))
                .foregroundStyle(WidgetTheme.secondaryText)
                .lineLimit(1)
            Text(value)
                .font(.system(size: 9.5, weight: .black, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.48)
        }
        .padding(5)
        .frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)
        .background(WidgetTheme.tileFill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct FitnessCoachStepsWidget: Widget {
    let kind = StepSnapshotStore.widgetKind

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: FitnessCoachWidgetConfigurationIntent.self,
            provider: FitnessCoachStepsProvider()
        ) { entry in
            FitnessCoachStepsWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Fitness Coach")
        .description("Shows configurable iPhone-synced fitness and nutrition metrics.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .systemLarge,
            .systemExtraLarge,
            .accessoryCircular,
            .accessoryRectangular,
            .accessoryInline,
        ])
        .contentMarginsDisabled()
    }
}

struct FitnessCoachSyncLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FitnessCoachSyncActivityAttributes.self) { context in
            FitnessCoachLiveActivityView(state: context.state)
                .activityBackgroundTint(WidgetTheme.background)
                .activitySystemActionForegroundColor(WidgetTheme.lime)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.state.title, systemImage: icon(for: context.state))
                        .font(.headline)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(progressText(context.state.progressFraction))
                        .font(.headline.monospacedDigit())
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(context.state.detail)
                            .font(.caption)
                            .lineLimit(2)
                        if let progress = context.state.progressFraction {
                            ProgressView(value: progress)
                                .tint(WidgetTheme.lime)
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: icon(for: context.state))
            } compactTrailing: {
                Text(progressText(context.state.progressFraction))
                    .monospacedDigit()
            } minimal: {
                Image(systemName: icon(for: context.state))
            }
        }
    }

    private func icon(for state: FitnessCoachSyncActivityAttributes.ContentState) -> String {
        switch state.state {
        case "completed":
            return "checkmark.circle.fill"
        case "failed":
            return "exclamationmark.triangle.fill"
        default:
            return "arrow.triangle.2.circlepath"
        }
    }

    private func progressText(_ progress: Double?) -> String {
        guard let progress else {
            return "Sync"
        }

        return "\(Int((min(1, max(0, progress)) * 100).rounded()))%"
    }
}

private struct FitnessCoachLiveActivityView: View {
    let state: FitnessCoachSyncActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(color)
                    .frame(width: 40, height: 40)
                    .background(color.opacity(0.16), in: RoundedRectangle(cornerRadius: 8))

                VStack(alignment: .leading, spacing: 2) {
                    Text(state.title)
                        .font(.headline)
                        .lineLimit(1)
                    Text(state.detail)
                        .font(.caption)
                        .foregroundStyle(WidgetTheme.secondaryText)
                        .lineLimit(2)
                }

                Spacer(minLength: 8)
            }

            if let progress = state.progressFraction {
                ProgressView(value: min(1, max(0, progress)))
                    .tint(WidgetTheme.lime)
            }
        }
        .padding(16)
    }

    private var icon: String {
        switch state.state {
        case "completed":
            return "checkmark.circle.fill"
        case "failed":
            return "exclamationmark.triangle.fill"
        default:
            return "arrow.triangle.2.circlepath"
        }
    }

    private var color: Color {
        state.state == "failed" ? WidgetTheme.orange : WidgetTheme.lime
    }
}

@main
struct FitnessCoachStepsWidgetBundle: WidgetBundle {
    var body: some Widget {
        FitnessCoachStepsWidget()
        FitnessCoachSyncLiveActivity()
    }
}

private enum WidgetTheme {
    static let background = Color(red: 0.075, green: 0.075, blue: 0.075)
    static let tileFill = Color(red: 0.12, green: 0.13, blue: 0.11)
    static let secondaryText = Color(red: 0.77, green: 0.79, blue: 0.67)
    static let lime = Color(red: 0.76, green: 0.96, blue: 0.0)
    static let orange = Color(red: 1.0, green: 0.62, blue: 0.22)
    static let cyan = Color(red: 0.39, green: 0.86, blue: 0.94)
    static let violet = Color(red: 0.68, green: 0.55, blue: 0.98)

    static func color(for accent: HealthDashboardMetric.AccentColorName) -> Color {
        switch accent {
        case .lime:
            return lime
        case .orange:
            return orange
        case .cyan:
            return cyan
        case .violet:
            return violet
        case .neutral:
            return secondaryText
        }
    }
}

private extension View {
    func widgetBackground() -> some View {
        containerBackground(WidgetTheme.background, for: .widget)
    }
}
