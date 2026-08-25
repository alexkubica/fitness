import {
  isHealthMetricName,
  metricByName,
  type HealthMetricName,
} from "@fitness/domain";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import {
  normalizeHealthReadRange,
  type HealthMetricSample,
  type HealthReadRange,
  type HealthReadService,
} from "../../services/health-read.js";
import { normalizeMcpDateRange, type McpDateRangeInput } from "./date-range.js";

export const GET_METRIC_TIMESERIES_TOOL_NAME = "get_metric_timeseries";

export const metricGranularities = ["sample", "day"] as const;
export type MetricGranularity = (typeof metricGranularities)[number];
type MetricAggregation = "average" | "sample" | "sum";

export const getMetricTimeseriesInputSchema = {
  profileId: z.string().min(1).max(120).optional(),
  metric: z.string().refine(isHealthMetricName, "Unsupported health metric."),
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
  granularity: z.enum(metricGranularities).default("day"),
};

export const getMetricTimeseriesOutputSchema = {
  timeseries: z.object({
    metric: z.string(),
    unit: z.string(),
    granularity: z.enum(metricGranularities),
    range: z.object({
      from: z.string(),
      to: z.string(),
    }),
    points: z.array(z.record(z.string(), z.unknown())),
  }),
};

export type MetricTimeseriesPoint = Readonly<
  | {
      startTime: string;
      endTime: string;
      value: number;
      sampleCount: 1;
      aggregation: "sample";
      source: string;
    }
  | {
      date: string;
      value: number;
      sampleCount: number;
      aggregation: "average" | "sum";
    }
>;

export type MetricTimeseries = Readonly<{
  metric: HealthMetricName;
  unit: HealthMetricSample["unit"];
  granularity: MetricGranularity;
  range: HealthReadRange;
  points: readonly MetricTimeseriesPoint[];
}>;

export async function getMetricTimeseriesToolResult(input: {
  healthRead: HealthReadService;
  userId: string;
  profileId?: string | undefined;
  metric: string;
  range: McpDateRangeInput;
  granularity: MetricGranularity;
}): Promise<CallToolResult> {
  if (!isHealthMetricName(input.metric)) {
    return {
      content: [
        {
          type: "text",
          text: `Unsupported health metric: ${input.metric}.`,
        },
      ],
      isError: true,
    };
  }

  const range = normalizeHealthReadRange(normalizeMcpDateRange(input.range));
  const samples = await input.healthRead.listSamples({
    userId: input.userId,
    profileId: input.profileId,
    metricName: input.metric,
    range,
  });
  const timeseries = buildMetricTimeseries({
    metric: input.metric,
    range: {
      from: range.from,
      to: range.to,
    },
    samples,
    granularity: input.granularity,
  });

  return {
    content: [
      {
        type: "text",
        text: `${timeseries.metric} ${timeseries.granularity} timeseries from ${timeseries.range.from} to ${timeseries.range.to}: ${timeseries.points.length} points.`,
      },
    ],
    structuredContent: {
      timeseries,
    },
  };
}

export function buildMetricTimeseries(input: {
  metric: HealthMetricName;
  range: HealthReadRange;
  samples: readonly HealthMetricSample[];
  granularity: MetricGranularity;
}): MetricTimeseries {
  const unit = metricByName(input.metric).unit;

  if (input.granularity === "sample") {
    return {
      metric: input.metric,
      unit,
      granularity: input.granularity,
      range: input.range,
      points: input.samples.map(samplePoint),
    };
  }

  return {
    metric: input.metric,
    unit,
    granularity: input.granularity,
    range: input.range,
    points: dailyPoints(input.metric, input.samples),
  };
}

function samplePoint(sample: HealthMetricSample): MetricTimeseriesPoint {
  return {
    startTime: sample.startTime,
    endTime: sample.endTime,
    value: sample.value,
    sampleCount: 1,
    aggregation: "sample",
    source: sample.source,
  };
}

function dailyPoints(
  metric: HealthMetricName,
  samples: readonly HealthMetricSample[],
): readonly MetricTimeseriesPoint[] {
  const groups = new Map<string, HealthMetricSample[]>();

  for (const sample of samples) {
    const date = localDateForSample(sample);
    const group = groups.get(date) ?? [];

    group.push(sample);
    groups.set(date, group);
  }

  return Array.from(groups.entries())
    .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
    .map(([date, group]) => {
      const aggregation = aggregationForMetric(metric);
      const value = aggregateValues(
        group.map((sample) => sample.value),
        aggregation,
      );

      return {
        date,
        value,
        sampleCount: group.length,
        aggregation,
      };
    });
}

function aggregationForMetric(
  metric: HealthMetricName,
): Exclude<MetricAggregation, "sample"> {
  switch (metric) {
    case "steps":
    case "active_energy":
    case "resting_energy":
    case "sleep":
    case "dietary_energy":
    case "protein":
    case "carbs":
    case "fat":
    case "fiber":
      return "sum";
    case "weight":
    case "heart_rate":
    case "resting_heart_rate":
    case "walking_heart_rate":
      return "average";
  }
}

function aggregateValues(
  values: readonly number[],
  aggregation: Exclude<MetricAggregation, "sample">,
): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  const value = aggregation === "sum" ? total : total / values.length;

  return Math.round(value * 100) / 100;
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
