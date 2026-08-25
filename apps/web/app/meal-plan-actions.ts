"use server";

import { randomUUID } from "node:crypto";
import { createNeonClient, getDatabaseUrl } from "@fitness/db/dist/client.js";
import { createNeonDailyMealPlanRepository } from "@fitness/db/dist/meal-plans.js";
import { createNeonProfileRepository } from "@fitness/db/dist/profiles.js";
import { createAuthorizationService } from "@fitness/server/dist/services/authorization.js";
import { createRepositoryProfileService } from "@fitness/server/dist/services/profiles.js";
import {
  createNeonMealRepository,
  type SqlQueryExecutor,
} from "@fitness/db/dist/meals.js";
import {
  createRepositoryMealLogService,
  createRepositoryMealLogSnapshotService,
  createSnapshottingMealLogService,
} from "@fitness/server/dist/services/meals.js";
import {
  createRepositoryMealPlanService,
  type MealPlanAccessContext,
} from "@fitness/server/dist/services/meal-plans.js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentWebSession } from "@/lib/auth";
import { getSelfProfileId } from "@/lib/profile-data";

export async function copyPreviousMealPlanAction(
  formData: FormData,
): Promise<void> {
  const context = await mealPlanActionContext();
  const destination = requiredText(formData, "local_food_date");
  await context.service.copyDailyPlan({
    access: context.access,
    sourceLocalFoodDate: addDays(destination, -1),
    destinationLocalFoodDate: destination,
    timezone: requiredText(formData, "timezone"),
    idempotencyKey: `web-plan-copy:${destination}:${randomUUID()}`,
    confirmReplace: formData.get("confirm_replace") === "yes",
    expectedDestinationVersion: optionalNumber(formData, "expected_version"),
  });
  finish(destination);
}

export async function markPlannedMealStatusAction(
  formData: FormData,
): Promise<void> {
  const context = await mealPlanActionContext();
  const localFoodDate = requiredText(formData, "local_food_date");
  await context.service.markPlannedMealStatus({
    access: context.access,
    plannedMealId: requiredText(formData, "planned_meal_id"),
    status: "skipped",
    expectedPlanVersion: requiredNumber(formData, "plan_version"),
    expectedMealVersion: requiredNumber(formData, "meal_version"),
  });
  finish(localFoodDate);
}

export async function convertPlannedMealAction(
  formData: FormData,
): Promise<void> {
  const context = await mealPlanActionContext();
  const localFoodDate = requiredText(formData, "local_food_date");
  const plannedMealId = requiredText(formData, "planned_meal_id");
  const fraction = Math.min(
    1,
    Math.max(0.01, requiredNumber(formData, "actual_fraction")),
  );
  const found = await context.service.getPlannedMeal({
    access: context.access,
    plannedMealId,
  });
  if (found === undefined)
    redirect(`/?plan_error=1&plan_date=${localFoodDate}#meal-plan`);
  await context.service.convertPlannedMealToLog({
    access: context.access,
    plannedMealId,
    status: fraction === 1 ? "eaten_as_planned" : "partially_eaten",
    expectedPlanVersion: requiredNumber(formData, "plan_version"),
    expectedMealVersion: requiredNumber(formData, "meal_version"),
    actualIngredients:
      fraction === 1
        ? undefined
        : found.plannedMeal.ingredients.map((ingredient) => ({
            foodReferenceType: ingredient.foodReferenceType,
            foodReferenceId: ingredient.foodReferenceId,
            displayName: ingredient.displayName,
            quantity: ingredient.quantity * fraction,
            unit: ingredient.unit,
            grams:
              ingredient.grams === undefined
                ? undefined
                : ingredient.grams * fraction,
            totals: {
              calories: ingredient.totals.calories * fraction,
              proteinGrams: ingredient.totals.proteinGrams * fraction,
              carbsGrams: ingredient.totals.carbsGrams * fraction,
              fatGrams: ingredient.totals.fatGrams * fraction,
              fiberGrams: ingredient.totals.fiberGrams * fraction,
            },
            alternativeGroup: ingredient.alternativeGroup,
            notes: ingredient.notes,
            sortOrder: ingredient.sortOrder,
          })),
    origin: "web",
  });
  finish(localFoodDate);
}

async function mealPlanActionContext() {
  const session = await currentWebSession();
  if (session === undefined) redirect("/api/auth/google/start?return_to=/");
  const sql = createNeonClient(getDatabaseUrl()) as SqlQueryExecutor;
  const profileId = await getSelfProfileId(sql, session.userId);
  const permissions = await createAuthorizationService(
    createRepositoryProfileService(createNeonProfileRepository(sql)),
  ).getEffectivePermissions(session.userId, profileId);
  const mealRepository = createNeonMealRepository(sql);
  const mealService = createSnapshottingMealLogService(
    createRepositoryMealLogService(mealRepository),
    createRepositoryMealLogSnapshotService(mealRepository),
  );
  const access: MealPlanAccessContext = {
    actorUserId: session.userId,
    subjectUserId: session.userId,
    profileId,
    permissions,
  };
  return {
    access,
    service: createRepositoryMealPlanService(
      createNeonDailyMealPlanRepository(sql),
      { meals: mealService },
    ),
  };
}

function finish(localFoodDate: string): never {
  revalidatePath("/");
  redirect(`/?plan_date=${localFoodDate}#meal-plan`);
}

function requiredText(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${name} is required.`);
  return value;
}

function requiredNumber(formData: FormData, name: string): number {
  const value = Number(requiredText(formData, name));
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric.`);
  return value;
}

function optionalNumber(formData: FormData, name: string): number | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value !== "" ? Number(value) : undefined;
}

function addDays(localFoodDate: string, days: number): string {
  const date = new Date(`${localFoodDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
