import { describe, expect, it } from "vitest";
import {
  METRIC_DEFINITIONS,
  METRIC_FORMATTER_IDENTIFIERS,
  MetricUnitConversionError,
  UnsupportedMetricError,
  convertMetricValue,
  formatMetricValue,
  getMetricDefinition,
  isSupportedMetric,
  listMetricDefinitions,
  suggestMetricKeys,
} from "./index.js";

const REQUIRED_METRIC_KEYS = [
  "steps",
  "active_energy",
  "resting_energy",
  "total_energy",
  "exercise_minutes",
  "stand_hours",
  "walking_distance",
  "running_distance",
  "weight",
  "body_fat_percentage",
  "waist_circumference",
  "heart_rate",
  "resting_heart_rate",
  "walking_heart_rate",
  "heart_rate_variability",
  "sleep_duration",
  "sleep_awake",
  "sleep_core",
  "sleep_deep",
  "sleep_rem",
  "calories_consumed",
  "protein_consumed",
  "carbohydrates_consumed",
  "fat_consumed",
  "fiber_consumed",
  "water_consumed",
  "workout_duration",
  "workout_count",
] as const;

describe("metric registry", () => {
  it("registers every required stable metric key exactly once", () => {
    const keys = listMetricDefinitions().map((definition) => definition.key);

    expect(keys).toEqual(REQUIRED_METRIC_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("defines canonical units and implemented formatters for every metric", () => {
    for (const definition of METRIC_DEFINITIONS) {
      expect(definition.canonicalUnit).not.toBe("");
      expect(definition.acceptedSourceUnits).toContain(
        definition.canonicalUnit,
      );
      expect(METRIC_FORMATTER_IDENTIFIERS).toContain(
        definition.formatterIdentifier,
      );
    }
  });

  it("distinguishes current, source-dependent, and planned metrics", () => {
    expect(getMetricDefinition("steps").availability).toBe(
      "currently_available",
    );
    expect(getMetricDefinition("water_consumed").availability).toBe(
      "source_dependent",
    );
    expect(getMetricDefinition("total_energy").availability).toBe(
      "planned_unavailable",
    );
  });

  it("serializes as data without losing required metadata", () => {
    const serialized = JSON.stringify(listMetricDefinitions());
    const parsed = JSON.parse(serialized) as Array<Record<string, unknown>>;

    expect(parsed).toHaveLength(REQUIRED_METRIC_KEYS.length);
    expect(parsed[0]).toMatchObject({
      key: "steps",
      canonicalUnit: "count",
      formatterIdentifier: "integer",
      partialDayValuesExpected: true,
    });
  });

  it("reports support without conflating it with current availability", () => {
    expect(isSupportedMetric("steps")).toBe(true);
    expect(isSupportedMetric("total_energy")).toBe(true);
    expect(isSupportedMetric("blood_glucose")).toBe(false);
  });

  it("throws a structured unsupported-metric error with discovery guidance", () => {
    expect.assertions(6);

    try {
      getMetricDefinition("stepz");
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedMetricError);
      expect(error).toMatchObject({
        code: "UNSUPPORTED_METRIC",
        invalidKey: "stepz",
        suggestedMetricKeys: ["steps"],
        availableRegistryMethod: "listMetricDefinitions",
      });
      expect((error as UnsupportedMetricError).toJSON()).toEqual({
        code: "UNSUPPORTED_METRIC",
        invalidKey: "stepz",
        suggestedMetricKeys: ["steps"],
        availableRegistryMethod: "listMetricDefinitions",
      });
      expect((error as UnsupportedMetricError).message).toContain("stepz");
      expect((error as UnsupportedMetricError).name).toBe(
        "UnsupportedMetricError",
      );
      expect((error as UnsupportedMetricError).suggestedMetricKeys).toEqual([
        "steps",
      ]);
    }
  });

  it("suggests canonical keys for common aliases and typos", () => {
    expect(suggestMetricKeys("body_weight")).toEqual(["weight"]);
    expect(suggestMetricKeys("sleep")).toEqual(["sleep_duration"]);
    expect(suggestMetricKeys("dietary-energy")).toEqual(["calories_consumed"]);
    expect(suggestMetricKeys("workout_cout")).toContain("workout_count");
  });
});

describe("metric formatting", () => {
  it("formats steps and workout counts as whole numbers without changing raw values", () => {
    const steps = formatMetricValue("steps", 7_082.04);
    const workouts = formatMetricValue("workout_count", 3.6);

    expect(steps).toMatchObject({
      rawValue: 7_082.04,
      formattedValue: "7,082",
      status: "available",
    });
    expect(workouts.formattedValue).toBe("4");
  });

  it("supports one- or two-decimal weight precision", () => {
    expect(formatMetricValue("weight", 82.345).formattedValue).toBe("82.3 kg");
    expect(
      formatMetricValue("weight", 82.345, { weightPrecision: 2 })
        .formattedValue,
    ).toBe("82.35 kg");
  });

  it("formats calories as sensible whole numbers", () => {
    expect(formatMetricValue("calories_consumed", 2_100.6).formattedValue).toBe(
      "2,101 kcal",
    );
  });

  it("formats percentages and heart rate consistently", () => {
    expect(formatMetricValue("body_fat_percentage", 18.25).formattedValue).toBe(
      "18.3%",
    );
    expect(formatMetricValue("heart_rate", 72.4).formattedValue).toBe("72 bpm");
  });

  it("formats durations as minutes or hours and minutes", () => {
    expect(formatMetricValue("workout_duration", 45).formattedValue).toBe(
      "45 min",
    );
    expect(formatMetricValue("sleep_duration", 510).formattedValue).toBe(
      "8 h 30 min",
    );
    expect(
      formatMetricValue("sleep_duration", 90, { durationStyle: "minutes" })
        .formattedValue,
    ).toBe("90 min");
  });

  it("uses locale-aware distance units and supports water in millilitres or litres", () => {
    expect(
      formatMetricValue("walking_distance", 5, { locale: "en-US" }).unit,
    ).toBe("mi");
    expect(
      formatMetricValue("walking_distance", 5, { locale: "en-IL" }).unit,
    ).toBe("km");
    expect(formatMetricValue("water_consumed", 750).formattedValue).toBe(
      "750 mL",
    );
    expect(formatMetricValue("water_consumed", 1_500).formattedValue).toBe(
      "1.5 L",
    );
  });

  it("keeps missing, invalid, and real zero values distinct", () => {
    expect(formatMetricValue("steps", undefined)).toMatchObject({
      rawValue: undefined,
      formattedValue: "N/A",
      status: "missing",
    });
    expect(formatMetricValue("steps", null)).toMatchObject({
      rawValue: null,
      formattedValue: "N/A",
      status: "missing",
    });
    expect(formatMetricValue("steps", Number.NaN)).toMatchObject({
      formattedValue: "N/A",
      status: "invalid",
    });
    expect(formatMetricValue("steps", Number.POSITIVE_INFINITY)).toMatchObject({
      formattedValue: "N/A",
      status: "invalid",
    });
    expect(formatMetricValue("steps", 0)).toMatchObject({
      rawValue: 0,
      displayValue: 0,
      formattedValue: "0",
      status: "available",
    });
  });
});

describe("metric unit conversion", () => {
  it("converts supported compatible units deterministically", () => {
    expect(convertMetricValue("weight", 1, "kg", "lb")).toBeCloseTo(
      2.204_622_621_8,
      10,
    );
    expect(convertMetricValue("walking_distance", 1, "km", "mi")).toBeCloseTo(
      0.621_371_192_2,
      10,
    );
    expect(convertMetricValue("walking_distance", 1_500, "m", "km")).toBe(1.5);
    expect(convertMetricValue("active_energy", 100, "kcal", "kJ")).toBeCloseTo(
      418.4,
      10,
    );
    expect(convertMetricValue("water_consumed", 1_500, "ml", "L")).toBe(1.5);
    expect(convertMetricValue("workout_duration", 90, "minute", "hour")).toBe(
      1.5,
    );
  });

  it("rejects incompatible, unknown, unaccepted, and invalid conversions", () => {
    expect(() => convertMetricValue("weight", 80, "kg", "kcal")).toThrowError(
      MetricUnitConversionError,
    );

    expect(() => convertMetricValue("weight", 80, "stone", "kg")).toThrowError(
      expect.objectContaining({
        code: "INVALID_METRIC_UNIT_CONVERSION",
        reason: "UNKNOWN_UNIT",
      }),
    );

    expect(() => convertMetricValue("weight", 80, "kg", "g")).toThrowError(
      expect.objectContaining({ reason: "UNIT_NOT_ACCEPTED_FOR_METRIC" }),
    );

    expect(() =>
      convertMetricValue("weight", Number.NaN, "kg", "lb"),
    ).toThrowError(expect.objectContaining({ reason: "INVALID_VALUE" }));
  });
});
