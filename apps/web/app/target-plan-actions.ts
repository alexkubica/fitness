"use server";

import { calculateTargetRecommendation } from "@fitness/domain";
import { createNeonClient, getDatabaseUrl } from "@fitness/db/dist/client.js";
import {
  createNeonCoachRepository,
  type SqlQueryExecutor,
} from "@fitness/db/dist/coach.js";
import { createNeonTargetPlanRepository } from "@fitness/db/dist/target-plans.js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentWebSession } from "@/lib/auth";
import { getSelfProfileId } from "@/lib/profile-data";

export async function proposeRecommendationAction(formData: FormData) {
  const { session, sql, profileId } = await ownerContext(formData);
  const profile = await createNeonCoachRepository(sql).getProfile(
    session.userId,
    profileId,
  );
  if (profile === undefined) redirect("/?target_error=missing_profile#coach");
  const repository = createNeonTargetPlanRepository(sql);
  const recommendation = calculateTargetRecommendation({
    goal: profile.goal,
    currentWeightKg: profile.weightKg,
    averageSteps: profile.estimatedStepsPerDay,
    estimatedMaintenanceCalories: profile.targets.maintenanceCalories,
    existingTargets: {
      maintenanceCalories: profile.targets.maintenanceCalories,
      selectedCalories: profile.targets.selectedCalories,
      proteinGrams: profile.targets.proteinGrams,
      carbohydratesGrams: profile.targets.carbsGrams,
      fatGrams: profile.targets.fatGrams,
      fiberGrams: profile.targets.fiberGrams,
      steps: profile.estimatedStepsPerDay,
    },
  });
  await repository.createPlan({
    profileId,
    goal: profile.goal,
    status: "proposed",
    calculationMode: "automatic",
    effectiveFrom: dateFromForm(formData, "effective_from"),
    createdByUserId: session.userId,
    creatorRelationship: "self",
    source: "web_recommendation",
    reason:
      stringFromForm(formData, "reason") ??
      recommendation.explanation.join(" "),
    targets: recommendation.targets,
    idempotencyKey: stringFromForm(formData, "idempotency_key"),
  });
  finish();
}

export async function approveTargetPlanAction(formData: FormData) {
  const { session, sql, profileId } = await ownerContext(formData);
  const planId = requiredString(formData, "plan_id");
  await createNeonTargetPlanRepository(sql).activatePlan({
    profileId,
    planId,
    actorUserId: session.userId,
    effectiveFrom: dateFromForm(formData, "effective_from"),
    ownerResponse: stringFromForm(formData, "owner_response"),
    reason: "Approved in the profile-owner web dashboard.",
    idempotencyKey: `web-approve:${planId}:${dateFromForm(formData, "effective_from")}`,
  });
  finish();
}

export async function rejectTargetPlanAction(formData: FormData) {
  const { session, sql, profileId } = await ownerContext(formData);
  const planId = requiredString(formData, "plan_id");
  await createNeonTargetPlanRepository(sql).rejectPlan({
    profileId,
    planId,
    actorUserId: session.userId,
    ownerResponse: requiredString(formData, "owner_response"),
    reason: "Rejected in the profile-owner web dashboard.",
    idempotencyKey: `web-reject:${planId}`,
  });
  finish();
}

async function ownerContext(formData: FormData) {
  const session = await currentWebSession();
  if (session === undefined) redirect("/api/auth/google/start?return_to=/");
  const sql = createNeonClient(getDatabaseUrl()) as SqlQueryExecutor;
  const profileId = await getSelfProfileId(sql, session.userId);
  if (requiredString(formData, "profile_id") !== profileId) {
    throw new Error("Profile is not accessible from this owner dashboard.");
  }
  return { session, sql, profileId };
}

function dateFromForm(formData: FormData, key: string): string {
  const value = requiredString(formData, key);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value))
    throw new Error(`${key} is invalid.`);
  return value;
}

function requiredString(formData: FormData, key: string): string {
  const value = stringFromForm(formData, key);
  if (value === undefined) throw new Error(`${key} is required.`);
  return value;
}

function stringFromForm(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function finish(): never {
  revalidatePath("/");
  redirect("/#coach");
}
