export type HealthMetricUnit = "kg" | "count" | "kcal" | "minute" | "bpm" | "g";

type HealthMetricDefinition = Readonly<{
  name: string;
  unit: HealthMetricUnit;
  description: string;
}>;

const healthMetrics = [
  Object.freeze({
    name: "weight",
    unit: "kg",
    description: "Body mass from HealthKit bodyMass.",
  }),
  Object.freeze({
    name: "steps",
    unit: "count",
    description: "Step count from HealthKit stepCount.",
  }),
  Object.freeze({
    name: "active_energy",
    unit: "kcal",
    description: "Active energy burned.",
  }),
  Object.freeze({
    name: "resting_energy",
    unit: "kcal",
    description: "Basal/resting energy burned.",
  }),
  Object.freeze({
    name: "sleep",
    unit: "minute",
    description: "Sleep duration derived from sleep analysis.",
  }),
  Object.freeze({
    name: "heart_rate",
    unit: "bpm",
    description: "Heart-rate samples.",
  }),
  Object.freeze({
    name: "resting_heart_rate",
    unit: "bpm",
    description: "Resting heart rate.",
  }),
  Object.freeze({
    name: "walking_heart_rate",
    unit: "bpm",
    description: "Walking heart-rate average.",
  }),
  Object.freeze({
    name: "dietary_energy",
    unit: "kcal",
    description: "Dietary energy consumed from HealthKit.",
  }),
  Object.freeze({
    name: "protein",
    unit: "g",
    description: "Dietary protein consumed from HealthKit.",
  }),
  Object.freeze({
    name: "carbs",
    unit: "g",
    description: "Dietary carbohydrates consumed from HealthKit.",
  }),
  Object.freeze({
    name: "fat",
    unit: "g",
    description: "Dietary fat consumed from HealthKit.",
  }),
  Object.freeze({
    name: "fiber",
    unit: "g",
    description: "Dietary fiber consumed from HealthKit.",
  }),
] as const satisfies readonly HealthMetricDefinition[];

export type HealthMetric = (typeof healthMetrics)[number];
export type HealthMetricName = HealthMetric["name"];
export type HealthMetricValueBounds = Readonly<{
  min: number;
  max: number;
  minExclusive?: boolean;
}>;

export const HEALTH_METRICS: readonly HealthMetric[] = Object.freeze([
  ...healthMetrics,
]);

const HEALTH_METRIC_VALUE_BOUNDS: Readonly<
  Record<HealthMetricName, HealthMetricValueBounds>
> = Object.freeze({
  weight: Object.freeze({ min: 0, max: 1_000, minExclusive: true }),
  steps: Object.freeze({ min: 0, max: 250_000 }),
  active_energy: Object.freeze({ min: 0, max: 20_000 }),
  resting_energy: Object.freeze({ min: 0, max: 10_000 }),
  sleep: Object.freeze({ min: 0, max: 1_440 }),
  heart_rate: Object.freeze({ min: 0, max: 300, minExclusive: true }),
  resting_heart_rate: Object.freeze({ min: 0, max: 300, minExclusive: true }),
  walking_heart_rate: Object.freeze({
    min: 0,
    max: 300,
    minExclusive: true,
  }),
  dietary_energy: Object.freeze({ min: 0, max: 20_000 }),
  protein: Object.freeze({ min: 0, max: 1_000 }),
  carbs: Object.freeze({ min: 0, max: 2_000 }),
  fat: Object.freeze({ min: 0, max: 1_000 }),
  fiber: Object.freeze({ min: 0, max: 500 }),
});

const HEALTH_METRICS_BY_NAME: Readonly<Record<HealthMetricName, HealthMetric>> =
  Object.freeze(
    Object.fromEntries(
      HEALTH_METRICS.map((metric) => [metric.name, metric]),
    ) as Record<HealthMetricName, HealthMetric>,
  );

export function isHealthMetricName(value: string): value is HealthMetricName {
  return HEALTH_METRICS.some((metric) => metric.name === value);
}

export function metricByName(name: HealthMetricName): HealthMetric {
  return HEALTH_METRICS_BY_NAME[name];
}

export function metricValueBounds(
  name: HealthMetricName,
): HealthMetricValueBounds {
  return HEALTH_METRIC_VALUE_BOUNDS[name];
}

export function isValidHealthMetricValue(
  name: HealthMetricName,
  value: number,
): boolean {
  if (!Number.isFinite(value)) {
    return false;
  }

  const bounds = metricValueBounds(name);
  const aboveMinimum = bounds.minExclusive
    ? value > bounds.min
    : value >= bounds.min;

  return aboveMinimum && value <= bounds.max;
}
