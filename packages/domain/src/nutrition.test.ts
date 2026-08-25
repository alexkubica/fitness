import { describe, expect, it } from "vitest";
import { calculateNutritionTargets } from "./nutrition.js";

describe("nutrition target calculator", () => {
  it("calculates the shared lose/maintain/gain calorie and macro targets", () => {
    expect(
      calculateNutritionTargets({
        goal: "lose_weight",
        weightKg: 87.5,
        estimatedStepsPerDay: 11_500,
      }),
    ).toEqual({
      maintenanceCalories: 2400,
      loseCalories: 1900,
      maintainCalories: 2400,
      gainCalories: 2800,
      selectedCalories: 1900,
      proteinGrams: 160,
      fatGrams: 60,
      carbsGrams: 180,
      fiberGrams: 30,
    });
  });

  it("uses observed active and resting energy conservatively when provided", () => {
    expect(
      calculateNutritionTargets({
        goal: "lose_weight",
        weightKg: 87.5,
        estimatedStepsPerDay: 11_500,
        estimatedActiveCaloriesPerDay: 900,
        estimatedRestingCaloriesPerDay: 2_100,
      }),
    ).toMatchObject({
      maintenanceCalories: 2800,
      loseCalories: 2300,
      maintainCalories: 2800,
      gainCalories: 3200,
      selectedCalories: 2300,
    });
  });
});
