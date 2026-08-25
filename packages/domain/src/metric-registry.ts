import type { HealthMetricName } from "./metrics.js";

export const METRIC_CATEGORIES = [
  "activity",
  "body",
  "heart",
  "sleep",
  "nutrition",
  "training",
] as const;
export type MetricCategory = (typeof METRIC_CATEGORIES)[number];

export const METRIC_UNITS = [
  "count",
  "kg",
  "lb",
  "percent",
  "cm",
  "bpm",
  "ms",
  "minute",
  "hour",
  "m",
  "km",
  "mi",
  "kcal",
  "kJ",
  "g",
  "ml",
  "L",
] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

export type MetricAggregationStrategy =
  | "sum"
  | "average"
  | "latest"
  | "duration"
  | "count";
export type MetricGranularity = "sample" | "hour" | "day" | "week" | "month";
export type MetricFormatterIdentifier =
  | "integer"
  | "energy"
  | "weight"
  | "percentage"
  | "duration"
  | "distance"
  | "heart_rate"
  | "volume"
  | "decimal";
export type MetricValueType = "cumulative" | "instantaneous";
export type MetricChartType = "line" | "bar" | "area" | "stacked_bar";
export type MetricPrivacyCategory =
  | "health_activity"
  | "health_body"
  | "health_cardiovascular"
  | "health_sleep"
  | "health_nutrition"
  | "health_training";
export type MetricSource =
  | "apple_health"
  | "xiaomi_via_apple_health"
  | "meal_log"
  | "manual"
  | "derived";
export type MetricAvailability =
  | "currently_available"
  | "source_dependent"
  | "planned_unavailable";
export type MetricDirectionality = Readonly<{
  preferred: "higher" | "lower" | "target_range";
  description: string;
}>;

export type MetricDefinition = Readonly<{
  key: string;
  displayName: string;
  description: string;
  category: MetricCategory;
  canonicalUnit: MetricUnit;
  acceptedSourceUnits: readonly MetricUnit[];
  aggregationStrategy: MetricAggregationStrategy;
  supportedGranularities: readonly MetricGranularity[];
  displayPrecision: number;
  formatterIdentifier: MetricFormatterIdentifier;
  valueType: MetricValueType;
  partialDayValuesExpected: boolean;
  goalsSupported: boolean;
  recommendedChartType: MetricChartType;
  privacyCategory: MetricPrivacyCategory;
  supportedSources: readonly MetricSource[];
  availability: MetricAvailability;
  directionality?: MetricDirectionality;
}>;

const metricDefinitions = [
  metric({
    key: "steps",
    displayName: "Steps",
    description: "Number of steps taken.",
    category: "activity",
    canonicalUnit: "count",
    acceptedSourceUnits: ["count"],
    aggregationStrategy: "sum",
    supportedGranularities: ["hour", "day", "week", "month"],
    displayPrecision: 0,
    formatterIdentifier: "integer",
    valueType: "cumulative",
    partialDayValuesExpected: true,
    goalsSupported: true,
    recommendedChartType: "bar",
    privacyCategory: "health_activity",
    supportedSources: ["apple_health"],
    availability: "currently_available",
    directionality: {
      preferred: "higher",
      description:
        "Progress toward a personal activity goal is generally favorable.",
    },
  }),
  metric({
    key: "active_energy",
    displayName: "Active Energy",
    description: "Energy burned through activity above resting needs.",
    category: "activity",
    canonicalUnit: "kcal",
    acceptedSourceUnits: ["kcal", "kJ"],
    aggregationStrategy: "sum",
    supportedGranularities: ["hour", "day", "week", "month"],
    displayPrecision: 0,
    formatterIdentifier: "energy",
    valueType: "cumulative",
    partialDayValuesExpected: true,
    goalsSupported: true,
    recommendedChartType: "bar",
    privacyCategory: "health_activity",
    supportedSources: ["apple_health"],
    availability: "currently_available",
  }),
  metric({
    key: "resting_energy",
    displayName: "Resting Energy",
    description: "Estimated energy used for basal and resting functions.",
    category: "activity",
    canonicalUnit: "kcal",
    acceptedSourceUnits: ["kcal", "kJ"],
    aggregationStrategy: "sum",
    supportedGranularities: ["hour", "day", "week", "month"],
    displayPrecision: 0,
    formatterIdentifier: "energy",
    valueType: "cumulative",
    partialDayValuesExpected: true,
    goalsSupported: false,
    recommendedChartType: "area",
    privacyCategory: "health_activity",
    supportedSources: ["apple_health"],
    availability: "currently_available",
  }),
  metric({
    key: "total_energy",
    displayName: "Total Energy",
    description: "Combined active and resting energy for a period.",
    category: "activity",
    canonicalUnit: "kcal",
    acceptedSourceUnits: ["kcal", "kJ"],
    aggregationStrategy: "sum",
    supportedGranularities: ["day", "week", "month"],
    displayPrecision: 0,
    formatterIdentifier: "energy",
    valueType: "cumulative",
    partialDayValuesExpected: true,
    goalsSupported: false,
    recommendedChartType: "stacked_bar",
    privacyCategory: "health_activity",
    supportedSources: ["derived"],
    availability: "planned_unavailable",
  }),
  metric({
    key: "exercise_minutes",
    displayName: "Exercise Minutes",
    description: "Minutes credited toward exercise activity.",
    category: "activity",
    canonicalUnit: "minute",
    acceptedSourceUnits: ["minute", "hour"],
    aggregationStrategy: "sum",
    supportedGranularities: ["hour", "day", "week", "month"],
    displayPrecision: 0,
    formatterIdentifier: "duration",
    valueType: "cumulative",
    partialDayValuesExpected: true,
    goalsSupported: true,
    recommendedChartType: "bar",
    privacyCategory: "health_activity",
    supportedSources: ["apple_health"],
    availability: "source_dependent",
  }),
  metric({
    key: "stand_hours",
    displayName: "Stand Hours",
    description: "Hours in which a stand goal was achieved.",
    category: "activity",
    canonicalUnit: "count",
    acceptedSourceUnits: ["count"],
    aggregationStrategy: "sum",
    supportedGranularities: ["day", "week", "month"],
    displayPrecision: 0,
    formatterIdentifier: "integer",
    valueType: "cumulative",
    partialDayValuesExpected: true,
    goalsSupported: true,
    recommendedChartType: "bar",
    privacyCategory: "health_activity",
    supportedSources: ["apple_health"],
    availability: "source_dependent",
  }),
  metric({
    key: "walking_distance",
    displayName: "Walking Distance",
    description: "Distance attributed to walking.",
    category: "activity",
    canonicalUnit: "km",
    acceptedSourceUnits: ["m", "km", "mi"],
    aggregationStrategy: "sum",
    supportedGranularities: ["hour", "day", "week", "month"],
    displayPrecision: 2,
    formatterIdentifier: "distance",
    valueType: "cumulative",
    partialDayValuesExpected: true,
    goalsSupported: true,
    recommendedChartType: "bar",
    privacyCategory: "health_activity",
    supportedSources: ["apple_health"],
    availability: "source_dependent",
  }),
  metric({
    key: "running_distance",
    displayName: "Running Distance",
    description: "Distance attributed to running workouts or samples.",
    category: "activity",
    canonicalUnit: "km",
    acceptedSourceUnits: ["m", "km", "mi"],
    aggregationStrategy: "sum",
    supportedGranularities: ["hour", "day", "week", "month"],
    displayPrecision: 2,
    formatterIdentifier: "distance",
    valueType: "cumulative",
    partialDayValuesExpected: true,
    goalsSupported: true,
    recommendedChartType: "bar",
    privacyCategory: "health_activity",
    supportedSources: ["apple_health"],
    availability: "source_dependent",
  }),
  metric({
    key: "weight",
    displayName: "Weight",
    description: "Body mass measurement.",
    category: "body",
    canonicalUnit: "kg",
    acceptedSourceUnits: ["kg", "lb"],
    aggregationStrategy: "latest",
    supportedGranularities: ["sample", "day", "week", "month"],
    displayPrecision: 1,
    formatterIdentifier: "weight",
    valueType: "instantaneous",
    partialDayValuesExpected: false,
    goalsSupported: true,
    recommendedChartType: "line",
    privacyCategory: "health_body",
    supportedSources: ["apple_health", "xiaomi_via_apple_health", "manual"],
    availability: "currently_available",
    directionality: {
      preferred: "target_range",
      description:
        "Interpret against the user's confirmed goal and trend, not in isolation.",
    },
  }),
  metric({
    key: "body_fat_percentage",
    displayName: "Body Fat",
    description: "Estimated percentage of body mass that is fat.",
    category: "body",
    canonicalUnit: "percent",
    acceptedSourceUnits: ["percent"],
    aggregationStrategy: "latest",
    supportedGranularities: ["sample", "day", "week", "month"],
    displayPrecision: 1,
    formatterIdentifier: "percentage",
    valueType: "instantaneous",
    partialDayValuesExpected: false,
    goalsSupported: true,
    recommendedChartType: "line",
    privacyCategory: "health_body",
    supportedSources: ["apple_health", "manual"],
    availability: "source_dependent",
    directionality: {
      preferred: "target_range",
      description:
        "Interpret as an estimate and against an individualized target range.",
    },
  }),
  metric({
    key: "waist_circumference",
    displayName: "Waist Circumference",
    description: "Circumference measured around the waist.",
    category: "body",
    canonicalUnit: "cm",
    acceptedSourceUnits: ["cm"],
    aggregationStrategy: "latest",
    supportedGranularities: ["sample", "day", "week", "month"],
    displayPrecision: 1,
    formatterIdentifier: "decimal",
    valueType: "instantaneous",
    partialDayValuesExpected: false,
    goalsSupported: true,
    recommendedChartType: "line",
    privacyCategory: "health_body",
    supportedSources: ["apple_health", "manual"],
    availability: "source_dependent",
  }),
  metric({
    key: "heart_rate",
    displayName: "Heart Rate",
    description: "Heart beats per minute at the sampled time.",
    category: "heart",
    canonicalUnit: "bpm",
    acceptedSourceUnits: ["bpm"],
    aggregationStrategy: "average",
    supportedGranularities: ["sample", "hour", "day", "week", "month"],
    displayPrecision: 0,
    formatterIdentifier: "heart_rate",
    valueType: "instantaneous",
    partialDayValuesExpected: true,
    goalsSupported: false,
    recommendedChartType: "line",
    privacyCategory: "health_cardiovascular",
    supportedSources: ["apple_health"],
    availability: "currently_available",
  }),
  metric({
    key: "resting_heart_rate",
    displayName: "Resting Heart Rate",
    description: "Estimated resting heart beats per minute.",
    category: "heart",
    canonicalUnit: "bpm",
    acceptedSourceUnits: ["bpm"],
    aggregationStrategy: "average",
    supportedGranularities: ["day", "week", "month"],
    displayPrecision: 0,
    formatterIdentifier: "heart_rate",
    valueType: "instantaneous",
    partialDayValuesExpected: true,
    goalsSupported: false,
    recommendedChartType: "line",
    privacyCategory: "health_cardiovascular",
    supportedSources: ["apple_health"],
    availability: "currently_available",
  }),
  metric({
    key: "walking_heart_rate",
    displayName: "Walking Heart Rate",
    description: "Average heart rate observed while walking.",
    category: "heart",
    canonicalUnit: "bpm",
    acceptedSourceUnits: ["bpm"],
    aggregationStrategy: "average",
    supportedGranularities: ["day", "week", "month"],
    displayPrecision: 0,
    formatterIdentifier: "heart_rate",
    valueType: "instantaneous",
    partialDayValuesExpected: true,
    goalsSupported: false,
    recommendedChartType: "line",
    privacyCategory: "health_cardiovascular",
    supportedSources: ["apple_health"],
    availability: "currently_available",
  }),
  metric({
    key: "heart_rate_variability",
    displayName: "Heart Rate Variability",
    description:
      "Variation in time between heart beats, expressed in milliseconds.",
    category: "heart",
    canonicalUnit: "ms",
    acceptedSourceUnits: ["ms"],
    aggregationStrategy: "average",
    supportedGranularities: ["sample", "day", "week", "month"],
    displayPrecision: 0,
    formatterIdentifier: "decimal",
    valueType: "instantaneous",
    partialDayValuesExpected: true,
    goalsSupported: false,
    recommendedChartType: "line",
    privacyCategory: "health_cardiovascular",
    supportedSources: ["apple_health"],
    availability: "source_dependent",
  }),
  ...buildSleepMetrics(),
  ...buildNutritionMetrics(),
  metric({
    key: "workout_duration",
    displayName: "Workout Duration",
    description: "Total elapsed workout time.",
    category: "training",
    canonicalUnit: "minute",
    acceptedSourceUnits: ["minute", "hour"],
    aggregationStrategy: "duration",
    supportedGranularities: ["sample", "day", "week", "month"],
    displayPrecision: 0,
    formatterIdentifier: "duration",
    valueType: "cumulative",
    partialDayValuesExpected: true,
    goalsSupported: true,
    recommendedChartType: "bar",
    privacyCategory: "health_training",
    supportedSources: ["apple_health", "manual"],
    availability: "source_dependent",
  }),
  metric({
    key: "workout_count",
    displayName: "Workouts",
    description: "Number of workouts in a period.",
    category: "training",
    canonicalUnit: "count",
    acceptedSourceUnits: ["count"],
    aggregationStrategy: "count",
    supportedGranularities: ["day", "week", "month"],
    displayPrecision: 0,
    formatterIdentifier: "integer",
    valueType: "cumulative",
    partialDayValuesExpected: true,
    goalsSupported: true,
    recommendedChartType: "bar",
    privacyCategory: "health_training",
    supportedSources: ["apple_health", "manual"],
    availability: "source_dependent",
  }),
] as const;

export type MetricKey = (typeof metricDefinitions)[number]["key"];

export const METRIC_DEFINITIONS: readonly MetricDefinition[] = Object.freeze([
  ...metricDefinitions,
]);

const METRICS_BY_KEY = new Map(
  METRIC_DEFINITIONS.map((definition) => [definition.key, definition]),
);

const METRIC_ALIASES: Readonly<Record<string, MetricKey>> = Object.freeze({
  body_weight: "weight",
  calories: "calories_consumed",
  carbs: "carbohydrates_consumed",
  dietary_energy: "calories_consumed",
  distance_walked: "walking_distance",
  exercise_time: "exercise_minutes",
  hrv: "heart_rate_variability",
  protein: "protein_consumed",
  sleep: "sleep_duration",
  step: "steps",
  walking_hr: "walking_heart_rate",
  water: "water_consumed",
  workouts: "workout_count",
});

export const LEGACY_HEALTH_METRIC_TO_REGISTRY_KEY: Readonly<
  Record<HealthMetricName, MetricKey>
> = Object.freeze({
  weight: "weight",
  steps: "steps",
  active_energy: "active_energy",
  resting_energy: "resting_energy",
  sleep: "sleep_duration",
  heart_rate: "heart_rate",
  resting_heart_rate: "resting_heart_rate",
  walking_heart_rate: "walking_heart_rate",
  dietary_energy: "calories_consumed",
  protein: "protein_consumed",
  carbs: "carbohydrates_consumed",
  fat: "fat_consumed",
  fiber: "fiber_consumed",
});

export class UnsupportedMetricError extends Error {
  readonly code = "UNSUPPORTED_METRIC" as const;
  readonly invalidKey: string;
  readonly suggestedMetricKeys: readonly MetricKey[];
  readonly availableRegistryMethod = "listMetricDefinitions" as const;

  constructor(invalidKey: string) {
    const suggestions = suggestMetricKeys(invalidKey);
    super(`Unsupported metric key: ${invalidKey}`);
    this.name = "UnsupportedMetricError";
    this.invalidKey = invalidKey;
    this.suggestedMetricKeys = suggestions;
  }

  toJSON(): Readonly<{
    code: "UNSUPPORTED_METRIC";
    invalidKey: string;
    suggestedMetricKeys: readonly MetricKey[];
    availableRegistryMethod: "listMetricDefinitions";
  }> {
    return {
      code: this.code,
      invalidKey: this.invalidKey,
      suggestedMetricKeys: this.suggestedMetricKeys,
      availableRegistryMethod: this.availableRegistryMethod,
    };
  }
}

export function listMetricDefinitions(): readonly MetricDefinition[] {
  return METRIC_DEFINITIONS;
}

export function getMetricDefinition(metricKey: string): MetricDefinition {
  const definition = METRICS_BY_KEY.get(metricKey);
  if (definition === undefined) {
    throw new UnsupportedMetricError(metricKey);
  }
  return definition;
}

export function isSupportedMetric(metricKey: string): metricKey is MetricKey {
  return METRICS_BY_KEY.has(metricKey);
}

export function suggestMetricKeys(invalidKey: string): readonly MetricKey[] {
  const normalized = invalidKey.trim().toLowerCase().replaceAll("-", "_");
  const alias = METRIC_ALIASES[normalized];
  if (alias !== undefined) {
    return Object.freeze([alias]);
  }

  return Object.freeze(
    METRIC_DEFINITIONS.map((definition) => ({
      key: definition.key as MetricKey,
      distance: levenshteinDistance(normalized, definition.key),
    }))
      .filter(
        ({ distance }) =>
          distance <= Math.max(2, Math.floor(normalized.length / 3)),
      )
      .sort(
        (left, right) =>
          left.distance - right.distance || left.key.localeCompare(right.key),
      )
      .slice(0, 3)
      .map(({ key }) => key),
  );
}

function metric<T extends MetricDefinition>(definition: T): Readonly<T> {
  return Object.freeze({
    ...definition,
    acceptedSourceUnits: Object.freeze([...definition.acceptedSourceUnits]),
    supportedGranularities: Object.freeze([
      ...definition.supportedGranularities,
    ]),
    supportedSources: Object.freeze([...definition.supportedSources]),
    ...(definition.directionality === undefined
      ? {}
      : { directionality: Object.freeze({ ...definition.directionality }) }),
  });
}

function sleepMetric<const K extends string>(
  key: K,
  displayName: string,
  description: string,
  availability: MetricAvailability,
  chart: MetricChartType,
): Readonly<MetricDefinition & { key: K }> {
  return metric({
    key,
    displayName,
    description,
    category: "sleep",
    canonicalUnit: "minute",
    acceptedSourceUnits: ["minute", "hour"],
    aggregationStrategy: "duration",
    supportedGranularities: ["day", "week", "month"],
    displayPrecision: 0,
    formatterIdentifier: "duration",
    valueType: "cumulative",
    partialDayValuesExpected: true,
    goalsSupported: key === "sleep_duration",
    recommendedChartType: chart,
    privacyCategory: "health_sleep",
    supportedSources: ["apple_health"],
    availability,
  });
}

function buildSleepMetrics() {
  return [
    sleepMetric(
      "sleep_duration",
      "Sleep Duration",
      "Total time classified as asleep.",
      "currently_available",
      "area",
    ),
    sleepMetric(
      "sleep_awake",
      "Awake",
      "Time classified as awake during sleep tracking.",
      "source_dependent",
      "stacked_bar",
    ),
    sleepMetric(
      "sleep_core",
      "Core Sleep",
      "Time classified as core sleep.",
      "source_dependent",
      "stacked_bar",
    ),
    sleepMetric(
      "sleep_deep",
      "Deep Sleep",
      "Time classified as deep sleep.",
      "source_dependent",
      "stacked_bar",
    ),
    sleepMetric(
      "sleep_rem",
      "REM Sleep",
      "Time classified as REM sleep.",
      "source_dependent",
      "stacked_bar",
    ),
  ] as const;
}

function nutritionMetric<const K extends string>(
  definition: Readonly<{
    key: K;
    displayName: string;
    description: string;
    canonicalUnit: MetricUnit;
    acceptedSourceUnits: readonly MetricUnit[];
    formatterIdentifier: MetricFormatterIdentifier;
    displayPrecision: number;
    availability: MetricAvailability;
  }>,
): Readonly<MetricDefinition & { key: K }> {
  return metric({
    ...definition,
    category: "nutrition",
    aggregationStrategy: "sum",
    supportedGranularities: ["day", "week", "month"],
    valueType: "cumulative",
    partialDayValuesExpected: true,
    goalsSupported: true,
    recommendedChartType: "bar",
    privacyCategory: "health_nutrition",
    supportedSources: ["apple_health", "meal_log", "manual"],
  });
}

function buildNutritionMetrics() {
  return [
    nutritionMetric({
      key: "calories_consumed",
      displayName: "Calories Consumed",
      description: "Dietary energy consumed.",
      canonicalUnit: "kcal",
      acceptedSourceUnits: ["kcal", "kJ"],
      formatterIdentifier: "energy",
      displayPrecision: 0,
      availability: "currently_available",
    }),
    nutritionMetric({
      key: "protein_consumed",
      displayName: "Protein",
      description: "Dietary protein consumed.",
      canonicalUnit: "g",
      acceptedSourceUnits: ["g"],
      formatterIdentifier: "decimal",
      displayPrecision: 0,
      availability: "currently_available",
    }),
    nutritionMetric({
      key: "carbohydrates_consumed",
      displayName: "Carbohydrates",
      description: "Dietary carbohydrates consumed.",
      canonicalUnit: "g",
      acceptedSourceUnits: ["g"],
      formatterIdentifier: "decimal",
      displayPrecision: 0,
      availability: "currently_available",
    }),
    nutritionMetric({
      key: "fat_consumed",
      displayName: "Fat",
      description: "Dietary fat consumed.",
      canonicalUnit: "g",
      acceptedSourceUnits: ["g"],
      formatterIdentifier: "decimal",
      displayPrecision: 0,
      availability: "currently_available",
    }),
    nutritionMetric({
      key: "fiber_consumed",
      displayName: "Fiber",
      description: "Dietary fiber consumed.",
      canonicalUnit: "g",
      acceptedSourceUnits: ["g"],
      formatterIdentifier: "decimal",
      displayPrecision: 0,
      availability: "currently_available",
    }),
    nutritionMetric({
      key: "water_consumed",
      displayName: "Water",
      description: "Volume of water consumed.",
      canonicalUnit: "ml",
      acceptedSourceUnits: ["ml", "L"],
      formatterIdentifier: "volume",
      displayPrecision: 0,
      availability: "source_dependent",
    }),
  ] as const;
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] ?? left.length;
}
