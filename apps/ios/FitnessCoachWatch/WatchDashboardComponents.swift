import SwiftUI

struct WatchDashboardCardView: View {
  let card: WatchDashboardCard
  let onAction: (WatchDashboardAction) -> Void

  var body: some View {
    Group {
      switch card.state {
      case .content:
        if card.metricKey == .steps, card.progress != nil {
          WatchCompactProgressCard(card: card, onAction: onAction)
        } else {
          WatchNumericMetricCard(card: card, onAction: onAction)
        }
      case .loading:
        WatchLoadingCard(card: card)
      case .permissionRequired:
        WatchPermissionRequiredCard(card: card, onAction: onAction)
      case .empty:
        WatchNoDataCard(card: card, onAction: onAction)
      case .unavailable, .error:
        WatchNoDataCard(card: card, onAction: onAction)
      }
    }
  }
}

struct WatchCompactProgressCard: View {
  let card: WatchDashboardCard
  let onAction: (WatchDashboardAction) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 10) {
        ZStack {
          Circle()
            .stroke(WatchTheme.cardStroke, lineWidth: 7)
          Circle()
            .trim(from: 0, to: card.progress ?? 0)
            .stroke(
              WatchTheme.lime,
              style: StrokeStyle(lineWidth: 7, lineCap: .round)
            )
            .rotationEffect(.degrees(-90))
          Text(WatchStepFormatting.percentage(card.progress ?? 0))
            .font(.caption2.bold())
        }
        .frame(width: 60, height: 60)
        .accessibilityHidden(true)

        VStack(alignment: .leading, spacing: 2) {
          Label(card.label, systemImage: "figure.walk")
            .font(.caption.weight(.semibold))
            .foregroundStyle(WatchTheme.secondaryText)
          Text(card.formattedValue ?? "—")
            .font(.system(.title, design: .rounded, weight: .black))
            .lineLimit(1)
            .minimumScaleFactor(0.65)
          Text("of \(formatted(card.goal)) goal")
            .font(.caption2)
            .foregroundStyle(WatchTheme.secondaryText)
        }
      }

      HStack {
        Text("\(formatted(card.remainingValue)) remaining")
          .font(.caption.weight(.semibold))
        Spacer(minLength: 4)
        WatchSyncStaleIndicator(freshness: card.freshness)
      }

      actionButtonIfPresent
    }
    .watchCardStyle()
    .accessibilityElement(children: .combine)
    .accessibilityLabel(accessibilityText)
  }

  @ViewBuilder
  private var actionButtonIfPresent: some View {
    if let action = card.action {
      Button("Change goal") {
        onAction(action)
      }
      .buttonStyle(.plain)
      .foregroundStyle(WatchTheme.lime)
      .frame(minHeight: 44)
      .accessibilityHint("Opens local Watch step goal settings")
    }
  }

  private var accessibilityText: String {
    "\(card.label), \(card.formattedValue ?? "no value") steps, "
      + "\(WatchStepFormatting.percentage(card.progress ?? 0)) of goal, "
      + "\(formatted(card.remainingValue)) remaining"
  }

  private func formatted(_ value: Double?) -> String {
    guard let value else { return "—" }
    return WatchStepFormatting.integer(Int(max(0, value).rounded()))
  }
}

struct WatchNumericMetricCard: View {
  let card: WatchDashboardCard
  let onAction: (WatchDashboardAction) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      Label(card.label, systemImage: icon)
        .font(.caption.weight(.semibold))
        .foregroundStyle(WatchTheme.secondaryText)

      Text(card.formattedValue ?? "—")
        .font(.system(.title, design: .rounded, weight: .black))
        .lineLimit(1)
        .minimumScaleFactor(0.65)

      if let stateMessage = card.stateMessage {
        Text(stateMessage)
          .font(.caption)
          .foregroundStyle(WatchTheme.secondaryText)
          .lineLimit(2)
          .minimumScaleFactor(0.75)
      } else if card.metricKey == .steps, card.goal == nil {
        Text("No local goal set")
          .font(.caption)
          .foregroundStyle(WatchTheme.secondaryText)
      }

      WatchSyncStaleIndicator(freshness: card.freshness)

      if let action = card.action {
        Button(card.metricKey == .steps ? "Set goal" : "Open") {
          onAction(action)
        }
        .buttonStyle(.plain)
        .foregroundStyle(WatchTheme.lime)
        .frame(minHeight: 44)
      }
    }
    .watchCardStyle()
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(card.label), \(card.formattedValue ?? "no value") \(card.unit ?? "")")
  }

  private var icon: String {
    switch card.metricKey {
    case .steps:
      return "figure.walk"
    case .weight:
      return "scalemass"
    case .activeEnergy, .activeCalories:
      return "flame.fill"
    case .restingEnergy:
      return "battery.100"
    case .sleep:
      return "bed.double.fill"
    case .heartRate:
      return "waveform.path.ecg"
    case .restingHeartRate:
      return "heart.fill"
    case .walkingHeartRate:
      return "figure.walk.motion"
    case .dietaryEnergy, .caloriesRemaining:
      return "fork.knife"
    case .protein, .proteinRemaining:
      return "fish"
    case .carbs:
      return "takeoutbag.and.cup.and.straw"
    case .fat:
      return "drop.fill"
    case .fiber:
      return "leaf.fill"
    case .exerciseMinutes:
      return "timer"
    case .nextPlannedMeal:
      return "calendar"
    }
  }
}

struct WatchLoadingCard: View {
  let card: WatchDashboardCard

  var body: some View {
    HStack(spacing: 10) {
      ProgressView()
        .tint(WatchTheme.lime)
      VStack(alignment: .leading, spacing: 2) {
        Text(card.label).font(.headline)
        Text(card.stateMessage ?? "Loading")
          .font(.caption)
          .foregroundStyle(WatchTheme.secondaryText)
      }
    }
    .watchCardStyle()
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(card.label), loading")
  }
}

struct WatchPermissionRequiredCard: View {
  let card: WatchDashboardCard
  let onAction: (WatchDashboardAction) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label(card.label, systemImage: "heart.slash.fill")
        .font(.headline)
        .foregroundStyle(WatchTheme.orange)
      Text("HealthKit permission required")
        .font(.caption.weight(.bold))
      Text(card.stateMessage ?? "Step access is unavailable.")
        .font(.caption)
        .foregroundStyle(WatchTheme.secondaryText)
        .fixedSize(horizontal: false, vertical: true)

      if let action = card.action {
        Button("Allow step access") {
          onAction(action)
        }
        .buttonStyle(.borderedProminent)
        .tint(WatchTheme.lime)
        .foregroundStyle(WatchTheme.actionText)
        .frame(minHeight: 44)
      }
    }
    .watchCardStyle()
    .accessibilityElement(children: .contain)
  }
}

struct WatchNoDataCard: View {
  let card: WatchDashboardCard
  let onAction: (WatchDashboardAction) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      Label(
        card.label, systemImage: card.state == .error ? "exclamationmark.triangle" : "minus.circle"
      )
      .font(.headline)
      .foregroundStyle(card.state == .error ? WatchTheme.orange : WatchTheme.secondaryText)
      Text(card.state == .error ? "Refresh error" : stateTitle)
        .font(.caption.weight(.bold))
      Text(card.stateMessage ?? "No data")
        .font(.caption2)
        .foregroundStyle(WatchTheme.secondaryText)
        .fixedSize(horizontal: false, vertical: true)

      if let action = card.action {
        Button("Try again") {
          onAction(action)
        }
        .buttonStyle(.plain)
        .foregroundStyle(WatchTheme.lime)
        .frame(minHeight: 44)
      }
    }
    .watchCardStyle()
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(card.label), \(stateTitle), \(card.stateMessage ?? "")")
  }

  private var stateTitle: String {
    card.state == .unavailable ? "Unavailable" : "No data"
  }
}

struct WatchSyncStaleIndicator: View {
  let freshness: WatchDashboardFreshness?

  var body: some View {
    if let freshness {
      Label(text(for: freshness), systemImage: icon(for: freshness))
        .font(.caption2)
        .foregroundStyle(freshness.isStale ? WatchTheme.orange : WatchTheme.secondaryText)
        .lineLimit(1)
        .minimumScaleFactor(0.75)
        .accessibilityLabel(accessibilityText(for: freshness))
    }
  }

  private func text(for freshness: WatchDashboardFreshness) -> String {
    let time = freshness.refreshedAt.formatted(.dateTime.hour().minute())
    if freshness.isStale {
      return "Stale • \(time)"
    }
    if freshness.isCached {
      return "Cached • \(time)"
    }
    return "Updated \(time)"
  }

  private func icon(for freshness: WatchDashboardFreshness) -> String {
    freshness.isStale ? "exclamationmark.clock" : "clock"
  }

  private func accessibilityText(for freshness: WatchDashboardFreshness) -> String {
    let status =
      freshness.isStale ? "Stale data" : (freshness.isCached ? "Cached data" : "Fresh data")
    return "\(status), refreshed \(freshness.refreshedAt.formatted(.dateTime.hour().minute()))"
  }
}

extension View {
  fileprivate func watchCardStyle() -> some View {
    padding(12)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(WatchTheme.cardFill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
          .stroke(WatchTheme.cardStroke, lineWidth: 1)
      }
  }
}
