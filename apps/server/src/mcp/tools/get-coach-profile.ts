import type { CoachProfile } from "@fitness/db";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import type { CoachService } from "../../services/coach.js";
import type { ProfileContext } from "../../services/profiles.js";
import type { TargetPlanService } from "../../services/target-plans.js";

export const GET_COACH_PROFILE_TOOL_NAME = "get_coach_profile";

export const getCoachProfileInputSchema = {
  profileId: z.string().min(1).max(120).optional(),
};

export const getCoachProfileOutputSchema = {
  profile: z.record(z.string(), z.unknown()).nullable(),
  targetPlan: z.record(z.string(), z.unknown()).nullable(),
};

export async function getCoachProfileToolResult(input: {
  coach: CoachService;
  userId: string;
  profileId?: string | undefined;
  profileContext: ProfileContext;
  targetPlans: TargetPlanService;
}): Promise<CallToolResult> {
  const storedProfile = await input.coach.getProfile(
    input.userId,
    input.profileId,
  );
  const targetPlan = await input.targetPlans.getActivePlan(
    input.profileContext,
  );
  const profile =
    storedProfile === undefined || targetPlan === undefined
      ? storedProfile
      : {
          ...storedProfile,
          estimatedStepsPerDay: targetPlan.targets.steps,
          targets: {
            ...storedProfile.targets,
            maintenanceCalories: targetPlan.targets.maintenanceCalories,
            selectedCalories: targetPlan.targets.selectedCalories,
            proteinGrams: targetPlan.targets.proteinGrams,
            carbsGrams: targetPlan.targets.carbohydratesGrams,
            fatGrams: targetPlan.targets.fatGrams,
            fiberGrams: targetPlan.targets.fiberGrams,
          },
        };

  return {
    content: [
      {
        type: "text",
        text:
          profile === undefined
            ? "No coach profile is saved yet."
            : formatCoachProfile(profile),
      },
    ],
    structuredContent: {
      profile: profile ?? null,
      targetPlan: targetPlan ?? null,
    },
  };
}

function formatCoachProfile(profile: CoachProfile): string {
  return [
    `Goal: ${profile.goal}.`,
    `Weight: ${formatNumber(profile.weightKg)} kg. Steps estimate: ${formatNumber(profile.estimatedStepsPerDay)} per day.${activityEnergyText(profile)}`,
    `Targets: ${formatNumber(profile.targets.selectedCalories)} kcal, P ${formatNumber(profile.targets.proteinGrams)}g, C ${formatNumber(profile.targets.carbsGrams)}g, F ${formatNumber(profile.targets.fatGrams)}g, Fiber ${formatNumber(profile.targets.fiberGrams)}g.`,
    `Meal slots: ${profile.mealSlots.map((slot) => slot.name).join(", ") || "none"}.`,
    `Updated: ${profile.updatedAt}.`,
  ].join("\n");
}

function activityEnergyText(profile: CoachProfile): string {
  if (
    profile.estimatedActiveCaloriesPerDay === undefined &&
    profile.estimatedRestingCaloriesPerDay === undefined
  ) {
    return "";
  }

  return ` Active/resting estimate: ${formatOptionalNumber(profile.estimatedActiveCaloriesPerDay)} / ${formatOptionalNumber(profile.estimatedRestingCaloriesPerDay)} kcal.`;
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? "not set" : formatNumber(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value);
}
