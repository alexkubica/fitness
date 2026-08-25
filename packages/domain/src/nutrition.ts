export type NutritionGoal = "lose_weight" | "maintain" | "gain_mass";

export type NutritionTargetInput = Readonly<{
  goal: NutritionGoal;
  weightKg: number;
  estimatedStepsPerDay: number;
  estimatedActiveCaloriesPerDay?: number | undefined;
  estimatedRestingCaloriesPerDay?: number | undefined;
}>;

export type CalculatedNutritionTargets = Readonly<{
  maintenanceCalories: number;
  loseCalories: number;
  maintainCalories: number;
  gainCalories: number;
  selectedCalories: number;
  proteinGrams: number;
  fatGrams: number;
  carbsGrams: number;
  fiberGrams: number;
}>;

export function calculateNutritionTargets(
  input: NutritionTargetInput,
): CalculatedNutritionTargets {
  const maintenance = maintenanceCalories(input);
  const lose = Math.max(1_500, roundToNearest(maintenance - 500, 50));
  const maintain = maintenance;
  const gain = roundToNearest(maintenance + 400, 50);
  const selected =
    input.goal === "lose_weight"
      ? lose
      : input.goal === "gain_mass"
        ? gain
        : maintain;
  const proteinMultiplier = input.goal === "maintain" ? 1.6 : 1.8;
  const protein = roundToNearest(
    Math.round(input.weightKg * proteinMultiplier),
    5,
  );
  const fat = Math.min(
    90,
    Math.max(50, roundToNearest(Math.round(input.weightKg * 0.7), 5)),
  );
  const fiber = 30;
  const carbCalories = Math.max(0, selected - protein * 4 - fat * 9);
  const carbs = Math.max(80, roundToNearest(Math.round(carbCalories / 4), 5));

  return {
    maintenanceCalories: maintenance,
    loseCalories: lose,
    maintainCalories: maintain,
    gainCalories: gain,
    selectedCalories: selected,
    proteinGrams: protein,
    fatGrams: fat,
    carbsGrams: carbs,
    fiberGrams: fiber,
  };
}

function maintenanceCalories(input: NutritionTargetInput): number {
  const observedTotal =
    observedEnergyTotal(
      input.estimatedRestingCaloriesPerDay,
      input.estimatedActiveCaloriesPerDay,
    ) ?? undefined;
  const stepEstimate = stepBasedMaintenanceCalories(
    input.weightKg,
    input.estimatedStepsPerDay,
  );

  if (observedTotal === undefined) {
    return stepEstimate;
  }

  const cappedObserved = Math.min(4_200, Math.max(1_600, observedTotal));
  const conservativeBlend = cappedObserved * 0.7 + stepEstimate * 0.3;

  return Math.min(
    4_000,
    Math.max(1_600, roundToNearest(Math.round(conservativeBlend), 50)),
  );
}

function observedEnergyTotal(
  resting: number | undefined,
  active: number | undefined,
): number | undefined {
  if (
    resting === undefined ||
    active === undefined ||
    !Number.isFinite(resting) ||
    !Number.isFinite(active) ||
    resting <= 0 ||
    active < 0
  ) {
    return undefined;
  }

  return resting + active;
}

function stepBasedMaintenanceCalories(
  weightKg: number,
  stepsPerDay: number,
): number {
  const base = weightKg * 22;
  const stepBonus = Math.max(0, (stepsPerDay - 3_000) / 1_000) * 55;

  return Math.min(
    3_800,
    Math.max(1_600, roundToNearest(Math.round(base + stepBonus), 50)),
  );
}

function roundToNearest(value: number, interval: number): number {
  return Math.round(value / interval) * interval;
}
