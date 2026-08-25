import { describe, expect, it } from "vitest";
import {
  HEALTH_METRICS,
  isHealthMetricName,
  isValidHealthMetricValue,
  metricByName,
} from "./metrics.js";

describe("health metric contracts", () => {
  it("contains exactly the first-slice metric names", () => {
    expect(HEALTH_METRICS.map((metric) => metric.name)).toEqual([
      "weight",
      "steps",
      "active_energy",
      "resting_energy",
      "sleep",
      "heart_rate",
      "resting_heart_rate",
      "walking_heart_rate",
      "dietary_energy",
      "protein",
      "carbs",
      "fat",
      "fiber",
    ]);
  });

  it("contains the first-slice metric set with stable units", () => {
    expect(metricByName("weight").unit).toBe("kg");
    expect(metricByName("steps").unit).toBe("count");
    expect(metricByName("active_energy").unit).toBe("kcal");
    expect(metricByName("resting_energy").unit).toBe("kcal");
    expect(metricByName("sleep").unit).toBe("minute");
    expect(metricByName("heart_rate").unit).toBe("bpm");
    expect(metricByName("resting_heart_rate").unit).toBe("bpm");
    expect(metricByName("walking_heart_rate").unit).toBe("bpm");
    expect(metricByName("dietary_energy").unit).toBe("kcal");
    expect(metricByName("protein").unit).toBe("g");
    expect(metricByName("carbs").unit).toBe("g");
    expect(metricByName("fat").unit).toBe("g");
    expect(metricByName("fiber").unit).toBe("g");
  });

  it("rejects unknown metric names", () => {
    expect(isHealthMetricName("weight")).toBe(true);
    expect(isHealthMetricName("body_weight")).toBe(false);
  });

  it("has no duplicate metric names", () => {
    const names = HEALTH_METRICS.map((metric) => metric.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("exposes immutable metric metadata", () => {
    expect(Object.isFrozen(HEALTH_METRICS)).toBe(true);
    expect(Object.isFrozen(metricByName("weight"))).toBe(true);
  });

  it("validates first-slice metric values against domain bounds", () => {
    expect(isValidHealthMetricValue("weight", 87.4)).toBe(true);
    expect(isValidHealthMetricValue("steps", 0)).toBe(true);
    expect(isValidHealthMetricValue("active_energy", 0)).toBe(true);
    expect(isValidHealthMetricValue("resting_energy", 1850)).toBe(true);
    expect(isValidHealthMetricValue("sleep", 480)).toBe(true);
    expect(isValidHealthMetricValue("heart_rate", 72)).toBe(true);
    expect(isValidHealthMetricValue("resting_heart_rate", 64)).toBe(true);
    expect(isValidHealthMetricValue("walking_heart_rate", 92)).toBe(true);
    expect(isValidHealthMetricValue("dietary_energy", 2_100)).toBe(true);
    expect(isValidHealthMetricValue("protein", 150)).toBe(true);
    expect(isValidHealthMetricValue("carbs", 220)).toBe(true);
    expect(isValidHealthMetricValue("fat", 65)).toBe(true);
    expect(isValidHealthMetricValue("fiber", 28)).toBe(true);

    expect(isValidHealthMetricValue("weight", 0)).toBe(false);
    expect(isValidHealthMetricValue("steps", -1)).toBe(false);
    expect(isValidHealthMetricValue("active_energy", -1)).toBe(false);
    expect(isValidHealthMetricValue("resting_energy", -1)).toBe(false);
    expect(isValidHealthMetricValue("sleep", 1_441)).toBe(false);
    expect(isValidHealthMetricValue("heart_rate", 0)).toBe(false);
    expect(isValidHealthMetricValue("resting_heart_rate", 301)).toBe(false);
    expect(isValidHealthMetricValue("walking_heart_rate", Number.NaN)).toBe(
      false,
    );
    expect(isValidHealthMetricValue("dietary_energy", -1)).toBe(false);
    expect(isValidHealthMetricValue("protein", 1_001)).toBe(false);
    expect(isValidHealthMetricValue("carbs", 2_001)).toBe(false);
    expect(isValidHealthMetricValue("fat", 1_001)).toBe(false);
    expect(isValidHealthMetricValue("fiber", 501)).toBe(false);
  });
});
