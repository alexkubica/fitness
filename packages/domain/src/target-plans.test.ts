import { describe, expect, it } from "vitest";
import {
  assertLocalDate,
  calculateTargetRecommendation,
  compareTargetPlans,
  localDateInTimezone,
  targetPlanEffectiveOn,
  type TargetPlan,
  type TargetPlanTargets,
} from "./target-plans.js";

const baseTargets: TargetPlanTargets = {
  maintenanceCalories: 2_500,
  selectedCalories: 2_100,
  proteinGrams: 140,
  carbohydratesGrams: 220,
  fatGrams: 70,
  fiberGrams: 30,
  steps: 8_000,
};

describe("target plan domain", () => {
  it("calculates deterministic recommendations without creating a plan", () => {
    const first = calculateTargetRecommendation({
      currentWeightKg: 80,
      goal: "lose_weight",
      estimatedMaintenanceCalories: 2_600,
      averageSteps: 8_000,
      trainingFrequency: 3,
      desiredWeeklyWeightChangeKg: -0.4,
    });
    const second = calculateTargetRecommendation({
      currentWeightKg: 80,
      goal: "lose_weight",
      estimatedMaintenanceCalories: 2_600,
      averageSteps: 8_000,
      trainingFrequency: 3,
      desiredWeeklyWeightChangeKg: -0.4,
    });

    expect(first).toEqual(second);
    expect(first.calculationVersion).toBe("target-recommendation-v1");
    expect(first.targets.selectedCalories).toBeLessThan(2_600);
    expect(first.targets.proteinGrams).toBe(145);
    expect(first.targets.steps).toBe(9_000);
    expect(first).not.toHaveProperty("status");
  });

  it("preserves manual optional targets in recommendations", () => {
    const recommendation = calculateTargetRecommendation({
      currentWeightKg: 70,
      goal: "maintain",
      existingTargets: {
        ...baseTargets,
        waterMl: 2_500,
        targetWeightKg: 68,
        targetDate: "2026-12-01",
      },
    });

    expect(recommendation.targets.waterMl).toBe(2_500);
    expect(recommendation.targets.targetWeightKg).toBe(68);
    expect(recommendation.targets.targetDate).toBe("2026-12-01");
  });

  it("compares every changed target with canonical metric metadata", () => {
    const comparison = compareTargetPlans(baseTargets, {
      ...baseTargets,
      selectedCalories: 2_000,
      proteinGrams: 155,
      steps: 10_000,
    });

    expect(comparison).toEqual([
      expect.objectContaining({
        metricKey: "calories_consumed",
        displayLabel: "Calories",
        currentValue: 2_100,
        proposedValue: 2_000,
        absoluteDifference: -100,
        direction: "decreased",
      }),
      expect.objectContaining({
        metricKey: "protein_consumed",
        currentValue: 140,
        proposedValue: 155,
        direction: "increased",
      }),
      expect.objectContaining({
        metricKey: "steps",
        currentValue: 8_000,
        proposedValue: 10_000,
        percentageDifference: 25,
      }),
    ]);
  });

  it("resolves historical plans with an exclusive effectiveUntil boundary", () => {
    const plans = [
      plan({
        version: 1,
        effectiveFrom: "2026-01-01",
        effectiveUntil: "2026-07-01",
        status: "superseded",
      }),
      plan({ version: 2, effectiveFrom: "2026-07-01", status: "active" }),
    ];

    expect(targetPlanEffectiveOn(plans, "2026-06-30")?.version).toBe(1);
    expect(targetPlanEffectiveOn(plans, "2026-07-01")?.version).toBe(2);
  });

  it("uses timezone-local dates at UTC boundaries", () => {
    const instant = new Date("2026-07-01T21:30:00.000Z");

    expect(localDateInTimezone(instant, "Asia/Jerusalem")).toBe("2026-07-02");
    expect(localDateInTimezone(instant, "America/Los_Angeles")).toBe(
      "2026-07-01",
    );
  });

  it("rejects invalid local dates", () => {
    expect(() => assertLocalDate("2026-02-30")).toThrow(/valid calendar/);
    expect(() => assertLocalDate("2026-7-1")).toThrow(/YYYY-MM-DD/);
  });
});

function plan(
  overrides: Partial<TargetPlan> &
    Pick<TargetPlan, "version" | "effectiveFrom" | "status">,
): TargetPlan {
  return {
    id: `plan-${overrides.version}`,
    profileId: "profile-1",
    version: overrides.version,
    goal: "lose_weight",
    status: overrides.status,
    calculationMode: "manual",
    effectiveFrom: overrides.effectiveFrom,
    effectiveUntil: overrides.effectiveUntil,
    createdByUserId: "user-1",
    source: "test",
    reason: "Test plan",
    targets: baseTargets,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
