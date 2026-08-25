import { HEALTH_METRICS, type HealthMetricName } from "@fitness/domain";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import {
  normalizeHealthReadRange,
  type HealthMetricSample,
  type HealthReadRange,
  type HealthReadService,
} from "../../services/health-read.js";
import { normalizeMcpDateRange, type McpDateRangeInput } from "./date-range.js";

export const GET_HEALTH_SUMMARY_TOOL_NAME = "get_health_summary";

export const getHealthSummaryInputSchema = {
  profileId: z.string().min(1).max(120).optional(),
  range: z
    .object({
      from: z.string().datetime(),
      to: z.string().datetime(),
    })
    .optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  preset: z.enum(["today"]).optional(),
  timezone: z.string().min(1).max(80).default("Asia/Jerusalem"),
};

export const getHealthSummaryOutputSchema = {
  summary: z.object({
    range: z.object({
      from: z.string(),
      to: z.string(),
    }),
    sampleCount: z.number().int().nonnegative(),
    metrics: z.record(z.string(), z.unknown()),
  }),
};

export type HealthMetricSummary = Readonly<{
  unit: HealthMetricSample["unit"];
  count: number;
  coveredDays: number;
  min: number;
  max: number;
  total: number;
  average: number;
  firstDate: string;
  lastDate: string;
  latest: Readonly<{
    value: number;
    at: string;
    localDate: string;
  }>;
}>;

export type HealthSummary = Readonly<{
  range: HealthReadRange;
  sampleCount: number;
  metrics: Partial<Record<HealthMetricName, HealthMetricSummary>>;
}>;

export async function getHealthSummaryToolResult(input: {
  healthRead: HealthReadService;
  userId: string;
  profileId?: string | undefined;
  range: McpDateRangeInput;
}): Promise<CallToolResult> {
  const range = normalizeHealthReadRange(normalizeMcpDateRange(input.range));
  const samples = await input.healthRead.listSamples({
    userId: input.userId,
    profileId: input.profileId,
    range,
  });
  const summary = summarizeHealthSamples(samples, {
    from: range.from,
    to: range.to,
  });

  return {
    content: [
      {
        type: "text",
        text: formatHealthSummary(summary),
      },
    ],
    structuredContent: {
      summary,
    },
  };
}

export function summarizeHealthSamples(
  samples: readonly HealthMetricSample[],
  range: HealthReadRange,
): HealthSummary {
  const metrics: Partial<Record<HealthMetricName, HealthMetricSummary>> = {};

  for (const metric of HEALTH_METRICS) {
    const metricSamples = samples.filter(
      (sample) => sample.metricName === metric.name,
    );

    if (metricSamples.length === 0) {
      continue;
    }

    metrics[metric.name] = summarizeMetricSamples(metricSamples);
  }

  return {
    range,
    sampleCount: samples.length,
    metrics,
  };
}

function summarizeMetricSamples(
  samples: readonly HealthMetricSample[],
): HealthMetricSummary {
  const values = samples.map((sample) => sample.value);
  const total = round(values.reduce((sum, value) => sum + value, 0));
  const average = round(total / values.length);
  const latest = [...samples].sort(compareSamplesByEndTimeDesc)[0];
  const localDates = [...new Set(samples.map(localDateForSample))].sort();
  const firstDate = localDates[0];
  const lastDate = localDates[localDates.length - 1];

  if (
    latest === undefined ||
    firstDate === undefined ||
    lastDate === undefined
  ) {
    throw new Error("Cannot summarize an empty metric sample set.");
  }

  return {
    unit: latest.unit,
    count: samples.length,
    coveredDays: localDates.length,
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
    total,
    average,
    firstDate,
    lastDate,
    latest: {
      value: latest.value,
      at: latest.endTime,
      localDate: localDateForSample(latest),
    },
  };
}

function compareSamplesByEndTimeDesc(
  left: HealthMetricSample,
  right: HealthMetricSample,
): number {
  return Date.parse(right.endTime) - Date.parse(left.endTime);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatHealthSummary(summary: HealthSummary): string {
  const metricLines = HEALTH_METRICS.flatMap((metric) => {
    const metricSummary = summary.metrics[metric.name];

    if (metricSummary === undefined) {
      return [];
    }

    return [
      [
        metric.name,
        `${metricSummary.coveredDays}d`,
        `avg ${formatNumber(metricSummary.average)} ${metricSummary.unit}`,
        `total ${formatNumber(metricSummary.total)} ${metricSummary.unit}`,
        `latest ${formatNumber(metricSummary.latest.value)} ${metricSummary.unit} on ${metricSummary.latest.localDate}`,
      ].join(" | "),
    ];
  });

  return [
    `Health summary from ${summary.range.from} to ${summary.range.to}: ${summary.sampleCount} rows across ${Object.keys(summary.metrics).length} metrics.`,
    "Metric rows use each sample's local HealthKit timezone for day labels.",
    ...metricLines,
  ].join("\n");
}

function localDateForSample(sample: HealthMetricSample): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: sample.timezone,
    year: "numeric",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(sample.startTime))
      .map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}
