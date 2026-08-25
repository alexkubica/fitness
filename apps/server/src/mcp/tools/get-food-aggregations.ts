import type { MealLog, MealMacroTotals } from "@fitness/db";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import type { MealLogService } from "../../services/meals.js";
import { normalizeMcpDateRange, type McpDateRangeInput } from "./date-range.js";

export const GET_FOOD_AGGREGATIONS_TOOL_NAME = "get_food_aggregations";

const groupByValues = ["food", "meal", "day"] as const;
const sortByValues = [
  "usage_count",
  "calories",
  "protein",
  "protein_density",
] as const;

export type FoodAggregationGroupBy = (typeof groupByValues)[number];
export type FoodAggregationSortBy = (typeof sortByValues)[number];

export const getFoodAggregationsInputSchema = {
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
  groupBy: z.enum(groupByValues).default("food"),
  sortBy: z.enum(sortByValues).default("usage_count"),
  query: z.string().min(1).max(120).optional(),
  minProteinGrams: z.number().min(0).optional(),
  limit: z.number().int().min(1).max(100).default(20),
};

export const getFoodAggregationsOutputSchema = {
  foodAggregations: z.object({
    range: z.object({
      from: z.string(),
      to: z.string(),
    }),
    groupBy: z.enum(groupByValues),
    sortBy: z.enum(sortByValues),
    groupCount: z.number().int().nonnegative(),
    groups: z.array(z.record(z.string(), z.unknown())),
  }),
};

export type FoodAggregationGroup = Readonly<{
  key: string;
  label: string;
  usageCount: number;
  mealCount: number;
  totals: MealMacroTotals;
  proteinDensityGramsPer100Kcal: number;
  examples: readonly string[];
}>;

export type FoodAggregations = Readonly<{
  range: Readonly<{
    from: string;
    to: string;
  }>;
  groupBy: FoodAggregationGroupBy;
  sortBy: FoodAggregationSortBy;
  groupCount: number;
  groups: readonly FoodAggregationGroup[];
}>;

export async function getFoodAggregationsToolResult(input: {
  meals: MealLogService;
  userId: string;
  profileId?: string | undefined;
  range: McpDateRangeInput;
  groupBy: FoodAggregationGroupBy;
  sortBy: FoodAggregationSortBy;
  query?: string | undefined;
  minProteinGrams?: number | undefined;
  limit: number;
}): Promise<CallToolResult> {
  const range = normalizeMcpDateRange(input.range);
  const meals = await input.meals.listMeals({
    userId: input.userId,
    profileId: input.profileId,
    range,
    limit: 1_000,
  });
  const normalizedQuery = normalizeSearch(input.query ?? "");
  const groups = buildFoodAggregationGroups(meals, input.groupBy)
    .filter((group) =>
      normalizedQuery.length === 0
        ? true
        : normalizeSearch(group.label).includes(normalizedQuery) ||
          group.examples.some((example) =>
            normalizeSearch(example).includes(normalizedQuery),
          ),
    )
    .filter((group) =>
      input.minProteinGrams === undefined
        ? true
        : group.totals.proteinGrams >= input.minProteinGrams,
    )
    .sort((left, right) => compareGroups(left, right, input.sortBy))
    .slice(0, input.limit);
  const foodAggregations: FoodAggregations = {
    range,
    groupBy: input.groupBy,
    sortBy: input.sortBy,
    groupCount: groups.length,
    groups,
  };

  return {
    content: [
      {
        type: "text",
        text: formatFoodAggregations(foodAggregations),
      },
    ],
    structuredContent: {
      foodAggregations,
    },
  };
}

function buildFoodAggregationGroups(
  meals: readonly MealLog[],
  groupBy: FoodAggregationGroupBy,
): readonly FoodAggregationGroup[] {
  const groups = new Map<string, MutableGroup>();

  for (const meal of meals) {
    if (groupBy === "meal") {
      addToGroup(groups, meal.mealType, meal.mealType, meal.totals, meal.title);
      continue;
    }

    if (groupBy === "day") {
      const date = localDate(meal.occurredAt, meal.timezone);

      addToGroup(groups, date, date, meal.totals, meal.title);
      continue;
    }

    for (const ingredient of meal.ingredients) {
      addToGroup(
        groups,
        `${normalizeSearch(ingredient.name)}|${normalizeSearch(ingredient.unit)}`,
        ingredient.name,
        ingredient.totals,
        meal.title,
      );
    }
  }

  return Array.from(groups.values()).map((group) => ({
    key: group.key,
    label: group.label,
    usageCount: group.usageCount,
    mealCount: group.mealTitles.size,
    totals: roundTotals(group.totals),
    proteinDensityGramsPer100Kcal:
      group.totals.calories <= 0
        ? 0
        : round((group.totals.proteinGrams / group.totals.calories) * 100),
    examples: Array.from(group.mealTitles).slice(0, 5),
  }));
}

type MutableGroup = {
  key: string;
  label: string;
  usageCount: number;
  totals: MealMacroTotals;
  mealTitles: Set<string>;
};

function addToGroup(
  groups: Map<string, MutableGroup>,
  key: string,
  label: string,
  totals: MealMacroTotals,
  mealTitle: string,
): void {
  const existing = groups.get(key);

  if (existing === undefined) {
    groups.set(key, {
      key,
      label,
      usageCount: 1,
      totals: { ...totals },
      mealTitles: new Set([mealTitle]),
    });
    return;
  }

  existing.usageCount += 1;
  existing.totals = addTotals(existing.totals, totals);
  existing.mealTitles.add(mealTitle);
}

function compareGroups(
  left: FoodAggregationGroup,
  right: FoodAggregationGroup,
  sortBy: FoodAggregationSortBy,
): number {
  switch (sortBy) {
    case "calories":
      return right.totals.calories - left.totals.calories;
    case "protein":
      return right.totals.proteinGrams - left.totals.proteinGrams;
    case "protein_density":
      return (
        right.proteinDensityGramsPer100Kcal - left.proteinDensityGramsPer100Kcal
      );
    case "usage_count":
      return right.usageCount - left.usageCount;
  }
}

function formatFoodAggregations(aggregations: FoodAggregations): string {
  const lines = aggregations.groups
    .slice(0, 30)
    .map((group) =>
      [
        group.label,
        `${group.usageCount} uses`,
        `${formatNumber(group.totals.calories)} kcal`,
        `P ${formatNumber(group.totals.proteinGrams)}g`,
        `density ${formatNumber(group.proteinDensityGramsPer100Kcal)}g/100kcal`,
      ].join(" | "),
    );

  return [
    `Food aggregations from ${aggregations.range.from} to ${aggregations.range.to}: ${aggregations.groupCount} ${aggregations.groupBy} groups sorted by ${aggregations.sortBy}.`,
    ...lines,
  ].join("\n");
}

function addTotals(
  left: MealMacroTotals,
  right: MealMacroTotals,
): MealMacroTotals {
  return {
    calories: left.calories + right.calories,
    proteinGrams: left.proteinGrams + right.proteinGrams,
    carbsGrams: left.carbsGrams + right.carbsGrams,
    fatGrams: left.fatGrams + right.fatGrams,
    fiberGrams: left.fiberGrams + right.fiberGrams,
  };
}

function roundTotals(totals: MealMacroTotals): MealMacroTotals {
  return {
    calories: round(totals.calories),
    proteinGrams: round(totals.proteinGrams),
    carbsGrams: round(totals.carbsGrams),
    fatGrams: round(totals.fatGrams),
    fiberGrams: round(totals.fiberGrams),
  };
}

function localDate(iso: string, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: timezone,
      year: "numeric",
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value);
}
