import { getMetricDefinition, type MetricUnit } from "./metric-registry.js";

type UnitDimension =
  | "mass"
  | "distance"
  | "energy"
  | "volume"
  | "duration"
  | "count"
  | "percentage"
  | "heart_rate"
  | "time_interval"
  | "length"
  | "nutrition_mass";

const UNIT_DIMENSIONS: Readonly<Record<MetricUnit, UnitDimension>> =
  Object.freeze({
    kg: "mass",
    lb: "mass",
    m: "distance",
    km: "distance",
    mi: "distance",
    kcal: "energy",
    kJ: "energy",
    ml: "volume",
    L: "volume",
    minute: "duration",
    hour: "duration",
    count: "count",
    percent: "percentage",
    bpm: "heart_rate",
    ms: "time_interval",
    cm: "length",
    g: "nutrition_mass",
  });

const TO_BASE_UNIT_FACTOR: Readonly<Record<MetricUnit, number>> = Object.freeze(
  {
    kg: 1,
    lb: 0.453_592_37,
    m: 1,
    km: 1_000,
    mi: 1_609.344,
    kcal: 1,
    kJ: 1 / 4.184,
    ml: 1,
    L: 1_000,
    minute: 1,
    hour: 60,
    count: 1,
    percent: 1,
    bpm: 1,
    ms: 1,
    cm: 1,
    g: 1,
  },
);

export class MetricUnitConversionError extends Error {
  readonly code = "INVALID_METRIC_UNIT_CONVERSION" as const;
  readonly metricKey: string;
  readonly sourceUnit: string;
  readonly targetUnit: string;
  readonly reason:
    | "INVALID_VALUE"
    | "UNKNOWN_UNIT"
    | "UNIT_NOT_ACCEPTED_FOR_METRIC"
    | "INCOMPATIBLE_UNITS";

  constructor(
    metricKey: string,
    sourceUnit: string,
    targetUnit: string,
    reason: MetricUnitConversionError["reason"],
  ) {
    super(
      `Cannot convert ${metricKey} from ${sourceUnit} to ${targetUnit}: ${reason}`,
    );
    this.name = "MetricUnitConversionError";
    this.metricKey = metricKey;
    this.sourceUnit = sourceUnit;
    this.targetUnit = targetUnit;
    this.reason = reason;
  }
}

export function convertMetricValue(
  metricKey: string,
  value: number,
  sourceUnit: string,
  targetUnit: string,
): number {
  const definition = getMetricDefinition(metricKey);
  if (!Number.isFinite(value)) {
    throw new MetricUnitConversionError(
      metricKey,
      sourceUnit,
      targetUnit,
      "INVALID_VALUE",
    );
  }

  if (!isMetricUnit(sourceUnit) || !isMetricUnit(targetUnit)) {
    throw new MetricUnitConversionError(
      metricKey,
      sourceUnit,
      targetUnit,
      "UNKNOWN_UNIT",
    );
  }

  const acceptedUnits = new Set<MetricUnit>([
    definition.canonicalUnit,
    ...definition.acceptedSourceUnits,
  ]);
  if (!acceptedUnits.has(sourceUnit) || !acceptedUnits.has(targetUnit)) {
    throw new MetricUnitConversionError(
      metricKey,
      sourceUnit,
      targetUnit,
      "UNIT_NOT_ACCEPTED_FOR_METRIC",
    );
  }

  if (UNIT_DIMENSIONS[sourceUnit] !== UNIT_DIMENSIONS[targetUnit]) {
    throw new MetricUnitConversionError(
      metricKey,
      sourceUnit,
      targetUnit,
      "INCOMPATIBLE_UNITS",
    );
  }

  return (
    (value * TO_BASE_UNIT_FACTOR[sourceUnit]) / TO_BASE_UNIT_FACTOR[targetUnit]
  );
}

function isMetricUnit(value: string): value is MetricUnit {
  return Object.hasOwn(UNIT_DIMENSIONS, value);
}
