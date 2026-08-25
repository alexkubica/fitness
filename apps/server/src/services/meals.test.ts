import type { MealLog, MealLogInput } from "@fitness/db";
import { describe, expect, it } from "vitest";
import {
  createInMemoryMealLogService,
  createSnapshottingMealLogService,
  isMissingSnapshotInfrastructure,
  type MealLogSnapshotService,
} from "./meals.js";

describe("snapshotting meal log service", () => {
  it("does not block meal mutations when snapshot table is missing", async () => {
    const baseMeals = createInMemoryMealLogService([seedMeal]);
    const meals = createSnapshottingMealLogService(
      baseMeals,
      missingSnapshotTableService(),
    );

    const updated = await meals.upsertMeal({
      ...mealInput("existing-meal"),
      idempotencyKey: "existing-meal-update",
      title: "Updated milk",
      totals: {
        calories: 130,
        proteinGrams: 9,
        carbsGrams: 12,
        fatGrams: 5,
        fiberGrams: 0,
      },
    });
    const deleted = await meals.deleteMeal({
      userId: "user_alex",
      id: updated.id,
      deletedAt: "2026-06-26T10:00:00.000Z",
    });

    expect(updated.title).toBe("Updated milk");
    expect(deleted?.title).toBe("Updated milk");
    await expect(
      meals.listMeals({ userId: "user_alex", limit: 10 }),
    ).resolves.toEqual([]);
  });

  it("updates an existing meal by origin and clientMealId with a new idempotency key", async () => {
    const meals = createInMemoryMealLogService([seedMeal]);

    const result = await meals.upsertMealWithResult({
      ...mealInput("existing-meal"),
      idempotencyKey: "new-operation-key",
      title: "Updated milk",
      totals: {
        calories: 130,
        proteinGrams: 9,
        carbsGrams: 12,
        fatGrams: 5,
        fiberGrams: 0,
      },
    });
    const listed = await meals.listMeals({ userId: "user_alex", limit: 10 });

    expect(result.operation).toBe("updated");
    expect(result.mealId).toBe("server-meal-id");
    expect(result.meal.title).toBe("Updated milk");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: "server-meal-id",
      clientMealId: "existing-meal",
      idempotencyKey: "new-operation-key",
      title: "Updated milk",
    });
  });

  it("replays the original result for the same idempotency key without updating", async () => {
    const meals = createInMemoryMealLogService([seedMeal]);

    const result = await meals.upsertMealWithResult({
      ...mealInput("different-client-meal"),
      idempotencyKey: "existing-meal",
      title: "Should not replace",
      totals: {
        calories: 999,
        proteinGrams: 99,
        carbsGrams: 99,
        fatGrams: 99,
        fiberGrams: 99,
      },
    });
    const listed = await meals.listMeals({ userId: "user_alex", limit: 10 });

    expect(result.operation).toBe("unchanged");
    expect(result.mealId).toBe("server-meal-id");
    expect(result.meal.title).toBe("Milk");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe("Milk");
  });

  it("does not create duplicate meals during concurrent retries with one clientMealId", async () => {
    const meals = createInMemoryMealLogService();
    const [created, updated] = await Promise.all([
      meals.upsertMealWithResult(mealInput("retry-meal")),
      meals.upsertMealWithResult({
        ...mealInput("retry-meal"),
        idempotencyKey: "retry-meal-second-attempt",
        title: "Retry meal corrected",
      }),
    ]);
    const listed = await meals.listMeals({ userId: "user_alex", limit: 10 });

    expect(new Set([created.mealId, updated.mealId]).size).toBe(1);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.clientMealId).toBe("retry-meal");
  });

  it("creates rollback snapshots for clientMealId updates but not idempotent replays", async () => {
    const recorder = recordingSnapshotService();
    const meals = createSnapshottingMealLogService(
      createInMemoryMealLogService([seedMeal]),
      recorder.service,
    );

    const updated = await meals.upsertMealWithResult({
      ...mealInput("existing-meal"),
      idempotencyKey: "snapshot-update-key",
      title: "Updated milk",
    });
    const replay = await meals.upsertMealWithResult({
      ...mealInput("anything"),
      idempotencyKey: "snapshot-update-key",
      title: "Should replay update",
    });

    expect(updated.operation).toBe("updated");
    expect(replay.operation).toBe("unchanged");
    expect(replay.meal.title).toBe("Updated milk");
    expect(recorder.snapshots).toHaveLength(1);
    expect(recorder.snapshots[0]).toMatchObject({
      operationType: "upsert_update",
      beforeState: {
        meals: [expect.objectContaining({ title: "Milk" })],
      },
      afterState: {
        meals: [expect.objectContaining({ title: "Updated milk" })],
      },
    });
  });

  it("recognizes missing meal snapshot infrastructure errors", () => {
    expect(
      isMissingSnapshotInfrastructure({
        code: "42P01",
      }),
    ).toBe(true);
    expect(
      isMissingSnapshotInfrastructure({
        message: 'relation "meal_log_snapshots" does not exist',
      }),
    ).toBe(true);
    expect(isMissingSnapshotInfrastructure(new Error("other"))).toBe(false);
  });
});

const seedMeal: MealLog = {
  id: "server-meal-id",
  userId: "user_alex",
  idempotencyKey: "existing-meal",
  clientMealId: "existing-meal",
  occurredAt: "2026-06-26T09:00:00.000Z",
  timezone: "Asia/Jerusalem",
  title: "Milk",
  mealType: "Meal",
  note: "",
  totals: {
    calories: 120,
    proteinGrams: 8,
    carbsGrams: 12,
    fatGrams: 5,
    fiberGrams: 0,
  },
  ingredients: [],
  photoCount: 0,
  estimateStatus: "manual",
  origin: "mcp",
  createdAt: "2026-06-26T09:00:00.000Z",
  updatedAt: "2026-06-26T09:00:00.000Z",
};

function mealInput(clientMealId: string): MealLogInput {
  return {
    userId: "user_alex",
    idempotencyKey: clientMealId,
    clientMealId,
    occurredAt: "2026-06-26T09:00:00.000Z",
    timezone: "Asia/Jerusalem",
    title: "Milk",
    mealType: "Meal",
    totals: {
      calories: 120,
      proteinGrams: 8,
      carbsGrams: 12,
      fatGrams: 5,
      fiberGrams: 0,
    },
    ingredients: [],
    photoCount: 0,
    estimateStatus: "manual",
    origin: "mcp",
  };
}

function missingSnapshotTableService(): MealLogSnapshotService {
  return {
    async createSnapshot() {
      throw {
        code: "42P01",
        message: 'relation "meal_log_snapshots" does not exist',
      };
    },
    async getSnapshot() {
      return undefined;
    },
    async listSnapshots() {
      return [];
    },
  };
}

function recordingSnapshotService(): {
  service: MealLogSnapshotService;
  snapshots: Parameters<MealLogSnapshotService["createSnapshot"]>[0][];
} {
  const snapshots: Parameters<MealLogSnapshotService["createSnapshot"]>[0][] =
    [];

  return {
    snapshots,
    service: {
      async createSnapshot(input) {
        snapshots.push(input);
        return {
          ...input,
          id: `snapshot-${snapshots.length}`,
          createdAt: input.createdAt ?? "2026-06-26T10:00:00.000Z",
          expiresAt: input.expiresAt ?? "2026-06-27T10:00:00.000Z",
        };
      },
      async getSnapshot() {
        return undefined;
      },
      async listSnapshots() {
        return [];
      },
    },
  };
}
