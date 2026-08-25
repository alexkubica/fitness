import { createNeonClient, getDatabaseUrl } from "@fitness/db/dist/client.js";
import {
  createNeonDailyMealPlanRepository,
  type DailyMealPlan,
} from "@fitness/db/dist/meal-plans.js";
import type {
  MealMacroTotals,
  SqlQueryExecutor,
} from "@fitness/db/dist/meals.js";
import { getSelfProfileId } from "./profile-data";

export type MealPlanDashboardData = Readonly<{
  selectedDate: string;
  timezone: string;
  plan: DailyMealPlan | undefined;
  futurePlans: readonly Pick<
    DailyMealPlan,
    "id" | "localFoodDate" | "status" | "title" | "version"
  >[];
  plannedTotals: MealMacroTotals;
}>;

const dashboardTimezone = "Asia/Jerusalem";

export async function getMealPlanDashboardData(
  userId: string,
  requestedDate?: string | undefined,
): Promise<MealPlanDashboardData> {
  const sql = createNeonClient(getDatabaseUrl()) as SqlQueryExecutor;
  const profileId = await getSelfProfileId(sql, userId);
  const repository = createNeonDailyMealPlanRepository(sql);
  const today = localDate(new Date(), dashboardTimezone);
  const selectedDate = validLocalDate(requestedDate) ? requestedDate : today;
  const futureTo = addDays(today, 13);
  const [plan, future] = await Promise.all([
    repository.getPlan(profileId, selectedDate),
    repository.listPlans({
      profileId,
      fromLocalFoodDate: today,
      toLocalFoodDate: futureTo,
      includeArchived: false,
    }),
  ]);

  return {
    selectedDate,
    timezone: plan?.timezone ?? dashboardTimezone,
    plan,
    futurePlans: future.map(
      ({ id, localFoodDate, status, title, version }) => ({
        id,
        localFoodDate,
        status,
        title,
        version,
      }),
    ),
    plannedTotals: sumTotals(
      plan?.meals.flatMap((meal) =>
        meal.ingredients.map((item) => item.totals),
      ) ?? [],
    ),
  };
}

function sumTotals(totals: readonly MealMacroTotals[]): MealMacroTotals {
  return totals.reduce<MealMacroTotals>(
    (sum, value) => ({
      calories: round(sum.calories + value.calories),
      proteinGrams: round(sum.proteinGrams + value.proteinGrams),
      carbsGrams: round(sum.carbsGrams + value.carbsGrams),
      fatGrams: round(sum.fatGrams + value.fatGrams),
      fiberGrams: round(sum.fiberGrams + value.fiberGrams),
    }),
    { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0, fiberGrams: 0 },
  );
}

function validLocalDate(value: string | undefined): value is string {
  return value !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function localDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).format(date);
}

function addDays(localFoodDate: string, days: number): string {
  const date = new Date(`${localFoodDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
