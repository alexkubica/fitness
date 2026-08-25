import type { MealIngredientInput, MealMacroTotals } from "@fitness/db";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import type { MealLogService } from "../../services/meals.js";
import {
  normalizeMcpDateRange,
  previousDaysRange,
  type McpDateRangeInput,
} from "./date-range.js";

export const GET_FOOD_DATABASE_TOOL_NAME = "get_food_database";

export const getFoodDatabaseInputSchema = {
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
  query: z.string().min(1).max(120).optional(),
  proteinOnly: z.boolean().default(false),
  includeTemplates: z.boolean().default(true),
  limit: z.number().int().min(1).max(100).default(50),
};

export const getFoodDatabaseOutputSchema = {
  foodDatabase: z.object({
    range: z.object({
      from: z.string(),
      to: z.string(),
    }),
    itemCount: z.number().int().nonnegative(),
    items: z.array(z.record(z.string(), z.unknown())),
  }),
};

export type FoodDatabaseItem = Readonly<{
  id: string;
  name: string;
  defaultQuantity: number;
  defaultUnit: string;
  defaultGrams?: number | undefined;
  defaultTotals: MealMacroTotals;
  usageCount: number;
  lastUsedAt: string;
  totalMacros: MealMacroTotals;
  sources: readonly ("meal_log" | "template")[];
  exampleMeals: readonly string[];
  proteinDensityGramsPer100Kcal: number;
}>;

export type FoodDatabase = Readonly<{
  range: Readonly<{
    from: string;
    to: string;
  }>;
  itemCount: number;
  items: readonly FoodDatabaseItem[];
}>;

export async function getFoodDatabaseToolResult(input: {
  meals: MealLogService;
  userId: string;
  profileId?: string | undefined;
  range: McpDateRangeInput;
  query?: string | undefined;
  proteinOnly: boolean;
  includeTemplates: boolean;
  limit: number;
}): Promise<CallToolResult> {
  const range =
    input.range.range === undefined &&
    input.range.date === undefined &&
    input.range.preset === undefined
      ? previousDaysRange(90)
      : normalizeMcpDateRange(input.range);
  const [meals, templates] = await Promise.all([
    input.meals.listMeals({
      userId: input.userId,
      profileId: input.profileId,
      range,
      limit: 1_000,
    }),
    input.includeTemplates
      ? input.meals.listTemplates({
          userId: input.userId,
          profileId: input.profileId,
          limit: 200,
        })
      : Promise.resolve([]),
  ]);
  const normalizedQuery = normalizeSearch(input.query ?? "");
  const items = buildFoodDatabaseItems({
    mealEntries: meals.flatMap((meal) =>
      meal.ingredients.map((ingredient) => ({
        ingredient,
        mealTitle: meal.title,
        source: "meal_log" as const,
        usedAt: meal.occurredAt,
      })),
    ),
    templateEntries: templates.flatMap((template) =>
      template.ingredients.map((ingredient) => ({
        ingredient,
        mealTitle: template.title,
        source: "template" as const,
        usedAt: template.lastUsedAt,
        usageCount: template.usageCount,
      })),
    ),
  })
    .filter((item) =>
      normalizedQuery.length === 0
        ? true
        : normalizeSearch(item.name).includes(normalizedQuery),
    )
    .filter((item) => !input.proteinOnly || item.totalMacros.proteinGrams > 0)
    .sort(compareFoodItems)
    .slice(0, input.limit);
  const foodDatabase: FoodDatabase = {
    range,
    itemCount: items.length,
    items,
  };

  return {
    content: [
      {
        type: "text",
        text: formatFoodDatabase(foodDatabase),
      },
    ],
    structuredContent: {
      foodDatabase,
    },
  };
}

function buildFoodDatabaseItems(input: {
  mealEntries: readonly FoodEntry[];
  templateEntries: readonly FoodEntry[];
}): readonly FoodDatabaseItem[] {
  const byKey = new Map<string, MutableFoodItem>();

  for (const entry of [...input.mealEntries, ...input.templateEntries]) {
    const key = foodKey(entry.ingredient);
    const existing = byKey.get(key);
    const usageCount = Math.max(1, entry.usageCount ?? 1);

    if (existing === undefined) {
      byKey.set(key, {
        id: key,
        name: entry.ingredient.name,
        defaultQuantity: entry.ingredient.quantity,
        defaultUnit: entry.ingredient.unit,
        defaultGrams: entry.ingredient.grams,
        defaultTotals: { ...entry.ingredient.totals },
        usageCount,
        lastUsedAt: entry.usedAt,
        totalMacros: scaleTotals(entry.ingredient.totals, usageCount),
        sources: new Set([entry.source]),
        exampleMeals: new Set([entry.mealTitle]),
      });
      continue;
    }

    existing.usageCount += usageCount;
    existing.totalMacros = addTotals(
      existing.totalMacros,
      scaleTotals(entry.ingredient.totals, usageCount),
    );
    existing.sources.add(entry.source);
    existing.exampleMeals.add(entry.mealTitle);

    if (Date.parse(entry.usedAt) > Date.parse(existing.lastUsedAt)) {
      existing.lastUsedAt = entry.usedAt;
      existing.defaultQuantity = entry.ingredient.quantity;
      existing.defaultUnit = entry.ingredient.unit;
      existing.defaultGrams = entry.ingredient.grams;
      existing.defaultTotals = { ...entry.ingredient.totals };
    }
  }

  return Array.from(byKey.values()).map((item) => ({
    ...item,
    totalMacros: roundTotals(item.totalMacros),
    defaultTotals: roundTotals(item.defaultTotals),
    sources: Array.from(item.sources).sort(),
    exampleMeals: Array.from(item.exampleMeals).slice(0, 5),
    proteinDensityGramsPer100Kcal:
      item.totalMacros.calories <= 0
        ? 0
        : round(
            (item.totalMacros.proteinGrams / item.totalMacros.calories) * 100,
          ),
  }));
}

type FoodEntry = Readonly<{
  ingredient: MealIngredientInput;
  mealTitle: string;
  source: "meal_log" | "template";
  usedAt: string;
  usageCount?: number | undefined;
}>;

type MutableFoodItem = {
  id: string;
  name: string;
  defaultQuantity: number;
  defaultUnit: string;
  defaultGrams?: number | undefined;
  defaultTotals: MealMacroTotals;
  usageCount: number;
  lastUsedAt: string;
  totalMacros: MealMacroTotals;
  sources: Set<"meal_log" | "template">;
  exampleMeals: Set<string>;
};

function compareFoodItems(left: FoodDatabaseItem, right: FoodDatabaseItem) {
  if (left.usageCount !== right.usageCount) {
    return right.usageCount - left.usageCount;
  }

  return Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt);
}

function formatFoodDatabase(database: FoodDatabase): string {
  const lines = database.items
    .slice(0, 30)
    .map((item) =>
      [
        item.name,
        `${item.usageCount} uses`,
        `${formatNumber(item.defaultQuantity)} ${item.defaultUnit}`,
        `${formatNumber(item.defaultTotals.calories)} kcal`,
        `P ${formatNumber(item.defaultTotals.proteinGrams)}g`,
        `last ${item.lastUsedAt}`,
      ].join(" | "),
    );

  return [
    `Food database from ${database.range.from} to ${database.range.to}: ${database.itemCount} foods.`,
    ...lines,
  ].join("\n");
}

function foodKey(ingredient: MealIngredientInput): string {
  return `${normalizeSearch(ingredient.name)}|${normalizeSearch(ingredient.unit)}`;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
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

function scaleTotals(totals: MealMacroTotals, factor: number): MealMacroTotals {
  return {
    calories: totals.calories * factor,
    proteinGrams: totals.proteinGrams * factor,
    carbsGrams: totals.carbsGrams * factor,
    fatGrams: totals.fatGrams * factor,
    fiberGrams: totals.fiberGrams * factor,
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

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value);
}
