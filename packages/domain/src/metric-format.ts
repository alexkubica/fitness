import {
  getMetricDefinition,
  type MetricFormatterIdentifier,
  type MetricUnit,
} from "./metric-registry.js";
import { convertMetricValue } from "./metric-units.js";

export type MetricFormatOptions = Readonly<{
  locale?: string;
  targetUnit?: MetricUnit;
  unitSystem?: "auto" | "metric" | "imperial";
  weightPrecision?: 1 | 2;
  durationStyle?: "auto" | "minutes" | "hours_minutes";
  includeUnit?: boolean;
  unavailableRepresentation?: string;
}>;

export type FormattedMetricValue = Readonly<{
  rawValue: number | null | undefined;
  displayValue: number | null;
  formattedValue: string;
  unit: MetricUnit;
  status: "available" | "missing" | "invalid";
}>;

export const METRIC_FORMATTER_IDENTIFIERS: readonly MetricFormatterIdentifier[] =
  Object.freeze([
    "integer",
    "energy",
    "weight",
    "percentage",
    "duration",
    "distance",
    "heart_rate",
    "volume",
    "decimal",
  ]);

export function formatMetricValue(
  metricKey: string,
  value: number | null | undefined,
  options: MetricFormatOptions = {},
): FormattedMetricValue {
  const definition = getMetricDefinition(metricKey);
  const unavailable = options.unavailableRepresentation ?? "N/A";
  const locale = options.locale ?? "en-US";
  const unit = resolveDisplayUnit(
    definition.formatterIdentifier,
    definition.canonicalUnit,
    value,
    locale,
    options,
  );

  if (value === null || value === undefined) {
    return Object.freeze({
      rawValue: value,
      displayValue: null,
      formattedValue: unavailable,
      unit,
      status: "missing",
    });
  }

  if (!Number.isFinite(value)) {
    return Object.freeze({
      rawValue: value,
      displayValue: null,
      formattedValue: unavailable,
      unit,
      status: "invalid",
    });
  }

  const displayValue = convertMetricValue(
    metricKey,
    value,
    definition.canonicalUnit,
    unit,
  );
  const formattedValue = formatAvailableValue(
    definition.formatterIdentifier,
    displayValue,
    unit,
    definition.displayPrecision,
    locale,
    options,
  );

  return Object.freeze({
    rawValue: value,
    displayValue,
    formattedValue,
    unit,
    status: "available",
  });
}

function resolveDisplayUnit(
  formatter: MetricFormatterIdentifier,
  canonicalUnit: MetricUnit,
  value: number | null | undefined,
  locale: string,
  options: MetricFormatOptions,
): MetricUnit {
  if (options.targetUnit !== undefined) {
    return options.targetUnit;
  }

  if (formatter === "distance") {
    const unitSystem = options.unitSystem ?? "auto";
    const useImperial =
      unitSystem === "imperial" ||
      (unitSystem === "auto" && locale.toLowerCase().startsWith("en-us"));
    return useImperial ? "mi" : canonicalUnit;
  }

  if (
    formatter === "volume" &&
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) >= 1_000
  ) {
    return "L";
  }

  return canonicalUnit;
}

function formatAvailableValue(
  formatter: MetricFormatterIdentifier,
  value: number,
  unit: MetricUnit,
  displayPrecision: number,
  locale: string,
  options: MetricFormatOptions,
): string {
  switch (formatter) {
    case "integer":
      return withUnit(number(value, locale, 0), unit, formatter, options);
    case "energy":
      return withUnit(number(value, locale, 0), unit, formatter, options);
    case "weight": {
      const precision = options.weightPrecision ?? displayPrecision;
      return withUnit(
        fixedNumber(value, locale, precision),
        unit,
        formatter,
        options,
      );
    }
    case "percentage":
      return options.includeUnit === false
        ? fixedNumber(value, locale, displayPrecision)
        : `${fixedNumber(value, locale, displayPrecision)}%`;
    case "duration":
      return formatDuration(value, unit, locale, options);
    case "distance":
      return withUnit(
        number(value, locale, displayPrecision),
        unit,
        formatter,
        options,
      );
    case "heart_rate":
      return withUnit(number(value, locale, 0), unit, formatter, options);
    case "volume":
      return withUnit(
        number(value, locale, unit === "L" ? 2 : 0),
        unit,
        formatter,
        options,
      );
    case "decimal":
      return withUnit(
        number(value, locale, displayPrecision),
        unit,
        formatter,
        options,
      );
  }
}

function formatDuration(
  value: number,
  unit: MetricUnit,
  locale: string,
  options: MetricFormatOptions,
): string {
  const minutes = unit === "hour" ? value * 60 : value;
  const style = options.durationStyle ?? "auto";
  if (style === "minutes" || (style === "auto" && Math.abs(minutes) < 60)) {
    const formatted = number(minutes, locale, 0);
    return options.includeUnit === false ? formatted : `${formatted} min`;
  }

  const sign = minutes < 0 ? "-" : "";
  const roundedMinutes = Math.round(Math.abs(minutes));
  const hours = Math.floor(roundedMinutes / 60);
  const remainingMinutes = roundedMinutes % 60;
  const formatted =
    remainingMinutes === 0
      ? `${sign}${number(hours, locale, 0)} h`
      : `${sign}${number(hours, locale, 0)} h ${number(remainingMinutes, locale, 0)} min`;
  return options.includeUnit === false
    ? `${sign}${number(Math.abs(minutes) / 60, locale, 1)}`
    : formatted;
}

function withUnit(
  formattedNumber: string,
  unit: MetricUnit,
  formatter: MetricFormatterIdentifier,
  options: MetricFormatOptions,
): string {
  if (options.includeUnit === false || formatter === "integer") {
    return formattedNumber;
  }
  return `${formattedNumber} ${unit === "ml" ? "mL" : unit}`;
}

function number(
  value: number,
  locale: string,
  maximumFractionDigits: number,
): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
}

function fixedNumber(
  value: number,
  locale: string,
  fractionDigits: number,
): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}
