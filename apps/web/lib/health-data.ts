import { createNeonClient, getDatabaseUrl } from "@fitness/db/dist/client.js";
import {
  createNeonHealthSampleRepository,
  type HealthMetricSample,
  type SqlQueryExecutor,
} from "@fitness/db/dist/health-samples.js";
import {
  HEALTH_METRICS,
  type HealthMetricName,
  type HealthMetricUnit,
} from "@fitness/domain";
import { getSelfProfileId } from "./profile-data";

export type DashboardMetric = Readonly<{
  name: HealthMetricName;
  label: string;
  unit: HealthMetricUnit;
  latest: number | undefined;
  latestDate: string | undefined;
  average30d: number | undefined;
  delta30d: number | undefined;
  coveredDays: number;
  points: readonly DashboardPoint[];
  tone: "lime" | "sky" | "coral" | "violet";
}>;

export type DashboardPoint = Readonly<{
  date: string;
  value: number;
}>;

export type HealthDashboardData = Readonly<{
  generatedAt: string;
  range: Readonly<{
    from: string;
    to: string;
  }>;
  metrics: readonly DashboardMetric[];
}>;

const METRIC_LABELS: Record<HealthMetricName, string> = {
  active_energy: "Active Energy",
  carbs: "Carbs",
  dietary_energy: "Calories",
  fat: "Fat",
  fiber: "Fiber",
  heart_rate: "Heart Rate",
  protein: "Protein",
  resting_energy: "Resting Energy",
  resting_heart_rate: "Resting HR",
  sleep: "Sleep",
  steps: "Steps",
  walking_heart_rate: "Walking HR",
  weight: "Weight",
};

const METRIC_TONES: Record<HealthMetricName, DashboardMetric["tone"]> = {
  active_energy: "coral",
  carbs: "sky",
  dietary_energy: "coral",
  fat: "violet",
  fiber: "lime",
  heart_rate: "violet",
  protein: "lime",
  resting_energy: "sky",
  resting_heart_rate: "violet",
  sleep: "sky",
  steps: "lime",
  walking_heart_rate: "violet",
  weight: "lime",
};

export async function getHealthDashboardData(
  userId: string,
): Promise<HealthDashboardData> {
  const sql = createNeonClient(getDatabaseUrl()) as SqlQueryExecutor;
  const repository = createNeonHealthSampleRepository(sql);
  const profileId = await getSelfProfileId(sql, userId);
  const to = new Date();
  const from = new Date(to);

  from.setUTCDate(from.getUTCDate() - 365);

  const samples = await repository.listSamples({
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
    profileId,
    userId,
  });

  return {
    generatedAt: to.toISOString(),
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
    metrics: HEALTH_METRICS.map((metric) =>
      buildMetricDashboard(metric.name, metric.unit, samples),
    ),
  };
}

function buildMetricDashboard(
  name: HealthMetricName,
  unit: HealthMetricUnit,
  samples: readonly HealthMetricSample[],
): DashboardMetric {
  const points = samples
    .filter((sample) => sample.metricName === name)
    .map((sample) => ({
      date: localDateForSample(sample),
      value: sample.value,
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const latest = points.at(-1);
  const recent = points.slice(-30);
  const firstRecent = recent.at(0);

  return {
    name,
    label: METRIC_LABELS[name],
    unit,
    latest: latest?.value,
    latestDate: latest?.date,
    average30d: average(recent.map((point) => point.value)),
    delta30d:
      latest !== undefined && firstRecent !== undefined
        ? round(latest.value - firstRecent.value)
        : undefined,
    coveredDays: new Set(points.map((point) => point.date)).size,
    points: points.slice(-90),
    tone: METRIC_TONES[name],
  };
}

function average(values: readonly number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function localDateForSample(sample: HealthMetricSample): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: sample.timezone,
    year: "numeric",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(sample.startTime))
      .map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}
