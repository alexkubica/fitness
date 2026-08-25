import {
  LEGACY_HEALTH_METRIC_TO_REGISTRY_KEY,
  formatMetricValue as formatRegisteredMetricValue,
  type HealthMetricName,
  type HealthMetricUnit,
} from "@fitness/domain";

export function formatMetricValue(
  value: number | undefined,
  unit: HealthMetricUnit,
  metricName?: HealthMetricName,
): string {
  if (metricName !== undefined) {
    return formatRegisteredMetricValue(
      LEGACY_HEALTH_METRIC_TO_REGISTRY_KEY[metricName],
      value,
    ).formattedValue;
  }

  if (value === undefined || !Number.isFinite(value)) {
    return "N/A";
  }

  if (unit === "minute") {
    return `${formatNumber(value / 60, 1)} h`;
  }

  return `${formatNumber(value, unit === "kg" ? 1 : 0)} ${unit}`;
}

export function formatCompactValue(
  value: number | undefined,
  unit: HealthMetricUnit,
): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "N/A";
  }

  if (unit === "minute") {
    return `${formatNumber(value / 60, 1)}h`;
  }

  if (Math.abs(value) >= 1_000 && unit === "count") {
    return `${formatNumber(value / 1_000, 1)}k`;
  }

  return formatNumber(value, unit === "kg" ? 1 : 0);
}

export function formatDelta(
  value: number | undefined,
  unit: HealthMetricUnit,
  metricName?: HealthMetricName,
): string {
  if (metricName !== undefined) {
    const formatted = formatRegisteredMetricValue(
      LEGACY_HEALTH_METRIC_TO_REGISTRY_KEY[metricName],
      value,
    ).formattedValue;
    return value !== undefined && Number.isFinite(value) && value > 0
      ? `+${formatted}`
      : formatted;
  }

  if (value === undefined || !Number.isFinite(value)) {
    return "N/A";
  }

  const prefix = value > 0 ? "+" : "";

  if (unit === "minute") {
    return `${prefix}${formatNumber(value / 60, 1)} h`;
  }

  return `${prefix}${formatNumber(value, unit === "kg" ? 1 : 0)} ${unit}`;
}

export function formatDate(value: string | undefined): string {
  if (value === undefined) {
    return "No data";
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(`${value}T12:00:00Z`));
  } catch {
    return value;
  }
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value);
}
