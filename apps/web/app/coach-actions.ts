"use server";

import {
  calculateNutritionTargets,
  localDateInTimezone,
} from "@fitness/domain";
import { createNeonClient, getDatabaseUrl } from "@fitness/db/dist/client.js";
import {
  createNeonCoachRepository,
  type CoachGoal,
  type CoachMealSlot,
  type SqlQueryExecutor,
} from "@fitness/db/dist/coach.js";
import { createNeonTargetPlanRepository } from "@fitness/db/dist/target-plans.js";
import { createNeonProfileRepository } from "@fitness/db/dist/profiles.js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentWebSession } from "@/lib/auth";
import { getSelfProfileId } from "@/lib/profile-data";

const coachErrorRedirect = "/?coach_error=1#coach";

export async function saveCoachProfileAction(
  formData: FormData,
): Promise<void> {
  const session = await requireWebSession();
  const goal = coachGoalFromForm(formData);
  const weightKg = numberFromForm(formData, "weight_kg", 20, 400);
  const estimatedStepsPerDay = integerFromForm(
    formData,
    "estimated_steps_per_day",
    0,
    100_000,
  );
  const estimatedActiveCaloriesPerDay = optionalNumberFromForm(
    formData,
    "estimated_active_calories_per_day",
    0,
    10_000,
  );
  const estimatedRestingCaloriesPerDay = optionalNumberFromForm(
    formData,
    "estimated_resting_calories_per_day",
    500,
    5_000,
  );
  const wakeTimeMinutes = timeMinutesFromForm(formData, "wake_time", 450);
  const sleepTimeMinutes = timeMinutesFromForm(formData, "sleep_time", 1_410);
  const mealRemindersEnabled = formData.get("meal_reminders_enabled") === "on";
  const mealSlots = mealSlotsFromForm(formData);
  const sql = createNeonClient(getDatabaseUrl()) as SqlQueryExecutor;
  const profileId = await getSelfProfileId(sql, session.userId);

  const completedAt = new Date().toISOString();
  const profileAccess = await createNeonProfileRepository(sql).getProfileAccess(
    {
      userId: session.userId,
      profileId,
    },
  );
  const profile = await coachRepository(sql).upsertProfile({
    userId: session.userId,
    profileId,
    goal,
    weightKg,
    estimatedStepsPerDay,
    estimatedActiveCaloriesPerDay,
    estimatedRestingCaloriesPerDay,
    wakeTimeMinutes,
    sleepTimeMinutes,
    mealRemindersEnabled,
    mealSlots,
    targets: calculateNutritionTargets({
      goal,
      weightKg,
      estimatedStepsPerDay,
      estimatedActiveCaloriesPerDay,
      estimatedRestingCaloriesPerDay,
    }),
    source: "web",
    completedAt,
  });
  const targetPlans = createNeonTargetPlanRepository(sql);
  const draft = await targetPlans.createPlan({
    profileId,
    goal,
    status: "draft",
    calculationMode: "automatic",
    effectiveFrom: localDateInTimezone(
      new Date(completedAt),
      profileAccess?.profile.timezone ?? "UTC",
    ),
    createdByUserId: session.userId,
    creatorRelationship: "self",
    source: "coach_profile_compatibility",
    reason: "Updated through the legacy coach profile web form.",
    targets: {
      maintenanceCalories: profile.targets.maintenanceCalories,
      selectedCalories: profile.targets.selectedCalories,
      proteinGrams: profile.targets.proteinGrams,
      carbohydratesGrams: profile.targets.carbsGrams,
      fatGrams: profile.targets.fatGrams,
      fiberGrams: profile.targets.fiberGrams,
      steps: profile.estimatedStepsPerDay,
    },
  });
  await targetPlans.activatePlan({
    profileId,
    planId: draft.id,
    actorUserId: session.userId,
    effectiveFrom: draft.effectiveFrom,
    reason: draft.reason,
  });

  revalidatePath("/");
  redirect("/#coach");
}

async function requireWebSession() {
  const session = await currentWebSession();

  if (session === undefined) {
    redirect("/api/auth/google/start?return_to=/");
  }

  return session;
}

function coachRepository(sql: SqlQueryExecutor) {
  return createNeonCoachRepository(sql);
}

function mealSlotsFromForm(formData: FormData): readonly CoachMealSlot[] {
  const names = formData.getAll("meal_slot_name");
  const times = formData.getAll("meal_slot_time");
  const reminders = formData.getAll("meal_slot_reminders_enabled");

  return names.flatMap((nameValue, index) => {
    if (typeof nameValue !== "string") {
      return [];
    }

    const name = nameValue.trim();

    if (name.length === 0) {
      return [];
    }

    return [
      {
        id: slugId(name, index),
        name,
        timeMinutes: timeMinutesFromValue(times[index], defaultSlotTime(index)),
        remindersEnabled: reminders[index] !== "no",
      },
    ];
  });
}

function coachGoalFromForm(formData: FormData): CoachGoal {
  const value = optionalText(formData, "goal");

  if (
    value === "lose_weight" ||
    value === "maintain" ||
    value === "gain_mass"
  ) {
    return value;
  }

  redirect(coachErrorRedirect);
}

function timeMinutesFromForm(
  formData: FormData,
  name: string,
  fallback: number,
): number {
  return timeMinutesFromValue(formData.get(name), fallback);
}

function timeMinutesFromValue(
  value: FormDataEntryValue | null | undefined,
  fallback: number,
): number {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }

  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    redirect(coachErrorRedirect);
  }

  return hour * 60 + minute;
}

function numberFromForm(
  formData: FormData,
  name: string,
  min: number,
  max: number,
): number {
  const value = optionalText(formData, name);
  const parsed = value === undefined ? Number.NaN : Number(value);

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    redirect(coachErrorRedirect);
  }

  return Math.round(parsed * 10) / 10;
}

function integerFromForm(
  formData: FormData,
  name: string,
  min: number,
  max: number,
): number {
  const parsed = numberFromForm(formData, name, min, max);

  if (!Number.isInteger(parsed)) {
    redirect(coachErrorRedirect);
  }

  return parsed;
}

function optionalNumberFromForm(
  formData: FormData,
  name: string,
  min: number,
  max: number,
): number | undefined {
  const raw = formData.get(name);

  if (typeof raw !== "string" || raw.trim().length === 0) {
    return undefined;
  }

  return numberFromForm(formData, name, min, max);
}

function optionalText(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? undefined : trimmed;
}

function slugId(name: string, index: number): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

  return slug.length === 0 ? `meal-${index + 1}` : slug;
}

function defaultSlotTime(index: number): number {
  return [540, 780, 990, 1_200][index] ?? Math.min(1_320, 540 + index * 180);
}
