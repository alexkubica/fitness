"use server";

import { randomUUID } from "node:crypto";
import { createNeonClient, getDatabaseUrl } from "@fitness/db/dist/client.js";
import {
  createNeonMealRepository,
  type MealLogInput,
  type MealMacroTotals,
  type SqlQueryExecutor,
} from "@fitness/db/dist/meals.js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentWebSession } from "@/lib/auth";
import { getSelfProfileId } from "@/lib/profile-data";

const dashboardTimezone = "Asia/Jerusalem";
const mealErrorRedirect = "/?meal_error=1#food-log";

export async function createMealAction(formData: FormData): Promise<void> {
  const session = await requireWebSession();
  const now = new Date().toISOString();
  const clientMealId = randomUUID();
  const title = requiredText(formData, "title");
  const note = optionalText(formData, "note");
  const totals = totalsFromForm(formData);
  const sql = createNeonClient(getDatabaseUrl()) as SqlQueryExecutor;
  const profileId = await getSelfProfileId(sql, session.userId);

  await mealRepository(sql).upsertMeal({
    userId: session.userId,
    profileId,
    idempotencyKey: `web-meal:${clientMealId}`,
    clientMealId,
    occurredAt: dateTimeFromForm(formData, "occurred_at") ?? now,
    timezone: dashboardTimezone,
    title,
    mealType: optionalText(formData, "meal_type") ?? "Meal",
    note,
    totals,
    ingredients: ingredientFromForm(formData, totals),
    photoCount: 0,
    estimateStatus: "manual",
    origin: "web",
    provenance: {
      client: "web",
      version: 1,
    },
  });

  revalidatePath("/");
  redirect("/#food-log");
}

export async function updateMealAction(formData: FormData): Promise<void> {
  const session = await requireWebSession();
  const idempotencyKey = requiredText(formData, "idempotency_key");
  const title = requiredText(formData, "title");
  const note = optionalText(formData, "note");
  const totals = totalsFromForm(formData);
  const sql = createNeonClient(getDatabaseUrl()) as SqlQueryExecutor;
  const profileId = await getSelfProfileId(sql, session.userId);

  const input: MealLogInput = {
    userId: session.userId,
    profileId,
    idempotencyKey,
    clientMealId: optionalText(formData, "client_meal_id"),
    occurredAt:
      dateTimeFromForm(formData, "occurred_at") ?? new Date().toISOString(),
    timezone: optionalText(formData, "timezone") ?? dashboardTimezone,
    title,
    mealType: optionalText(formData, "meal_type") ?? "Meal",
    note,
    totals,
    ingredients: ingredientFromForm(formData, totals),
    photoCount: integerFromForm(formData, "photo_count") ?? 0,
    estimateStatus: "manual",
    origin: "web",
    provenance: {
      client: "web",
      version: 1,
      source: "dashboard-edit",
    },
  };

  await mealRepository(sql).upsertMeal(input);

  revalidatePath("/");
  redirect("/#food-log");
}

export async function deleteMealAction(formData: FormData): Promise<void> {
  const session = await requireWebSession();
  const confirmed = formData.get("confirm_delete") === "yes";

  if (!confirmed) {
    redirect(mealErrorRedirect);
  }

  const sql = createNeonClient(getDatabaseUrl()) as SqlQueryExecutor;
  const profileId = await getSelfProfileId(sql, session.userId);

  await mealRepository(sql).deleteMeal({
    userId: session.userId,
    profileId,
    id: requiredText(formData, "meal_id"),
    deletedAt: new Date().toISOString(),
  });

  revalidatePath("/");
  redirect("/#food-log");
}

async function requireWebSession() {
  const session = await currentWebSession();

  if (session === undefined) {
    redirect("/api/auth/google/start?return_to=/");
  }

  return session;
}

function mealRepository(sql: SqlQueryExecutor) {
  return createNeonMealRepository(sql);
}

function totalsFromForm(formData: FormData): MealMacroTotals {
  return {
    calories: numberFromForm(formData, "calories"),
    proteinGrams: numberFromForm(formData, "protein_grams"),
    carbsGrams: numberFromForm(formData, "carbs_grams"),
    fatGrams: numberFromForm(formData, "fat_grams"),
    fiberGrams: numberFromForm(formData, "fiber_grams"),
  };
}

function ingredientFromForm(
  formData: FormData,
  totals: MealMacroTotals,
): MealLogInput["ingredients"] {
  const name = optionalText(formData, "ingredient_name");
  const quickFoods = quickFoodsFromForm(formData);

  if (name === undefined) {
    return quickFoods;
  }

  return [
    ...quickFoods,
    {
      clientIngredientId: optionalText(formData, "ingredient_id"),
      name,
      quantity: numberFromForm(formData, "ingredient_quantity", 1),
      unit: optionalText(formData, "ingredient_unit") ?? "serving",
      grams: optionalNumberFromForm(formData, "ingredient_grams"),
      totals: {
        calories: numberFromForm(
          formData,
          "ingredient_calories",
          totals.calories,
        ),
        proteinGrams: numberFromForm(
          formData,
          "ingredient_protein_grams",
          totals.proteinGrams,
        ),
        carbsGrams: numberFromForm(
          formData,
          "ingredient_carbs_grams",
          totals.carbsGrams,
        ),
        fatGrams: numberFromForm(
          formData,
          "ingredient_fat_grams",
          totals.fatGrams,
        ),
        fiberGrams: numberFromForm(
          formData,
          "ingredient_fiber_grams",
          totals.fiberGrams,
        ),
      },
    },
  ];
}

function quickFoodsFromForm(formData: FormData): MealLogInput["ingredients"] {
  return formData
    .getAll("quick_food")
    .flatMap((value): MealLogInput["ingredients"] => {
      if (typeof value !== "string") {
        return [];
      }

      try {
        const parsed = JSON.parse(value) as unknown;

        return isQuickFood(parsed)
          ? [
              {
                clientIngredientId: randomUUID(),
                name: parsed.name,
                quantity: parsed.quantity,
                unit: parsed.unit,
                grams: parsed.grams,
                totals: parsed.totals,
              },
            ]
          : [];
      } catch {
        return [];
      }
    });
}

function isQuickFood(value: unknown): value is {
  name: string;
  quantity: number;
  unit: string;
  grams?: number;
  totals: MealMacroTotals;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const totals = record.totals;

  return (
    typeof record.name === "string" &&
    typeof record.quantity === "number" &&
    typeof record.unit === "string" &&
    (record.grams === undefined || typeof record.grams === "number") &&
    typeof totals === "object" &&
    totals !== null &&
    typeof (totals as Record<string, unknown>).calories === "number" &&
    typeof (totals as Record<string, unknown>).proteinGrams === "number" &&
    typeof (totals as Record<string, unknown>).carbsGrams === "number" &&
    typeof (totals as Record<string, unknown>).fatGrams === "number" &&
    typeof (totals as Record<string, unknown>).fiberGrams === "number"
  );
}

function requiredText(formData: FormData, name: string): string {
  const value = optionalText(formData, name);

  if (value === undefined) {
    redirect(mealErrorRedirect);
  }

  return value;
}

function optionalText(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? undefined : trimmed;
}

function numberFromForm(
  formData: FormData,
  name: string,
  fallback?: number,
): number {
  const value = optionalNumberFromForm(formData, name);

  if (value === undefined) {
    if (fallback !== undefined) {
      return fallback;
    }

    redirect(mealErrorRedirect);
  }

  return value;
}

function optionalNumberFromForm(
  formData: FormData,
  name: string,
): number | undefined {
  const value = optionalText(formData, name);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    redirect(mealErrorRedirect);
  }

  return Math.round(parsed * 10) / 10;
}

function integerFromForm(formData: FormData, name: string): number | undefined {
  const value = optionalNumberFromForm(formData, name);

  return value === undefined ? undefined : Math.round(value);
}

function dateTimeFromForm(
  formData: FormData,
  name: string,
): string | undefined {
  const value = optionalText(formData, name);

  if (value === undefined) {
    return undefined;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    redirect(mealErrorRedirect);
  }

  return parsed.toISOString();
}
