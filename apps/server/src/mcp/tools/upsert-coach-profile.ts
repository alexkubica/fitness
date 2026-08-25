import type { CoachGoal, CoachMealSlot } from "@fitness/db";
import { calculateNutritionTargets } from "@fitness/domain";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import type { AuditPort } from "../../services/audit.js";
import type { CoachService } from "../../services/coach.js";
import type { ProfileContext } from "../../services/profiles.js";
import type { TargetPlanService } from "../../services/target-plans.js";

export const UPSERT_COACH_PROFILE_TOOL_NAME = "upsert_coach_profile";

const coachGoalSchema = z
  .enum(["lose_weight", "maintain", "gain_mass", "loseWeight", "gainMass"])
  .transform((value): CoachGoal => {
    if (value === "loseWeight") return "lose_weight";
    if (value === "gainMass") return "gain_mass";
    return value;
  });

const mealSlotSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(80),
  timeMinutes: z.number().int().min(0).max(1_439),
  remindersEnabled: z.boolean().default(true),
});

export const upsertCoachProfileInputSchema = {
  profileId: z.string().min(1).max(120).optional(),
  goal: coachGoalSchema,
  weightKg: z.number().min(20).max(400),
  estimatedStepsPerDay: z.number().int().min(0).max(100_000),
  estimatedActiveCaloriesPerDay: z.number().min(0).max(10_000).optional(),
  estimatedRestingCaloriesPerDay: z.number().min(500).max(5_000).optional(),
  wakeTimeMinutes: z.number().int().min(0).max(1_439),
  sleepTimeMinutes: z.number().int().min(0).max(1_439),
  mealRemindersEnabled: z.boolean().default(true),
  mealSlots: z.array(mealSlotSchema).max(12).default([]),
  completedAt: z.string().datetime().optional(),
};

export const upsertCoachProfileOutputSchema = {
  profile: z.record(z.string(), z.unknown()),
  targetPlan: z.record(z.string(), z.unknown()),
  deprecationWarning: z.string(),
};

export async function upsertCoachProfileToolResult(input: {
  audit: AuditPort;
  coach: CoachService;
  scopes: readonly string[];
  userId: string;
  profileId?: string | undefined;
  profileContext: ProfileContext;
  targetPlans: TargetPlanService;
  goal: CoachGoal;
  weightKg: number;
  estimatedStepsPerDay: number;
  estimatedActiveCaloriesPerDay?: number | undefined;
  estimatedRestingCaloriesPerDay?: number | undefined;
  wakeTimeMinutes: number;
  sleepTimeMinutes: number;
  mealRemindersEnabled: boolean;
  mealSlots: readonly CoachMealSlot[];
  completedAt?: string | undefined;
}): Promise<CallToolResult> {
  if (!input.scopes.includes("coach:write")) {
    return {
      content: [
        {
          type: "text",
          text: "MCP token is missing coach:write scope. Reconnect the connector and approve coach write access.",
        },
      ],
      structuredContent: {
        profile: {
          error: "missing-scope",
        },
      },
    };
  }

  const profile = await input.coach.upsertProfile({
    userId: input.userId,
    profileId: input.profileId,
    goal: input.goal,
    weightKg: input.weightKg,
    estimatedStepsPerDay: input.estimatedStepsPerDay,
    estimatedActiveCaloriesPerDay: input.estimatedActiveCaloriesPerDay,
    estimatedRestingCaloriesPerDay: input.estimatedRestingCaloriesPerDay,
    wakeTimeMinutes: input.wakeTimeMinutes,
    sleepTimeMinutes: input.sleepTimeMinutes,
    mealRemindersEnabled: input.mealRemindersEnabled,
    mealSlots: input.mealSlots,
    targets: calculateNutritionTargets({
      estimatedStepsPerDay: input.estimatedStepsPerDay,
      estimatedActiveCaloriesPerDay: input.estimatedActiveCaloriesPerDay,
      estimatedRestingCaloriesPerDay: input.estimatedRestingCaloriesPerDay,
      goal: input.goal,
      weightKg: input.weightKg,
    }),
    source: "mcp",
    completedAt: normalizeCompletedAt(input.completedAt),
  });
  const targetPlan = await input.targetPlans.activateCompatibility(
    input.profileContext,
    {
      goal: profile.goal,
      calculationMode: "automatic",
      reason: "Updated through the deprecated upsert_coach_profile adapter.",
      targets: {
        maintenanceCalories: profile.targets.maintenanceCalories,
        selectedCalories: profile.targets.selectedCalories,
        proteinGrams: profile.targets.proteinGrams,
        carbohydratesGrams: profile.targets.carbsGrams,
        fatGrams: profile.targets.fatGrams,
        fiberGrams: profile.targets.fiberGrams,
        steps: profile.estimatedStepsPerDay,
      },
    },
  );

  await input.audit.create({
    action: "mcp.coach_profile.upsert",
    actor: {
      type: "user",
      id: input.profileContext.actorUserId,
    },
    target: {
      type: "coach_profile",
      id: input.profileId ?? input.userId,
    },
    userId: input.userId,
    metadata: {
      goal: profile.goal,
      mealSlotCount: profile.mealSlots.length,
      profileId: input.profileId,
      selectedCalories: profile.targets.selectedCalories,
    },
  });

  return {
    content: [
      {
        type: "text",
        text: `Saved coach profile with ${profile.targets.selectedCalories} kcal target and ${profile.targets.proteinGrams}g protein target.`,
      },
    ],
    structuredContent: {
      profile,
      targetPlan,
      deprecationWarning:
        "upsert_coach_profile now creates a TargetPlan version; use target-plan tools for new integrations.",
    },
  };
}

function normalizeCompletedAt(value: string | undefined): string {
  return new Date(value ?? Date.now()).toISOString();
}
