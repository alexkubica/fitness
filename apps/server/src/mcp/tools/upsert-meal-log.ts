import { randomUUID } from "node:crypto";
import type {
  MealIngredientInput,
  MealLog,
  MealLogInput,
  MealMacroTotals,
} from "@fitness/db";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import type { AuditPort } from "../../services/audit.js";
import type { MealLogService } from "../../services/meals.js";
import { localFoodDateTimeToUtc } from "./date-range.js";

export const UPSERT_MEAL_LOG_TOOL_NAME = "upsert_meal_log";

const mealTotalsSchema = z.object({
  calories: z.number().min(0),
  proteinGrams: z.number().min(0),
  carbsGrams: z.number().min(0),
  fatGrams: z.number().min(0),
  fiberGrams: z.number().min(0),
});

const mealIngredientSchema = z.object({
  clientIngredientId: z.string().min(1).max(120).optional(),
  name: z.string().min(1).max(120),
  quantity: z.number().min(0),
  unit: z.string().min(1).max(40),
  grams: z.number().min(0).optional(),
  totals: mealTotalsSchema,
});

export const upsertMealLogInputSchema = {
  profileId: z.string().min(1).max(120).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
  clientMealId: z.string().min(1).max(120).optional(),
  occurredAt: z.string().datetime().optional(),
  localFoodDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  localTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  timezone: z.string().min(1).max(80).default("Asia/Jerusalem"),
  title: z.string().min(1).max(120),
  mealType: z.string().min(1).max(80).default("Meal"),
  note: z.string().max(2_000).optional(),
  totals: mealTotalsSchema,
  ingredients: z.array(mealIngredientSchema).max(40).default([]),
};

export const upsertMealLogOutputSchema = {
  meal: z.record(z.string(), z.unknown()),
  mealId: z.string(),
  operation: z.enum(["created", "updated", "unchanged"]),
};

export async function upsertMealLogToolResult(input: {
  audit: AuditPort;
  meals: MealLogService;
  scopes: readonly string[];
  userId: string;
  profileId?: string | undefined;
  idempotencyKey?: string | undefined;
  clientMealId?: string | undefined;
  occurredAt?: string | undefined;
  localFoodDate?: string | undefined;
  localTime?: string | undefined;
  timezone: string;
  title: string;
  mealType: string;
  note?: string | undefined;
  totals: MealMacroTotals;
  ingredients: readonly MealIngredientInput[];
}): Promise<CallToolResult> {
  if (!input.scopes.includes("meal:write")) {
    return missingMealWriteScopeResult();
  }

  const clientMealId = input.clientMealId ?? `mcp-${randomUUID()}`;
  const mealInput: MealLogInput = {
    userId: input.userId,
    profileId: input.profileId,
    idempotencyKey: input.idempotencyKey ?? `mcp-meal:${clientMealId}`,
    clientMealId,
    occurredAt: normalizeOccurredAt({
      localFoodDate: input.localFoodDate,
      localTime: input.localTime,
      occurredAt: input.occurredAt,
      timezone: input.timezone,
    }),
    timezone: input.timezone,
    title: input.title,
    mealType: input.mealType,
    note: input.note,
    totals: roundTotals(input.totals),
    ingredients: input.ingredients.map((ingredient) => ({
      ...ingredient,
      totals: roundTotals(ingredient.totals),
    })),
    photoCount: 0,
    estimateStatus: "manual",
    origin: "mcp",
    provenance: {
      client: "mcp",
      version: 1,
    },
  };
  const result = await input.meals.upsertMealWithResult(mealInput);
  const meal = result.meal;

  await input.audit.create({
    action: "mcp.meal.upsert",
    actor: {
      type: "user",
      id: input.userId,
    },
    target: {
      type: "meal",
      id: meal.id,
    },
    userId: input.userId,
    metadata: {
      calories: meal.totals.calories,
      ingredientCount: meal.ingredients.length,
      origin: meal.origin,
      photoCount: meal.photoCount,
      profileId: input.profileId,
    },
  });

  return {
    content: [
      {
        type: "text",
        text: formatUpsertedMeal(meal),
      },
    ],
    structuredContent: {
      meal,
      mealId: result.mealId,
      operation: result.operation,
    },
  };
}

function missingMealWriteScopeResult(): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: "MCP token is missing meal:write scope. Reconnect the connector and approve meal write access.",
      },
    ],
    structuredContent: {
      meal: {
        error: "missing-scope",
      },
    },
  };
}

function normalizeOccurredAt(input: {
  occurredAt?: string | undefined;
  localFoodDate?: string | undefined;
  localTime?: string | undefined;
  timezone: string;
}): string {
  if (input.occurredAt !== undefined && input.localFoodDate !== undefined) {
    throw new Error("Provide either occurredAt or localFoodDate, not both.");
  }

  if (input.localFoodDate !== undefined) {
    return localFoodDateTimeToUtc({
      localFoodDate: input.localFoodDate,
      localTime: input.localTime,
      timezone: input.timezone,
    });
  }

  const date =
    input.occurredAt === undefined ? new Date() : new Date(input.occurredAt);

  if (Number.isNaN(date.getTime())) {
    throw new Error("occurredAt must be a valid ISO timestamp.");
  }

  return date.toISOString();
}

function roundTotals(totals: MealMacroTotals): MealMacroTotals {
  return {
    calories: round(totals.calories),
    proteinGrams: round(totals.proteinGrams),
    carbsGrams: round(totals.carbsGrams),
    fatGrams: round(totals.fatGrams),
    fiberGrams: round(totals.fiberGrams),
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatUpsertedMeal(meal: MealLog): string {
  return [
    `Saved meal ${meal.id}: ${meal.title}.`,
    `Macros: ${formatNumber(meal.totals.calories)} kcal, P ${formatNumber(meal.totals.proteinGrams)}g, C ${formatNumber(meal.totals.carbsGrams)}g, F ${formatNumber(meal.totals.fatGrams)}g, Fiber ${formatNumber(meal.totals.fiberGrams)}g.`,
  ].join("\n");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value);
}
