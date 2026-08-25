import { createNeonClient, getDatabaseUrl } from "@fitness/db/dist/client.js";
import {
  createNeonMealRepository,
  type MealIngredientInput,
  type MealLog,
  type SavedMealTemplate,
  type SqlQueryExecutor,
} from "@fitness/db/dist/meals.js";
import { getSelfProfileId } from "./profile-data";

export type NutritionDashboardData = Readonly<{
  generatedAt: string;
  todayDate: string;
  todayTotals: NutritionTotals;
  recentMeals: readonly MealLog[];
  recentDailyTotals: readonly NutritionDay[];
  savedTemplates: readonly SavedMealTemplate[];
  foodDatabase: readonly FoodDatabaseItem[];
}>;

export type NutritionTotals = Readonly<{
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
  fiberGrams: number;
}>;

export type NutritionDay = Readonly<{
  date: string;
  totals: NutritionTotals;
  mealCount: number;
}>;

export type FoodDatabaseItem = MealIngredientInput &
  Readonly<{
    id: string;
    usageCount: number;
    lastUsedAt: string;
  }>;

const dashboardTimezone = "Asia/Jerusalem";

export async function getNutritionDashboardData(
  userId: string,
): Promise<NutritionDashboardData> {
  const sql = createNeonClient(getDatabaseUrl()) as SqlQueryExecutor;
  const repository = createNeonMealRepository(sql);
  const profileId = await getSelfProfileId(sql, userId);
  const to = new Date();
  const from = new Date(to);

  from.setUTCDate(from.getUTCDate() - 30);

  const [recentMeals, savedTemplates] = await Promise.all([
    repository.listMeals({
      limit: 120,
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      profileId,
      userId,
    }),
    repository.listTemplates({
      limit: 8,
      profileId,
      userId,
    }),
  ]);
  const todayDate = localDate(to.toISOString(), dashboardTimezone);
  const recentDailyTotals = buildDailyTotals(recentMeals);
  const todayTotals =
    recentDailyTotals.find((day) => day.date === todayDate)?.totals ??
    zeroTotals();

  return {
    generatedAt: to.toISOString(),
    todayDate,
    todayTotals,
    recentMeals: recentMeals.slice(0, 12),
    recentDailyTotals,
    savedTemplates,
    foodDatabase: buildFoodDatabase(recentMeals, savedTemplates).slice(0, 50),
  };
}

function buildFoodDatabase(
  meals: readonly MealLog[],
  templates: readonly SavedMealTemplate[],
): readonly FoodDatabaseItem[] {
  const byKey = new Map<string, FoodDatabaseItem>();

  function add(
    ingredient: MealIngredientInput,
    usedAt: string,
    usageCount = 1,
  ): void {
    const key = foodKey(ingredient);
    const existing = byKey.get(key);

    if (
      existing === undefined ||
      Date.parse(usedAt) > Date.parse(existing.lastUsedAt)
    ) {
      byKey.set(key, {
        ...ingredient,
        id: key,
        totals: { ...ingredient.totals },
        usageCount: (existing?.usageCount ?? 0) + Math.max(1, usageCount),
        lastUsedAt: usedAt,
      });
      return;
    }

    byKey.set(key, {
      ...existing,
      usageCount: existing.usageCount + Math.max(1, usageCount),
    });
  }

  for (const meal of meals) {
    for (const ingredient of meal.ingredients) {
      add(ingredient, meal.occurredAt);
    }
  }

  for (const template of templates) {
    for (const ingredient of template.ingredients) {
      add(ingredient, template.lastUsedAt, template.usageCount);
    }
  }

  return Array.from(byKey.values()).sort((left, right) => {
    if (left.usageCount !== right.usageCount) {
      return right.usageCount - left.usageCount;
    }

    return Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt);
  });
}

function foodKey(ingredient: MealIngredientInput): string {
  return `${ingredient.name.trim().toLowerCase().replace(/\s+/g, " ")}|${ingredient.unit.trim().toLowerCase()}`;
}

function buildDailyTotals(meals: readonly MealLog[]): readonly NutritionDay[] {
  const groups = new Map<string, MealLog[]>();

  for (const meal of meals) {
    const date = localDate(meal.occurredAt, meal.timezone);
    const group = groups.get(date) ?? [];

    group.push(meal);
    groups.set(date, group);
  }

  return Array.from(groups.entries())
    .sort(([leftDate], [rightDate]) => rightDate.localeCompare(leftDate))
    .slice(0, 14)
    .map(([date, dayMeals]) => ({
      date,
      mealCount: dayMeals.length,
      totals: sumTotals(dayMeals.map((meal) => meal.totals)),
    }));
}

function sumTotals(totals: readonly NutritionTotals[]): NutritionTotals {
  return {
    calories: round(sum(totals.map((total) => total.calories))),
    proteinGrams: round(sum(totals.map((total) => total.proteinGrams))),
    carbsGrams: round(sum(totals.map((total) => total.carbsGrams))),
    fatGrams: round(sum(totals.map((total) => total.fatGrams))),
    fiberGrams: round(sum(totals.map((total) => total.fiberGrams))),
  };
}

function zeroTotals(): NutritionTotals {
  return {
    calories: 0,
    proteinGrams: 0,
    carbsGrams: 0,
    fatGrams: 0,
    fiberGrams: 0,
  };
}

function localDate(iso: string, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
