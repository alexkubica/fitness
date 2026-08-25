import { describe, expect, it } from "vitest";
import {
  DailyMealPlanWriteConflictError,
  createNeonDailyMealPlanRepository,
  type DailyMealPlan,
} from "./meal-plans.js";
import type { SqlQueryExecutor } from "./health-samples.js";

describe("Neon daily meal plan repository", () => {
  it("reads a profile-owned plan with immutable ingredient snapshots", async () => {
    const sql = createFakeSql([[planRow()]]);
    const repository = createNeonDailyMealPlanRepository(sql);

    const plan = await repository.getPlan(PROFILE_ID, "2026-07-15");

    expect(plan).toMatchObject({
      id: PLAN_ID,
      profileId: PROFILE_ID,
      localFoodDate: "2026-07-15",
      version: 2,
      meals: [
        {
          id: MEAL_ID,
          status: "planned",
          ingredients: [
            {
              id: INGREDIENT_ID,
              displayName: "Greek yogurt",
              totals: { calories: 150, proteinGrams: 20 },
            },
          ],
        },
      ],
    });
    expect(sql.calls[0]?.text).toContain("from daily_meal_plan_documents");
    expect(sql.calls[0]?.values).toContain(PROFILE_ID);
  });

  it("atomically replaces a versioned plan document", async () => {
    const sql = createFakeSql([[{ id: PLAN_ID }], [planRow({ version: 3 })]]);
    const repository = createNeonDailyMealPlanRepository(sql);
    const plan = dailyMealPlan();

    const saved = await repository.savePlan({ plan, expectedVersion: 2 });

    expect(saved.version).toBe(3);
    expect(sql.calls[0]?.text).toContain(
      "on conflict (profile_id, local_food_date)",
    );
    expect(sql.calls[0]?.text).toContain("daily_meal_plans.version + 1");
    expect(sql.calls[0]?.text).toContain("delete from planned_meals");
    expect(sql.calls[0]?.text).toContain(
      "insert into planned_meal_ingredients",
    );
    expect(sql.calls[0]?.values).toContain(2);
    expect(sql.calls[1]?.text).toContain("daily_meal_plan_documents");
  });

  it("returns a structured version conflict when no plan row is written", async () => {
    const repository = createNeonDailyMealPlanRepository(createFakeSql([[]]));

    await expect(
      repository.savePlan({ plan: dailyMealPlan(), expectedVersion: 1 }),
    ).rejects.toMatchObject({
      code: "MEAL_PLAN_VERSION_CONFLICT",
      profileId: PROFILE_ID,
      planId: PLAN_ID,
      expectedVersion: 1,
    } satisfies Partial<DailyMealPlanWriteConflictError>);
  });

  it("deletes only a matching draft version", async () => {
    const sql = createFakeSql([[{ id: PLAN_ID }], []]);
    const repository = createNeonDailyMealPlanRepository(sql);

    await expect(
      repository.deleteDraftPlan({
        profileId: PROFILE_ID,
        planId: PLAN_ID,
        expectedVersion: 2,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.deleteDraftPlan({
        profileId: PROFILE_ID,
        planId: PLAN_ID,
        expectedVersion: 1,
      }),
    ).resolves.toBe(false);
    expect(sql.calls[0]?.text).toContain("status = 'draft'");
  });
});

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const MEAL_ID = "33333333-3333-4333-8333-333333333333";
const INGREDIENT_ID = "44444444-4444-4444-8444-444444444444";

function dailyMealPlan(): DailyMealPlan {
  return {
    id: PLAN_ID,
    profileId: PROFILE_ID,
    localFoodDate: "2026-07-15",
    timezone: "Asia/Jerusalem",
    status: "active",
    title: "Wednesday plan",
    createdByUserId: "user_alex",
    idempotencyKey: "plan-2026-07-15",
    meals: [],
    createdAt: "2026-07-14T18:00:00.000Z",
    updatedAt: "2026-07-15T08:00:00.000Z",
    version: 2,
  };
}

function planRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PLAN_ID,
    profile_id: PROFILE_ID,
    local_food_date: "2026-07-15",
    timezone: "Asia/Jerusalem",
    status: "active",
    title: "Wednesday plan",
    note: null,
    created_by_user_id: "user_alex",
    idempotency_key: "plan-2026-07-15",
    version: 2,
    created_at: new Date("2026-07-14T18:00:00.000Z"),
    updated_at: new Date("2026-07-15T08:00:00.000Z"),
    meals: [
      {
        id: MEAL_ID,
        dailyMealPlanId: PLAN_ID,
        profileId: PROFILE_ID,
        mealSlotId: "breakfast",
        mealType: "Breakfast",
        plannedTime: "08:00",
        title: "Yogurt bowl",
        description: "Breakfast",
        instructions: "Mix and serve",
        status: "planned",
        linkedMealLogId: null,
        replacementReason: null,
        coachNote: null,
        alternativeGroup: null,
        sortOrder: 0,
        version: 1,
        createdAt: "2026-07-14T18:00:00.000Z",
        updatedAt: "2026-07-14T18:00:00.000Z",
        ingredients: [
          {
            id: INGREDIENT_ID,
            plannedMealId: MEAL_ID,
            foodReferenceType: "saved_template",
            foodReferenceId: "template-yogurt",
            displayName: "Greek yogurt",
            quantity: 200,
            unit: "g",
            grams: 200,
            calories: 150,
            proteinGrams: 20,
            carbsGrams: 8,
            fatGrams: 4,
            fiberGrams: 0,
            alternativeGroup: null,
            notes: null,
            sortOrder: 0,
            createdAt: "2026-07-14T18:00:00.000Z",
            updatedAt: "2026-07-14T18:00:00.000Z",
          },
        ],
      },
    ],
    ...overrides,
  };
}

function createFakeSql(
  rowsByCall: readonly (readonly Record<string, unknown>[])[],
): SqlQueryExecutor & {
  calls: { text: string; values: readonly unknown[] }[];
} {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const sql = (async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<readonly Record<string, unknown>[]> => {
    calls.push({ text: templateText(strings, values.length), values });
    return rowsByCall[calls.length - 1] ?? [];
  }) as SqlQueryExecutor & {
    calls: { text: string; values: readonly unknown[] }[];
  };
  sql.calls = calls;
  return sql;
}

function templateText(
  strings: TemplateStringsArray,
  valueCount: number,
): string {
  return strings.reduce(
    (text, chunk, index) =>
      `${text}${chunk}${index < valueCount ? `$${index + 1}` : ""}`,
    "",
  );
}
