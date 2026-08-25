import { describe, expect, it } from "vitest";
import { createInMemoryMealLogService } from "./meals.js";
import {
  createInMemoryMealPlanService,
  createVersionedMealPlanTargetProvider,
  type MealPlanAccessContext,
  type MealPlanService,
  type PlannedMealDraft,
} from "./meal-plans.js";
import { createInMemoryProfileService } from "./profiles.js";
import { createInMemoryTargetPlanService } from "./target-plans.js";

describe("daily meal plan service", () => {
  it("creates a profile-owned plan and calculates planned remaining targets", async () => {
    const { plans } = services();

    const created = await createBreakfast(plans, ACCESS);

    expect(created.plan).toMatchObject({
      profileId: "profile_alex",
      localFoodDate: "2026-07-15",
      timezone: "Asia/Jerusalem",
      status: "active",
      version: 1,
    });
    expect(created.plannedTotals).toEqual({
      calories: 350,
      proteinGrams: 28,
      carbsGrams: 45,
      fatGrams: 8,
      fiberGrams: 6,
    });
    expect(created.effectiveTargets).toMatchObject({ calories: 2_000 });
    expect(created.plannedRemaining).toEqual({
      calories: 1_650,
      proteinGrams: 122,
      carbsGrams: 175,
      fatGrams: 62,
      fiberGrams: 24,
    });
  });

  it("uses the effective versioned target for the plan date", async () => {
    const profiles = createInMemoryProfileService();
    const context = await profiles.requireProfileContext("user_alex");
    const targetPlans = createInMemoryTargetPlanService();
    await targetPlans.activateCompatibility(context, {
      goal: "lose_weight",
      calculationMode: "coach_manual",
      effectiveFrom: "2026-07-15",
      reason: "Date-aware target",
      targets: {
        maintenanceCalories: 2_400,
        selectedCalories: 1_850,
        proteinGrams: 160,
        carbohydratesGrams: 190,
        fatGrams: 60,
        fiberGrams: 32,
        steps: 10_000,
      },
    });
    const provider = createVersionedMealPlanTargetProvider(
      targetPlans,
      profiles,
    );

    await expect(
      provider.getTargetsForDate({
        subjectUserId: "user_alex",
        profileId: context.profileId,
        localFoodDate: "2026-07-15",
      }),
    ).resolves.toEqual({
      calories: 1_850,
      proteinGrams: 160,
      carbsGrams: 190,
      fatGrams: 60,
      fiberGrams: 32,
    });
  });

  it("keeps planned data out of actual meal logs and actual intake", async () => {
    const { meals, plans } = services();
    await createBreakfast(plans, ACCESS);

    await expect(
      meals.listMeals({
        userId: ACCESS.subjectUserId,
        profileId: ACCESS.profileId,
        limit: 100,
      }),
    ).resolves.toEqual([]);
  });

  it("updates a populated plan only with version and explicit replacement", async () => {
    const { plans } = services();
    const created = await createBreakfast(plans, ACCESS);

    await expect(
      plans.upsertDailyPlan({
        access: ACCESS,
        localFoodDate: "2026-07-15",
        timezone: "Asia/Jerusalem",
        meals: [breakfastDraft({ title: "Changed breakfast" })],
        idempotencyKey: "update-without-confirmation",
        expectedVersion: created.plan.version,
      }),
    ).rejects.toMatchObject({ code: "MEAL_PLAN_CONFIRMATION_REQUIRED" });

    const updated = await plans.upsertDailyPlan({
      access: ACCESS,
      localFoodDate: "2026-07-15",
      timezone: "Asia/Jerusalem",
      meals: [breakfastDraft({ title: "Changed breakfast" })],
      idempotencyKey: "update-with-confirmation",
      expectedVersion: created.plan.version,
      confirmReplace: true,
    });

    expect(updated.plan.version).toBe(2);
    expect(updated.plan.meals[0]?.title).toBe("Changed breakfast");
  });

  it("rejects stale resource versions", async () => {
    const { plans } = services();
    await createBreakfast(plans, ACCESS);

    await expect(
      plans.archivePlan({
        access: ACCESS,
        localFoodDate: "2026-07-15",
        expectedVersion: 99,
      }),
    ).rejects.toMatchObject({ code: "MEAL_PLAN_VERSION_CONFLICT" });
  });

  it("isolates plans by profile id", async () => {
    const { plans } = services();
    await createBreakfast(plans, ACCESS);
    await createBreakfast(plans, DEPENDENT_ACCESS, "dependent-plan");

    await expect(
      plans.getDailyPlan({
        access: ACCESS,
        localFoodDate: "2026-07-15",
      }),
    ).resolves.toMatchObject({ plan: { profileId: "profile_alex" } });
    await expect(
      plans.getDailyPlan({
        access: DEPENDENT_ACCESS,
        localFoodDate: "2026-07-15",
      }),
    ).resolves.toMatchObject({ plan: { profileId: "profile_dependent" } });
  });

  it("copies one plan without linked logs or consumed statuses", async () => {
    const { plans } = services();
    await createBreakfast(plans, ACCESS);

    const copied = await plans.copyDailyPlan({
      access: ACCESS,
      sourceLocalFoodDate: "2026-07-15",
      destinationLocalFoodDate: "2026-07-16",
      timezone: "Asia/Jerusalem",
      idempotencyKey: "copy-16",
    });

    expect(copied.plan.localFoodDate).toBe("2026-07-16");
    expect(copied.plan.status).toBe("draft");
    expect(copied.plan.meals[0]).toMatchObject({
      title: "Breakfast bowl",
      status: "planned",
      linkedMealLogId: undefined,
    });
    expect(copied.plan.meals[0]?.id).not.toBe(
      (await getPlan(plans, ACCESS, "2026-07-15")).plan.meals[0]?.id,
    );
  });

  it("copies date ranges with stable date offsets and preflights collisions", async () => {
    const { plans } = services();
    await createBreakfast(plans, ACCESS);
    await plans.copyDailyPlan({
      access: ACCESS,
      sourceLocalFoodDate: "2026-07-15",
      destinationLocalFoodDate: "2026-07-16",
      timezone: "Asia/Jerusalem",
      idempotencyKey: "seed-16",
    });

    const copied = await plans.copyPlanRange({
      access: ACCESS,
      sourceFromLocalFoodDate: "2026-07-15",
      sourceToLocalFoodDate: "2026-07-16",
      destinationStartLocalFoodDate: "2026-07-20",
      timezone: "Asia/Jerusalem",
      idempotencyKey: "range-20",
    });

    expect(copied.map((entry) => entry.plan.localFoodDate)).toEqual([
      "2026-07-20",
      "2026-07-21",
    ]);
    await expect(
      plans.copyPlanRange({
        access: ACCESS,
        sourceFromLocalFoodDate: "2026-07-15",
        sourceToLocalFoodDate: "2026-07-16",
        destinationStartLocalFoodDate: "2026-07-20",
        timezone: "Asia/Jerusalem",
        idempotencyKey: "range-collision",
      }),
    ).rejects.toMatchObject({ code: "MEAL_PLAN_CONFIRMATION_REQUIRED" });
  });

  it("converts eaten-as-planned into one actual meal log idempotently", async () => {
    const { meals, plans } = services();
    const created = await createBreakfast(plans, ACCESS);
    const plannedMeal = created.plan.meals[0]!;

    const converted = await plans.convertPlannedMealToLog({
      access: ACCESS,
      plannedMealId: plannedMeal.id,
      status: "confirmed",
      expectedPlanVersion: created.plan.version,
      expectedMealVersion: plannedMeal.version,
      origin: "mcp",
    });
    const replay = await plans.convertPlannedMealToLog({
      access: ACCESS,
      plannedMealId: plannedMeal.id,
      status: "confirmed",
      expectedPlanVersion: created.plan.version,
      expectedMealVersion: plannedMeal.version,
      origin: "mcp",
    });
    const actualMeals = await meals.listMeals({
      userId: ACCESS.subjectUserId,
      profileId: ACCESS.profileId,
      limit: 100,
    });

    expect(converted.plannedMeal).toMatchObject({
      status: "confirmed",
      linkedMealLogId: converted.mealLog.id,
    });
    expect(converted.mealLog.occurredAt).toBe("2026-07-15T05:00:00.000Z");
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.mealLog.id).toBe(converted.mealLog.id);
    expect(actualMeals).toHaveLength(1);
  });

  it("normalizes legacy planned-meal status aliases to canonical names", async () => {
    const { plans } = services();
    const created = await createBreakfast(plans, ACCESS);
    const plannedMeal = created.plan.meals[0]!;

    const converted = await plans.convertPlannedMealToLog({
      access: ACCESS,
      plannedMealId: plannedMeal.id,
      status: "eaten_as_planned",
      expectedPlanVersion: created.plan.version,
      expectedMealVersion: plannedMeal.version,
      origin: "mcp",
    });
    const marked = await plans.markPlannedMealStatus({
      access: ACCESS,
      plannedMealId: converted.plannedMeal.id,
      status: "not_confirmed",
      expectedPlanVersion: converted.plan.version,
      expectedMealVersion: converted.plannedMeal.version,
    });

    expect(converted.plannedMeal.status).toBe("confirmed");
    expect(marked.plannedMeal.status).toBe("unconfirmed");
  });

  it("converts partial quantities while preserving original planned values", async () => {
    const { plans } = services();
    const created = await createBreakfast(plans, ACCESS);
    const plannedMeal = created.plan.meals[0]!;

    const converted = await plans.convertPlannedMealToLog({
      access: ACCESS,
      plannedMealId: plannedMeal.id,
      status: "partially_eaten",
      expectedPlanVersion: created.plan.version,
      expectedMealVersion: plannedMeal.version,
      actualIngredients: [
        {
          displayName: "Breakfast bowl",
          quantity: 0.5,
          unit: "portion",
          totals: {
            calories: 175,
            proteinGrams: 14,
            carbsGrams: 22.5,
            fatGrams: 4,
            fiberGrams: 3,
          },
        },
      ],
      origin: "web",
    });

    expect(converted.mealLog.totals.calories).toBe(175);
    expect(converted.plannedMeal.ingredients[0]?.totals.calories).toBe(350);
    expect(converted.plannedMeal.status).toBe("partially_eaten");
  });

  it("preserves a replaced planned meal and adds its replacement", async () => {
    const { plans } = services();
    const created = await createBreakfast(plans, ACCESS);
    const plannedMeal = created.plan.meals[0]!;

    const replaced = await plans.replacePlannedMeal({
      access: ACCESS,
      plannedMealId: plannedMeal.id,
      expectedPlanVersion: created.plan.version,
      expectedMealVersion: plannedMeal.version,
      replacement: breakfastDraft({ title: "Alternative breakfast" }),
      reason: "No yogurt available",
      confirmReplace: true,
    });

    expect(replaced.originalMeal).toMatchObject({
      id: plannedMeal.id,
      status: "replaced",
      replacementReason: "No yogurt available",
    });
    expect(replaced.replacementMeal).toMatchObject({
      title: "Alternative breakfast",
      status: "planned",
    });
  });

  it("marks skipped without creating a zero-calorie actual meal", async () => {
    const { meals, plans } = services();
    const created = await createBreakfast(plans, ACCESS);
    const plannedMeal = created.plan.meals[0]!;

    const skipped = await plans.markPlannedMealStatus({
      access: ACCESS,
      plannedMealId: plannedMeal.id,
      status: "skipped",
      expectedPlanVersion: created.plan.version,
      expectedMealVersion: plannedMeal.version,
    });

    expect(skipped.plannedMeal.status).toBe("skipped");
    await expect(
      meals.listMeals({
        userId: ACCESS.subjectUserId,
        profileId: ACCESS.profileId,
        limit: 100,
      }),
    ).resolves.toEqual([]);
  });

  it("compares planned, linked actual, targets, changes, and unconfirmed meals", async () => {
    const { plans } = services();
    const created = await createBreakfast(plans, ACCESS);
    const breakfast = created.plan.meals[0]!;
    const converted = await plans.convertPlannedMealToLog({
      access: ACCESS,
      plannedMealId: breakfast.id,
      status: "partially_eaten",
      expectedPlanVersion: created.plan.version,
      expectedMealVersion: breakfast.version,
      actualIngredients: [
        {
          displayName: "Breakfast bowl",
          quantity: 0.5,
          unit: "portion",
          totals: macroTotals({ calories: 175, proteinGrams: 14 }),
        },
      ],
      origin: "mcp",
    });

    const comparison = await plans.comparePlanToActual({
      access: ACCESS,
      localFoodDate: "2026-07-15",
    });

    expect(comparison).toMatchObject({
      planVersion: converted.plan.version,
      plannedTotals: { calories: 350 },
      actualTotals: { calories: 175 },
      plannedRemaining: { calories: 1_650 },
      actualRemaining: { calories: 1_825 },
      counts: { changed: 1, skipped: 0, unconfirmed: 0 },
      meals: [
        {
          status: "partially_eaten",
          linkedMealLogStatus: "linked",
          planned: { calories: 350 },
          actual: { calories: 175 },
          difference: { calories: -175 },
        },
      ],
    });
  });

  it("enforces the supplied fine-grained permission adapter", async () => {
    const meals = createInMemoryMealLogService();
    const plans = createInMemoryMealPlanService({
      meals,
      permissionAdapter: {
        can({ access, permission }) {
          return access.permissions.includes(permission);
        },
      },
    });
    const readOnly = { ...ACCESS, permissions: ["meal.plan.read"] };

    await expect(createBreakfast(plans, readOnly)).rejects.toMatchObject({
      code: "MEAL_PLAN_PERMISSION_DENIED",
      details: { permission: "meal.plan.write" },
    });
  });

  it("deletes draft plans only after explicit confirmation", async () => {
    const { plans } = services();
    const created = await plans.upsertDailyPlan({
      access: ACCESS,
      localFoodDate: "2026-07-17",
      timezone: "Asia/Jerusalem",
      idempotencyKey: "draft-delete",
    });

    await expect(
      plans.deleteDraftPlan({
        access: ACCESS,
        localFoodDate: "2026-07-17",
        expectedVersion: created.plan.version,
        confirmDelete: false,
      }),
    ).rejects.toMatchObject({ code: "MEAL_PLAN_CONFIRMATION_REQUIRED" });
    await expect(
      plans.deleteDraftPlan({
        access: ACCESS,
        localFoodDate: "2026-07-17",
        expectedVersion: created.plan.version,
        confirmDelete: true,
      }),
    ).resolves.toBe(true);
  });
});

const ACCESS: MealPlanAccessContext = {
  actorUserId: "user_alex",
  subjectUserId: "user_alex",
  profileId: "profile_alex",
  permissions: [],
};

const DEPENDENT_ACCESS: MealPlanAccessContext = {
  actorUserId: "user_alex",
  subjectUserId: "user_dependent",
  profileId: "profile_dependent",
  permissions: [],
};

function services() {
  const meals = createInMemoryMealLogService();
  const plans = createInMemoryMealPlanService({
    meals,
    now: () => new Date("2026-07-14T18:00:00.000Z"),
    targets: {
      async getTargetsForDate() {
        return {
          calories: 2_000,
          proteinGrams: 150,
          carbsGrams: 220,
          fatGrams: 70,
          fiberGrams: 30,
        };
      },
    },
  });
  return { meals, plans };
}

async function createBreakfast(
  plans: MealPlanService,
  access: MealPlanAccessContext,
  idempotencyKey = "create-breakfast",
) {
  return plans.upsertDailyPlan({
    access,
    localFoodDate: "2026-07-15",
    timezone: "Asia/Jerusalem",
    status: "active",
    title: "Wednesday plan",
    meals: [breakfastDraft()],
    idempotencyKey,
  });
}

function breakfastDraft(
  overrides: Partial<PlannedMealDraft> = {},
): PlannedMealDraft {
  return {
    mealSlotId: "breakfast",
    mealType: "Breakfast",
    plannedTime: "08:00",
    title: "Breakfast bowl",
    description: "Yogurt, oats, and fruit",
    instructions: "Mix and serve",
    ingredients: [
      {
        displayName: "Breakfast bowl",
        quantity: 1,
        unit: "portion",
        grams: 350,
        totals: {
          calories: 350,
          proteinGrams: 28,
          carbsGrams: 45,
          fatGrams: 8,
          fiberGrams: 6,
        },
      },
    ],
    ...overrides,
  };
}

function macroTotals(
  overrides: Partial<{
    calories: number;
    proteinGrams: number;
    carbsGrams: number;
    fatGrams: number;
    fiberGrams: number;
  }>,
) {
  return {
    calories: 0,
    proteinGrams: 0,
    carbsGrams: 0,
    fatGrams: 0,
    fiberGrams: 0,
    ...overrides,
  };
}

async function getPlan(
  plans: MealPlanService,
  access: MealPlanAccessContext,
  localFoodDate: string,
) {
  const plan = await plans.getDailyPlan({ access, localFoodDate });
  if (plan === undefined) throw new Error("Expected meal plan.");
  return plan;
}
