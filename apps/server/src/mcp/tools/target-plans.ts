import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import type { ProfileContext } from "../../services/profiles.js";
import type { TargetPlanService } from "../../services/target-plans.js";

export const GET_ACTIVE_TARGET_PLAN_TOOL_NAME = "get_active_target_plan";
export const GET_TARGET_PLAN_TOOL_NAME = "get_target_plan";
export const LIST_TARGET_PLAN_HISTORY_TOOL_NAME = "list_target_plan_history";
export const CALCULATE_RECOMMENDED_TARGETS_TOOL_NAME =
  "calculate_recommended_targets";
export const CREATE_TARGET_PLAN_DRAFT_TOOL_NAME = "create_target_plan_draft";
export const PROPOSE_TARGET_PLAN_TOOL_NAME = "propose_target_plan";
export const APPROVE_TARGET_PLAN_TOOL_NAME = "approve_target_plan";
export const REJECT_TARGET_PLAN_TOOL_NAME = "reject_target_plan";
export const ACTIVATE_TARGET_PLAN_TOOL_NAME = "activate_target_plan";
export const ARCHIVE_TARGET_PLAN_TOOL_NAME = "archive_target_plan";

const profileId = z.string().min(1).max(120).optional();
const planId = z.string().min(1).max(120);
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const idempotencyKey = z.string().min(1).max(160).optional();
const response = z.string().max(2_000).optional();

export const targetPlanTargetsSchema = z.object({
  maintenanceCalories: z.number().int().min(500).max(10_000),
  selectedCalories: z.number().int().min(500).max(10_000),
  proteinGrams: z.number().int().min(0).max(1_000),
  carbohydratesGrams: z.number().int().min(0).max(2_000),
  fatGrams: z.number().int().min(0).max(1_000),
  fiberGrams: z.number().int().min(0).max(300),
  steps: z.number().int().min(0).max(100_000),
  waterMl: z.number().int().min(0).max(20_000).optional(),
  workoutsPerWeek: z.number().min(0).max(21).optional(),
  targetWeightKg: z.number().min(20).max(500).optional(),
  targetDate: localDate.optional(),
});

export const getActiveTargetPlanInputSchema = { profileId };
export const getTargetPlanInputSchema = { profileId, planId };
export const listTargetPlanHistoryInputSchema = { profileId };
export const calculateRecommendedTargetsInputSchema = {
  profileId,
  goal: z.enum(["lose_weight", "maintain", "gain_mass"]),
  currentWeightKg: z.number().min(20).max(500).optional(),
  estimatedMaintenanceCalories: z.number().min(500).max(10_000).optional(),
  activityLevel: z.enum(["sedentary", "light", "moderate", "high"]).optional(),
  averageSteps: z.number().min(0).max(100_000).optional(),
  trainingFrequency: z.number().min(0).max(21).optional(),
  desiredWeeklyWeightChangeKg: z.number().min(-1).max(0.75).optional(),
  existingTargets: targetPlanTargetsSchema.optional(),
};
export const createTargetPlanDraftInputSchema = {
  profileId,
  goal: z.enum(["lose_weight", "maintain", "gain_mass"]),
  calculationMode: z.enum(["automatic", "manual", "coach_manual"]),
  effectiveFrom: localDate.optional(),
  reason: z.string().min(1).max(2_000),
  targets: targetPlanTargetsSchema,
  idempotencyKey,
};
export const proposeTargetPlanInputSchema = {
  profileId,
  planId,
  idempotencyKey,
};
export const approveTargetPlanInputSchema = {
  profileId,
  planId,
  effectiveFrom: localDate,
  ownerResponse: response,
  reason: response,
  idempotencyKey,
  confirmActivation: z.boolean().default(false),
};
export const rejectTargetPlanInputSchema = {
  profileId,
  planId,
  ownerResponse: z.string().min(1).max(2_000),
  reason: response,
  idempotencyKey,
};
export const activateTargetPlanInputSchema = approveTargetPlanInputSchema;
export const archiveTargetPlanInputSchema = {
  profileId,
  planId,
  reason: response,
  idempotencyKey,
  confirmArchive: z.boolean().default(false),
};

export const targetPlanOutputSchema = {
  result: z.record(z.string(), z.unknown()),
};

export type TargetAction =
  | "active"
  | "get"
  | "history"
  | "recommend"
  | "draft"
  | "propose"
  | "approve"
  | "reject"
  | "activate"
  | "archive";

export async function targetPlanToolResult(input: {
  action: TargetAction;
  context: ProfileContext;
  service: TargetPlanService;
  payload: Record<string, unknown>;
}): Promise<CallToolResult> {
  const planIdValue = stringValue(input.payload.planId);
  if (
    (input.action === "approve" || input.action === "activate") &&
    input.payload.confirmActivation !== true
  ) {
    return result(
      "Activation requires confirmActivation=true after reviewing the comparison.",
      {
        confirmationRequired: true,
        comparison: await input.service.compare(input.context, planIdValue),
      },
    );
  }
  if (input.action === "archive" && input.payload.confirmArchive !== true) {
    return result("Archiving requires confirmArchive=true.", {
      confirmationRequired: true,
    });
  }

  const mutation = {
    profileId: input.context.profileId,
    planId: planIdValue,
    actorUserId: input.context.actorUserId,
    reason: optionalString(input.payload.reason),
    ownerResponse: optionalString(input.payload.ownerResponse),
    idempotencyKey: optionalString(input.payload.idempotencyKey),
  };
  const output =
    input.action === "active"
      ? { plan: (await input.service.getActivePlan(input.context)) ?? null }
      : input.action === "get"
        ? {
            plan:
              (await input.service.getPlan(input.context, planIdValue)) ?? null,
          }
        : input.action === "history"
          ? { plans: await input.service.listHistory(input.context) }
          : input.action === "recommend"
            ? {
                recommendation: input.service.calculateRecommendation(
                  input.context,
                  input.payload as Parameters<
                    TargetPlanService["calculateRecommendation"]
                  >[1],
                ),
                activated: false,
              }
            : input.action === "draft"
              ? {
                  plan: await input.service.createDraft(input.context, {
                    goal: input.payload.goal as
                      | "lose_weight"
                      | "maintain"
                      | "gain_mass",
                    calculationMode: input.payload.calculationMode as
                      | "automatic"
                      | "manual"
                      | "coach_manual",
                    effectiveFrom: optionalString(input.payload.effectiveFrom),
                    reason: stringValue(input.payload.reason),
                    targets: input.payload.targets as Parameters<
                      TargetPlanService["createDraft"]
                    >[1]["targets"],
                    idempotencyKey: optionalString(
                      input.payload.idempotencyKey,
                    ),
                  }),
                }
              : input.action === "propose"
                ? { plan: await input.service.propose(input.context, mutation) }
                : input.action === "approve"
                  ? {
                      plan: await input.service.approve(input.context, {
                        ...mutation,
                        effectiveFrom: stringValue(input.payload.effectiveFrom),
                      }),
                    }
                  : input.action === "reject"
                    ? {
                        plan: await input.service.reject(
                          input.context,
                          mutation,
                        ),
                      }
                    : input.action === "activate"
                      ? {
                          plan: await input.service.activate(input.context, {
                            ...mutation,
                            effectiveFrom: stringValue(
                              input.payload.effectiveFrom,
                            ),
                          }),
                        }
                      : {
                          plan: await input.service.archive(
                            input.context,
                            mutation,
                          ),
                        };

  const selected = Reflect.get(output, "plan") as
    | { version?: number; status?: string }
    | null
    | undefined;
  return result(
    selected == null
      ? `Target plan ${input.action} completed.`
      : `Target plan v${selected.version} is ${selected.status}.`,
    output,
  );
}

function result(text: string, value: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent: { result: value },
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
