import { describe, expect, it } from "vitest";
import { formatDelta, formatMetricValue } from "./format";

describe("web metric formatting adapter", () => {
  it("does not expose fractional cumulative steps from API data", () => {
    expect(formatMetricValue(7_082.04, "count", "steps")).toBe("7,082");
    expect(formatDelta(125.6, "count", "steps")).toBe("+126");
  });

  it("retains the existing unit-only formatter contract", () => {
    expect(formatMetricValue(82.34, "kg")).toBe("82.3 kg");
    expect(formatMetricValue(510, "minute")).toBe("8.5 h");
  });

  it("distinguishes zero from missing or invalid data", () => {
    expect(formatMetricValue(0, "count", "steps")).toBe("0");
    expect(formatMetricValue(undefined, "count", "steps")).toBe("N/A");
    expect(formatMetricValue(Number.NaN, "count", "steps")).toBe("N/A");
  });

  it("uses registry formatting for durations, calories, weight, and heart rate", () => {
    expect(formatMetricValue(510, "minute", "sleep")).toBe("8 h 30 min");
    expect(formatMetricValue(2_100.6, "kcal", "dietary_energy")).toBe(
      "2,101 kcal",
    );
    expect(formatMetricValue(82.34, "kg", "weight")).toBe("82.3 kg");
    expect(formatMetricValue(72.4, "bpm", "heart_rate")).toBe("72 bpm");
  });
});
