import { describe, expect, it } from "vitest";
import { createInMemoryHealthReadService } from "./health-read.js";
import { createCoachReportService } from "./coach-report.js";
import { createInMemoryMealLogService } from "./meals.js";
import { createInMemoryTelegramBotStorage } from "../telegram/bot.js";
import type { TargetPlan, TargetPlanTargets } from "@fitness/domain";
import type { TargetPlanRepository } from "@fitness/db";

describe("coach report service", () => {
  it("builds daily reports from health samples, check-ins, and meal notes for one user", async () => {
    const telegramStorage = createInMemoryTelegramBotStorage();
    await telegramStorage.createCheckIn({
      idempotencyKey: "checkin-1",
      userId: "user_alex",
      telegramUserId: 12_345,
      checkedInAt: "2026-06-10T20:00:00.000Z",
      timezone: "Asia/Jerusalem",
      hunger: 6,
      mood: 7,
      energy: 5,
      stress: 4,
      cravings: 2,
      notes: "Long day",
    });
    await telegramStorage.createMealLog({
      idempotencyKey: "meal-1",
      userId: "user_alex",
      telegramUserId: 12_345,
      text: "Greek yogurt and berries",
      occurredAt: "2026-06-10T08:00:00.000Z",
      timezone: "Asia/Jerusalem",
    });

    const reports = createCoachReportService({
      healthRead: createInMemoryHealthReadService([
        sample("user_alex", "weight", "kg", 87.55),
        sample("user_alex", "steps", "count", 11_800),
        sample("user_alex", "active_energy", "kcal", 900),
        sample("user_alex", "resting_energy", "kcal", 2_185),
        sample("other_user", "steps", "count", 25_000),
      ]),
      telegramStorage,
      now: () => new Date("2026-06-11T12:00:00.000Z"),
    });

    const result = await reports.generateDailyReport({
      userId: "user_alex",
      range: {
        from: "2026-06-10T00:00:00.000Z",
        to: "2026-06-11T00:00:00.000Z",
      },
    });

    expect(result.report.metrics).toMatchObject({
      latestWeightKg: 87.55,
      totalSteps: 11_800,
      totalEnergyKcal: 3_085,
    });
    expect(result.report.checkIns.count).toBe(1);
    expect(result.report.meals.count).toBe(1);
    expect(result.text).toContain("Daily coach report");
    expect(result.text).toContain("Steps: 11,800");
    expect(result.text).not.toContain("25,000");
  });

  it("includes account-backed meal logs with macros in daily reports", async () => {
    const meals = createInMemoryMealLogService([
      {
        id: "account-meal-1",
        userId: "user_alex",
        idempotencyKey: "ios-meal:account-meal-1",
        clientMealId: "account-meal-1",
        occurredAt: "2026-06-10T08:00:00.000Z",
        timezone: "Asia/Jerusalem",
        title: "Greek yogurt and berries",
        mealType: "Breakfast",
        note: "Greek yogurt and berries",
        totals: {
          calories: 320,
          proteinGrams: 28,
          carbsGrams: 32,
          fatGrams: 8,
          fiberGrams: 5,
        },
        ingredients: [],
        photoCount: 0,
        estimateStatus: "ai_estimated",
        estimateConfidence: 0.8,
        estimateSummary: "Estimated from text.",
        origin: "ios",
        createdAt: "2026-06-10T08:01:00.000Z",
        updatedAt: "2026-06-10T08:01:00.000Z",
      },
      {
        id: "other-meal-1",
        userId: "other_user",
        idempotencyKey: "ios-meal:other-meal-1",
        clientMealId: "other-meal-1",
        occurredAt: "2026-06-10T08:00:00.000Z",
        timezone: "Asia/Jerusalem",
        title: "Other user meal",
        mealType: "Breakfast",
        note: "",
        totals: {
          calories: 999,
          proteinGrams: 99,
          carbsGrams: 99,
          fatGrams: 99,
          fiberGrams: 99,
        },
        ingredients: [],
        photoCount: 0,
        estimateStatus: "manual",
        origin: "ios",
        createdAt: "2026-06-10T08:01:00.000Z",
        updatedAt: "2026-06-10T08:01:00.000Z",
      },
    ]);
    const reports = createCoachReportService({
      healthRead: createInMemoryHealthReadService([]),
      meals,
      telegramStorage: createInMemoryTelegramBotStorage(),
      now: () => new Date("2026-06-11T12:00:00.000Z"),
    });

    const result = await reports.generateDailyReport({
      userId: "user_alex",
      range: {
        from: "2026-06-10T00:00:00.000Z",
        to: "2026-06-11T00:00:00.000Z",
      },
    });

    expect(result.report.meals).toEqual({
      count: 1,
      hasMacroEstimates: true,
    });
    expect(result.text).toContain("Meals: 1 with macros");
    expect(JSON.stringify(result.report)).not.toContain("other_user");
  });

  it("awaits async Telegram storage reads when reports run against Neon storage", async () => {
    const reports = createCoachReportService({
      healthRead: createInMemoryHealthReadService([]),
      telegramStorage: {
        claimUpdate() {
          throw new Error("not used");
        },
        createCheckIn() {
          throw new Error("not used");
        },
        createMealLog() {
          throw new Error("not used");
        },
        async listCheckIns() {
          return [
            {
              id: "db-checkin-1",
              userId: "user_alex",
              telegramUserId: 12_345,
              hunger: 6,
              mood: 7,
              energy: 5,
              stress: 4,
              cravings: 2,
              notes: "Stored",
              createdAt: "2026-06-11T08:00:00.000Z",
            },
          ];
        },
        async listMealLogs() {
          return [
            {
              id: "db-meal-1",
              userId: "user_alex",
              telegramUserId: 12_345,
              text: "Greek yogurt",
              createdAt: "2026-06-11T09:00:00.000Z",
            },
          ];
        },
      },
      now: () => new Date("2026-06-11T12:00:00.000Z"),
    });

    const result = await reports.generateDailyReport({
      userId: "user_alex",
      range: {
        from: "2026-06-11T00:00:00.000Z",
        to: "2026-06-12T00:00:00.000Z",
      },
    });

    expect(result.report.checkIns.count).toBe(1);
    expect(result.report.meals.count).toBe(1);
  });

  it("resolves historical target versions across a profile-local date change", async () => {
    const targetPlans = targetRepository([
      plan(1, "2026-06-01", "2026-06-10", 8_000, "superseded"),
      plan(2, "2026-06-10", undefined, 10_000, "active"),
    ]);
    const reports = createCoachReportService({
      healthRead: createInMemoryHealthReadService([
        sample("user_alex", "steps", "count", 9_000),
      ]),
      targetPlans,
      telegramStorage: createInMemoryTelegramBotStorage(),
    });

    const result = await reports.generateDailyReport({
      userId: "user_alex",
      profileId: "11111111-1111-4111-8111-111111111111",
      timezone: "Asia/Jerusalem",
      range: {
        from: "2026-06-09T00:00:00.000Z",
        to: "2026-06-11T00:00:00.000Z",
      },
    });

    expect(result.report.targetPeriods.map((period) => period.version)).toEqual(
      [1, 2],
    );
    expect(result.report.targetChanges).toHaveLength(1);
    expect(result.report.guidance.join(" ")).toContain(
      "rather than against one averaged target",
    );
  });
});

function targetRepository(plans: readonly TargetPlan[]): TargetPlanRepository {
  return {
    async listHistory() {
      return plans;
    },
    async getPlan() {
      return undefined;
    },
    async getActivePlan() {
      return undefined;
    },
    async getEffectivePlan() {
      return undefined;
    },
    async createPlan() {
      throw new Error("not used");
    },
    async proposePlan() {
      throw new Error("not used");
    },
    async rejectPlan() {
      throw new Error("not used");
    },
    async activatePlan() {
      throw new Error("not used");
    },
    async archivePlan() {
      throw new Error("not used");
    },
  };
}

const reportTargets: TargetPlanTargets = {
  maintenanceCalories: 2_400,
  selectedCalories: 2_000,
  proteinGrams: 140,
  carbohydratesGrams: 210,
  fatGrams: 65,
  fiberGrams: 30,
  steps: 8_000,
};

function plan(
  version: number,
  effectiveFrom: string,
  effectiveUntil: string | undefined,
  steps: number,
  status: "active" | "superseded",
): TargetPlan {
  return {
    id: `plan-${version}`,
    profileId: "11111111-1111-4111-8111-111111111111",
    version,
    goal: "lose_weight",
    status,
    calculationMode: "manual",
    effectiveFrom,
    ...(effectiveUntil === undefined ? {} : { effectiveUntil }),
    createdByUserId: "user_alex",
    source: "test",
    reason: "Test",
    targets: { ...reportTargets, steps },
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

function sample(
  userId: string,
  metricName:
    | "weight"
    | "steps"
    | "active_energy"
    | "resting_energy"
    | "sleep"
    | "heart_rate"
    | "resting_heart_rate"
    | "walking_heart_rate",
  unit: "kg" | "count" | "kcal" | "minute" | "bpm",
  value: number,
) {
  return {
    userId,
    metricName,
    unit,
    value,
    startTime: "2026-06-10T12:00:00.000Z",
    endTime: "2026-06-10T12:00:00.000Z",
    timezone: "Asia/Jerusalem",
    source: "test",
    sourceSampleId: `${userId}-${metricName}`,
  };
}
