import { describe, expect, it } from "vitest";
import {
  formatDailyCoachReportText,
  generateDailyCoachReport,
} from "./reports.js";

const range = {
  from: "2026-06-10T00:00:00.000Z",
  to: "2026-06-11T00:00:00.000Z",
};

describe("daily coach reports", () => {
  it("builds a conservative deterministic report from health and coach inputs", () => {
    const report = generateDailyCoachReport({
      generatedAt: "2026-06-11T12:00:00.000Z",
      range,
      healthSamples: [
        healthSample("weight", "kg", 87.55, "2026-06-10T06:00:00.000Z"),
        healthSample("steps", "count", 11_800),
        healthSample("active_energy", "kcal", 900),
        healthSample("resting_energy", "kcal", 2_185),
        healthSample("sleep", "minute", 450),
        healthSample("resting_heart_rate", "bpm", 66),
        healthSample("walking_heart_rate", "bpm", 92),
      ],
      checkIns: [
        {
          hunger: 6,
          mood: 7,
          energy: 5,
          stress: 4,
          cravings: 2,
          notes: "Long day",
          createdAt: "2026-06-10T20:00:00.000Z",
        },
      ],
      mealLogs: [
        {
          text: "Greek yogurt and berries",
          createdAt: "2026-06-10T08:00:00.000Z",
        },
      ],
      targetPeriods: [targetPeriod(1, "2026-06-01", 10_000)],
    });

    expect(report.metrics).toMatchObject({
      latestWeightKg: 87.55,
      totalSteps: 11_800,
      activeEnergyKcal: 900,
      restingEnergyKcal: 2_185,
      totalEnergyKcal: 3_085,
      sleepMinutes: 450,
      averageRestingHeartRateBpm: 66,
      averageWalkingHeartRateBpm: 92,
    });
    expect(report.checkIns).toMatchObject({
      count: 1,
      averages: {
        hunger: 6,
        mood: 7,
        energy: 5,
        stress: 4,
        cravings: 2,
      },
    });
    expect(report.meals).toEqual({
      count: 1,
      hasMacroEstimates: false,
    });
    expect(report.guidance).toContain(
      "Activity met the 10,000 step target; keep it steady.",
    );
    expect(report.guidance).toContain(
      "Sleep is in the useful 7-8 hour range; keep the timing consistent.",
    );
    expect(report.safetyNote).toContain("not a medical diagnosis");

    expect(formatDailyCoachReportText(report)).toContain("Steps: 11,800");
  });

  it("keeps target changes explicit instead of averaging incompatible plans", () => {
    const report = generateDailyCoachReport({
      generatedAt: "2026-06-11T12:00:00.000Z",
      range,
      healthSamples: [healthSample("steps", "count", 9_000)],
      checkIns: [],
      mealLogs: [],
      targetPeriods: [
        targetPeriod(1, "2026-06-01", 8_000, "2026-06-10"),
        targetPeriod(2, "2026-06-10", 10_000),
      ],
    });

    expect(report.targetChanges).toEqual([
      "Targets changed to v2 on 2026-06-10; adherence is evaluated within each versioned period.",
    ]);
    expect(report.guidance).toContain(
      "Step targets changed during this range; review activity within each target period rather than against one averaged target.",
    );
  });

  it("makes missing synced data explicit instead of inventing a report", () => {
    const report = generateDailyCoachReport({
      generatedAt: "2026-06-11T12:00:00.000Z",
      range,
      healthSamples: [],
      checkIns: [],
      mealLogs: [],
    });

    expect(report.metrics).toEqual({});
    expect(report.dataQuality).toEqual([
      "No health samples found for this range.",
      "No check-ins logged for this range.",
      "No meals logged for this range.",
    ]);
    expect(report.guidance).toEqual([
      "Not enough synced data yet; keep logging normally and review again after the next sync.",
    ]);
    expect(formatDailyCoachReportText(report)).toContain(
      "No health samples found for this range.",
    );
  });
});

function healthSample(
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
  at = "2026-06-10T12:00:00.000Z",
) {
  return {
    metricName,
    unit,
    value,
    startTime: at,
    endTime: at,
  };
}

function targetPeriod(
  version: number,
  effectiveFrom: string,
  steps: number,
  effectiveUntil?: string,
) {
  return {
    planId: `plan-${version}`,
    version,
    effectiveFrom,
    effectiveUntil,
    targets: {
      maintenanceCalories: 2_400,
      selectedCalories: 2_000,
      proteinGrams: 140,
      carbohydratesGrams: 210,
      fatGrams: 65,
      fiberGrams: 30,
      steps,
    },
  };
}
