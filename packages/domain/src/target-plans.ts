import { getMetricDefinition } from "./metric-registry.js";
import type { NutritionGoal } from "./nutrition.js";

export const TARGET_PLAN_STATUSES = [
  "draft",
  "proposed",
  "active",
  "rejected",
  "superseded",
  "archived",
] as const;
export type TargetPlanStatus = (typeof TARGET_PLAN_STATUSES)[number];

export const TARGET_PLAN_CALCULATION_MODES = [
  "automatic",
  "manual",
  "coach_manual",
  "imported_legacy",
] as const;
export type TargetPlanCalculationMode =
  (typeof TARGET_PLAN_CALCULATION_MODES)[number];

export type TargetPlanTargets = Readonly<{
  maintenanceCalories: number;
  selectedCalories: number;
  proteinGrams: number;
  carbohydratesGrams: number;
  fatGrams: number;
  fiberGrams: number;
  steps: number;
  waterMl?: number | undefined;
  workoutsPerWeek?: number | undefined;
  targetWeightKg?: number | undefined;
  targetDate?: string | undefined;
}>;

export type TargetPlan = Readonly<{
  id: string;
  profileId: string;
  version: number;
  goal: NutritionGoal;
  status: TargetPlanStatus;
  calculationMode: TargetPlanCalculationMode;
  effectiveFrom: string;
  effectiveUntil?: string | undefined;
  createdByUserId: string;
  creatorRelationship?: string | undefined;
  source: string;
  reason: string;
  ownerResponse?: string | undefined;
  targets: TargetPlanTargets;
  createdAt: string;
  updatedAt: string;
}>;

export type TargetRecommendationInput = Readonly<{
  currentWeightKg?: number | undefined;
  goal: NutritionGoal;
  estimatedMaintenanceCalories?: number | undefined;
  activityLevel?: "sedentary" | "light" | "moderate" | "high" | undefined;
  averageSteps?: number | undefined;
  trainingFrequency?: number | undefined;
  desiredWeeklyWeightChangeKg?: number | undefined;
  existingTargets?: TargetPlanTargets | undefined;
}>;

export type TargetRecommendation = Readonly<{
  targets: TargetPlanTargets;
  explanation: readonly string[];
  warnings: readonly string[];
  calculationVersion: "target-recommendation-v1";
}>;

export type TargetComparisonMetric = Readonly<{
  targetKey: keyof TargetPlanTargets;
  metricKey: string;
  displayLabel: string;
  currentValue: number | string | null;
  proposedValue: number | string | null;
  unit: string;
  absoluteDifference?: number | undefined;
  percentageDifference?: number | undefined;
  direction: "increased" | "decreased" | "changed" | "added" | "removed";
}>;

const targetMetadata = {
  maintenanceCalories: metadata(
    "maintenance_calories",
    "Maintenance Calories",
    "kcal",
  ),
  selectedCalories: metricMetadata("calories_consumed", "Calories"),
  proteinGrams: metricMetadata("protein_consumed"),
  carbohydratesGrams: metricMetadata("carbohydrates_consumed"),
  fatGrams: metricMetadata("fat_consumed"),
  fiberGrams: metricMetadata("fiber_consumed"),
  steps: metricMetadata("steps"),
  waterMl: metricMetadata("water_consumed"),
  workoutsPerWeek: metricMetadata("workout_count", "Workouts per Week"),
  targetWeightKg: metricMetadata("weight", "Target Weight"),
  targetDate: metadata("target_date", "Target Date", "date"),
} satisfies Record<
  keyof TargetPlanTargets,
  Readonly<{ metricKey: string; displayLabel: string; unit: string }>
>;

export function calculateTargetRecommendation(
  input: TargetRecommendationInput,
): TargetRecommendation {
  const warnings: string[] = [];
  const explanation: string[] = [];
  const weight = bounded(input.currentWeightKg ?? 75, 35, 250);
  const averageSteps = bounded(input.averageSteps ?? 7_000, 0, 50_000);
  const trainingFrequency = bounded(input.trainingFrequency ?? 0, 0, 14);
  const activityLevel = input.activityLevel ?? inferActivityLevel(averageSteps);
  const maintenance =
    Math.round(
      bounded(
        input.estimatedMaintenanceCalories ??
          weight * activityMultiplier(activityLevel),
        1_400,
        5_000,
      ) / 50,
    ) * 50;
  const requestedRate = input.desiredWeeklyWeightChangeKg;
  const defaultRate = input.goal === "lose_weight" ? -0.4 : 0.25;
  const weeklyRate = bounded(
    requestedRate ?? (input.goal === "maintain" ? 0 : defaultRate),
    -1,
    0.75,
  );
  const calorieAdjustment = Math.round((weeklyRate * 7_700) / 7 / 50) * 50;
  const selectedCalories =
    Math.round(
      bounded(
        input.goal === "maintain"
          ? maintenance
          : maintenance + calorieAdjustment,
        1_500,
        4_500,
      ) / 50,
    ) * 50;
  const proteinMultiplier =
    input.goal === "lose_weight" || trainingFrequency >= 3 ? 1.8 : 1.6;
  const proteinGrams = roundTo(weight * proteinMultiplier, 5);
  const fatGrams = roundTo(bounded((selectedCalories * 0.27) / 9, 45, 120), 5);
  const carbohydratesGrams = roundTo(
    Math.max(80, (selectedCalories - proteinGrams * 4 - fatGrams * 9) / 4),
    5,
  );
  const steps = roundTo(
    bounded(
      Math.max(averageSteps, input.existingTargets?.steps ?? 0) + 1_000,
      5_000,
      15_000,
    ),
    500,
  );

  explanation.push(
    `Maintenance is estimated at ${maintenance} kcal using ${activityLevel} activity.`,
    `Calories reflect a ${weeklyRate.toFixed(2)} kg/week requested weight-change rate.`,
    `Protein uses ${proteinMultiplier.toFixed(1)} g/kg and remaining calories are split between fat and carbohydrates.`,
    `Steps are based on the higher of recent activity and the existing target, increased gradually.`,
  );

  if (input.estimatedMaintenanceCalories === undefined) {
    warnings.push(
      "Maintenance calories are estimated from weight and activity level because observed maintenance was not supplied.",
    );
  }
  if (requestedRate !== undefined && requestedRate !== weeklyRate) {
    warnings.push(
      "The requested rate was capped to the supported range of -1.0 to +0.75 kg per week.",
    );
  }
  if (input.currentWeightKg === undefined) {
    warnings.push(
      "Current weight was unavailable; a neutral 75 kg assumption was used.",
    );
  }

  return {
    targets: {
      maintenanceCalories: maintenance,
      selectedCalories,
      proteinGrams,
      carbohydratesGrams,
      fatGrams,
      fiberGrams: selectedCalories >= 2_400 ? 35 : 30,
      steps,
      ...(input.existingTargets?.waterMl === undefined
        ? {}
        : { waterMl: input.existingTargets.waterMl }),
      ...(trainingFrequency <= 0
        ? {}
        : { workoutsPerWeek: Math.round(trainingFrequency) }),
      ...(input.existingTargets?.targetWeightKg === undefined
        ? {}
        : { targetWeightKg: input.existingTargets.targetWeightKg }),
      ...(input.existingTargets?.targetDate === undefined
        ? {}
        : { targetDate: input.existingTargets.targetDate }),
    },
    explanation,
    warnings,
    calculationVersion: "target-recommendation-v1",
  };
}

export function compareTargetPlans(
  current: TargetPlanTargets,
  proposed: TargetPlanTargets,
): readonly TargetComparisonMetric[] {
  return (Object.keys(targetMetadata) as (keyof TargetPlanTargets)[]).flatMap(
    (targetKey) => {
      const currentValue = current[targetKey] ?? null;
      const proposedValue = proposed[targetKey] ?? null;

      if (currentValue === proposedValue) return [];

      const meta = targetMetadata[targetKey];
      const numeric =
        typeof currentValue === "number" && typeof proposedValue === "number";
      const difference = numeric ? proposedValue - currentValue : undefined;
      const percentage =
        difference !== undefined &&
        typeof currentValue === "number" &&
        currentValue !== 0
          ? Math.round((difference / Math.abs(currentValue)) * 1_000) / 10
          : undefined;

      return [
        {
          targetKey,
          metricKey: meta.metricKey,
          displayLabel: meta.displayLabel,
          currentValue,
          proposedValue,
          unit: meta.unit,
          ...(difference === undefined
            ? {}
            : { absoluteDifference: round(difference) }),
          ...(percentage === undefined
            ? {}
            : { percentageDifference: percentage }),
          direction:
            currentValue === null
              ? "added"
              : proposedValue === null
                ? "removed"
                : difference === undefined
                  ? "changed"
                  : difference > 0
                    ? "increased"
                    : "decreased",
        },
      ];
    },
  );
}

export function targetPlanEffectiveOn(
  plans: readonly TargetPlan[],
  localDate: string,
): TargetPlan | undefined {
  assertLocalDate(localDate);
  return plans
    .filter(
      (plan) =>
        (plan.status === "active" || plan.status === "superseded") &&
        plan.effectiveFrom <= localDate &&
        (plan.effectiveUntil === undefined || localDate < plan.effectiveUntil),
    )
    .sort((left, right) => right.version - left.version)[0];
}

export function localDateInTimezone(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

export function assertTargetPlanTargets(targets: TargetPlanTargets): void {
  for (const [key, value] of Object.entries(targets)) {
    if (key === "targetDate") {
      if (value !== undefined) assertLocalDate(String(value));
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`Target ${key} must be a non-negative finite number.`);
    }
  }
  if (targets.selectedCalories < 1_000 || targets.selectedCalories > 6_000) {
    throw new Error("Selected calories must be between 1000 and 6000 kcal.");
  }
  if (
    targets.maintenanceCalories < 1_000 ||
    targets.maintenanceCalories > 7_000
  ) {
    throw new Error("Maintenance calories must be between 1000 and 7000 kcal.");
  }
  if (targets.steps > 100_000) {
    throw new Error("Steps must not exceed 100000.");
  }
}

export function assertLocalDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Effective dates must use YYYY-MM-DD local-date format.");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Effective date is not a valid calendar date.");
  }
}

function metricMetadata(metricKey: string, displayLabel?: string) {
  const metric = getMetricDefinition(metricKey);
  return metadata(
    metric.key,
    displayLabel ?? metric.displayName,
    metric.canonicalUnit,
  );
}

function metadata(metricKey: string, displayLabel: string, unit: string) {
  return { metricKey, displayLabel, unit } as const;
}

function inferActivityLevel(steps: number) {
  if (steps >= 12_000) return "high" as const;
  if (steps >= 8_000) return "moderate" as const;
  if (steps >= 5_000) return "light" as const;
  return "sedentary" as const;
}

function activityMultiplier(
  level: "sedentary" | "light" | "moderate" | "high",
) {
  switch (level) {
    case "sedentary":
      return 27;
    case "light":
      return 30;
    case "moderate":
      return 33;
    case "high":
      return 36;
  }
}

function bounded(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundTo(value: number, interval: number) {
  return Math.round(value / interval) * interval;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
