import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";

export const MEAL_PLAN_TOOL_NAMES = {
  getDaily: "get_daily_meal_plan",
  getRange: "get_meal_plan_range",
  upsertDaily: "upsert_daily_meal_plan",
  copyDaily: "copy_daily_meal_plan",
  copyRange: "copy_meal_plan_range",
  deleteDaily: "delete_daily_meal_plan",
  getMeal: "get_planned_meal",
  updateMeal: "update_planned_meal",
  replaceMeal: "replace_planned_meal",
  markStatus: "mark_planned_meal_status",
  convertToLog: "convert_planned_meal_to_log",
  compare: "compare_plan_to_actual",
} as const;

const profileId = z.string().min(1).max(120).optional();
const localFoodDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const timezone = z.string().min(1).max(80).default("Asia/Jerusalem");
const version = z.number().int().positive();
const idempotencyKey = z.string().min(1).max(200);

const totals = z.object({
  calories: z.number().min(0),
  proteinGrams: z.number().min(0),
  carbsGrams: z.number().min(0),
  fatGrams: z.number().min(0),
  fiberGrams: z.number().min(0),
});

const ingredient = z.object({
  id: z.string().min(1).max(120).optional(),
  foodReferenceType: z.string().min(1).max(80).optional(),
  foodReferenceId: z.string().min(1).max(120).optional(),
  displayName: z.string().min(1).max(120),
  quantity: z.number().min(0),
  unit: z.string().min(1).max(40),
  grams: z.number().min(0).optional(),
  totals,
  alternativeGroup: z.string().min(1).max(120).optional(),
  notes: z.string().max(1_000).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

const mealDraft = z.object({
  id: z.string().min(1).max(120).optional(),
  mealSlotId: z.string().min(1).max(120).optional(),
  mealType: z.string().min(1).max(80),
  plannedTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/u)
    .optional(),
  title: z.string().min(1).max(120),
  description: z.string().max(2_000).optional(),
  instructions: z.string().max(4_000).optional(),
  status: z
    .enum([
      "planned",
      "confirmed",
      "eaten_as_planned",
      "partially_eaten",
      "replaced",
      "skipped",
      "unconfirmed",
      "not_confirmed",
    ])
    .optional(),
  coachNote: z.string().max(2_000).optional(),
  alternativeGroup: z.string().min(1).max(120).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  ingredients: z.array(ingredient).max(60),
  version: version.optional(),
});

const resultOutputSchema = {
  result: z.record(z.string(), z.unknown()),
};

export const getDailyMealPlanInputSchema = {
  profileId,
  localFoodDate,
  timezone,
};
export const getDailyMealPlanOutputSchema = resultOutputSchema;

export const getMealPlanRangeInputSchema = {
  profileId,
  fromLocalFoodDate: localFoodDate,
  toLocalFoodDate: localFoodDate,
  timezone,
  includeArchived: z.boolean().default(false),
};
export const getMealPlanRangeOutputSchema = resultOutputSchema;

export const upsertDailyMealPlanInputSchema = {
  profileId,
  localFoodDate,
  timezone,
  status: z.enum(["draft", "active", "completed", "archived"]).optional(),
  title: z.string().max(120).optional(),
  note: z.string().max(2_000).optional(),
  meals: z.array(mealDraft).max(30).optional(),
  idempotencyKey,
  expectedVersion: version.optional(),
  confirmReplace: z.boolean().default(false),
};
export const upsertDailyMealPlanOutputSchema = resultOutputSchema;

export const copyDailyMealPlanInputSchema = {
  profileId,
  sourceLocalFoodDate: localFoodDate,
  destinationLocalFoodDate: localFoodDate,
  timezone,
  idempotencyKey,
  expectedDestinationVersion: version.optional(),
  confirmReplace: z.boolean().default(false),
};
export const copyDailyMealPlanOutputSchema = resultOutputSchema;

export const copyMealPlanRangeInputSchema = {
  profileId,
  sourceFromLocalFoodDate: localFoodDate,
  sourceToLocalFoodDate: localFoodDate,
  destinationStartLocalFoodDate: localFoodDate,
  timezone,
  idempotencyKey,
  confirmReplace: z.boolean().default(false),
};
export const copyMealPlanRangeOutputSchema = resultOutputSchema;

export const deleteDailyMealPlanInputSchema = {
  profileId,
  localFoodDate,
  timezone,
  expectedVersion: version,
  confirmDelete: z.boolean().default(false),
};
export const deleteDailyMealPlanOutputSchema = resultOutputSchema;

export const getPlannedMealInputSchema = {
  profileId,
  plannedMealId: z.string().min(1).max(120),
};
export const getPlannedMealOutputSchema = resultOutputSchema;

export const updatePlannedMealInputSchema = {
  profileId,
  plannedMealId: z.string().min(1).max(120),
  expectedPlanVersion: version,
  expectedMealVersion: version,
  patch: mealDraft.partial(),
};
export const updatePlannedMealOutputSchema = resultOutputSchema;

export const replacePlannedMealInputSchema = {
  profileId,
  plannedMealId: z.string().min(1).max(120),
  expectedPlanVersion: version,
  expectedMealVersion: version,
  replacement: mealDraft,
  reason: z.string().max(1_000).optional(),
  confirmReplace: z.boolean().default(false),
};
export const replacePlannedMealOutputSchema = resultOutputSchema;

export const markPlannedMealStatusInputSchema = {
  profileId,
  plannedMealId: z.string().min(1).max(120),
  status: z.enum(["planned", "skipped", "unconfirmed", "not_confirmed"]),
  expectedPlanVersion: version,
  expectedMealVersion: version,
  coachNote: z.string().max(2_000).optional(),
};
export const markPlannedMealStatusOutputSchema = resultOutputSchema;

export const convertPlannedMealToLogInputSchema = {
  profileId,
  plannedMealId: z.string().min(1).max(120),
  status: z.enum([
    "confirmed",
    "eaten_as_planned",
    "partially_eaten",
    "replaced",
  ]),
  expectedPlanVersion: version,
  expectedMealVersion: version,
  actualIngredients: z.array(ingredient).max(60).optional(),
  actualTitle: z.string().min(1).max(120).optional(),
  actualDescription: z.string().max(2_000).optional(),
  replacementReason: z.string().max(1_000).optional(),
  idempotencyKey: idempotencyKey.optional(),
};
export const convertPlannedMealToLogOutputSchema = resultOutputSchema;

export const comparePlanToActualInputSchema = {
  profileId,
  localFoodDate,
  timezone,
};
export const comparePlanToActualOutputSchema = resultOutputSchema;

export function mealPlanToolResult(
  result: Readonly<Record<string, unknown>>,
  summary: string,
): CallToolResult {
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: { result },
  };
}
