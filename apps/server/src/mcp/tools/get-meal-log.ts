import type { MealLog } from "@fitness/db";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import type { MealLogService } from "../../services/meals.js";
import {
  normalizeMcpDateRange,
  type McpDateRange,
  type McpDateRangeInput,
} from "./date-range.js";

export const GET_MEAL_LOG_TOOL_NAME = "get_meal_log";

export const getMealLogInputSchema = {
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
  limit: z.number().int().min(1).max(100).default(50),
};

export const getMealLogOutputSchema = {
  mealLog: z.object({
    range: z.object({
      from: z.string(),
      to: z.string(),
    }),
    localDate: z.string().optional(),
    timezone: z.string().optional(),
    utcRange: z.object({
      from: z.string(),
      to: z.string(),
    }),
    mealCount: z.number().int().nonnegative(),
    totals: z.record(z.string(), z.number()),
    meals: z.array(z.record(z.string(), z.unknown())),
  }),
};

export type MealLogSummary = Readonly<{
  range: McpDateRange;
  localDate?: string | undefined;
  timezone?: string | undefined;
  utcRange: McpDateRange;
  mealCount: number;
  totals: Readonly<{
    calories: number;
    proteinGrams: number;
    carbsGrams: number;
    fatGrams: number;
    fiberGrams: number;
  }>;
  meals: readonly MealLog[];
}>;

export async function getMealLogToolResult(input: {
  meals: MealLogService;
  userId: string;
  profileId?: string | undefined;
  range: McpDateRangeInput;
  limit: number;
}): Promise<CallToolResult> {
  const range = normalizeMcpDateRange(input.range);
  const meals = await input.meals.listMeals({
    limit: input.limit,
    range,
    userId: input.userId,
    profileId: input.profileId,
  });
  const mealLog = summarizeMeals(meals, range);

  return {
    content: [
      {
        type: "text",
        text: formatMealLog(mealLog),
      },
    ],
    structuredContent: {
      mealLog,
    },
  };
}

export function summarizeMeals(
  meals: readonly MealLog[],
  range: McpDateRange,
): MealLogSummary {
  return {
    range,
    localDate: range.localDate,
    timezone: range.timezone,
    utcRange: {
      from: range.from,
      to: range.to,
    },
    mealCount: meals.length,
    totals: {
      calories: round(sum(meals.map((meal) => meal.totals.calories))),
      proteinGrams: round(sum(meals.map((meal) => meal.totals.proteinGrams))),
      carbsGrams: round(sum(meals.map((meal) => meal.totals.carbsGrams))),
      fatGrams: round(sum(meals.map((meal) => meal.totals.fatGrams))),
      fiberGrams: round(sum(meals.map((meal) => meal.totals.fiberGrams))),
    },
    meals,
  };
}

function formatMealLog(summary: MealLogSummary): string {
  const lines = summary.meals
    .slice(0, 30)
    .map((meal) =>
      [
        localDateTime(meal.occurredAt, meal.timezone),
        meal.mealType,
        meal.title,
        `${formatNumber(meal.totals.calories)} kcal`,
        `P ${formatNumber(meal.totals.proteinGrams)}g`,
        `C ${formatNumber(meal.totals.carbsGrams)}g`,
        `F ${formatNumber(meal.totals.fatGrams)}g`,
        `Fiber ${formatNumber(meal.totals.fiberGrams)}g`,
        `${meal.ingredients.length} ingredients`,
        `${meal.photoCount} photos`,
      ].join(" | "),
    );

  return [
    `Meal log from ${summary.range.from} to ${summary.range.to}: ${summary.mealCount} meals.`,
    summary.localDate === undefined || summary.timezone === undefined
      ? "Range was provided as explicit UTC timestamps."
      : `Local food day: ${summary.localDate} (${summary.timezone}); UTC range ${summary.utcRange.from} to ${summary.utcRange.to}.`,
    `Totals: ${formatNumber(summary.totals.calories)} kcal, ${formatNumber(summary.totals.proteinGrams)}g protein, ${formatNumber(summary.totals.carbsGrams)}g carbs, ${formatNumber(summary.totals.fatGrams)}g fat, ${formatNumber(summary.totals.fiberGrams)}g fiber.`,
    ...lines,
  ].join("\n");
}

function localDateTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).format(new Date(iso));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value);
}
