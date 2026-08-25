import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import type { AuditPort } from "../../services/audit.js";
import type { MealLogService } from "../../services/meals.js";

export const DELETE_MEAL_LOG_TOOL_NAME = "delete_meal_log";

export const deleteMealLogInputSchema = {
  profileId: z.string().min(1).max(120).optional(),
  mealId: z.string().min(1).max(120),
  confirmDelete: z.boolean().default(false),
};

export const deleteMealLogOutputSchema = {
  result: z.object({
    deleted: z.boolean(),
    mealId: z.string(),
    error: z.string().optional(),
  }),
};

export async function deleteMealLogToolResult(input: {
  audit: AuditPort;
  meals: MealLogService;
  scopes: readonly string[];
  userId: string;
  profileId?: string | undefined;
  mealId: string;
  confirmDelete: boolean;
}): Promise<CallToolResult> {
  if (!input.scopes.includes("meal:write")) {
    return deleteResult({
      deleted: false,
      error: "missing-scope",
      mealId: input.mealId,
      text: "MCP token is missing meal:write scope. Reconnect the connector and approve meal write access.",
    });
  }

  if (!input.confirmDelete) {
    return deleteResult({
      deleted: false,
      error: "confirmation-required",
      mealId: input.mealId,
      text: "Deletion requires confirmDelete=true. Ask the user to confirm before calling this tool again.",
    });
  }

  const meal = await input.meals.deleteMeal({
    deletedAt: new Date().toISOString(),
    id: input.mealId,
    userId: input.userId,
    profileId: input.profileId,
  });

  if (meal === undefined) {
    return deleteResult({
      deleted: false,
      error: "not-found",
      mealId: input.mealId,
      text: `Meal ${input.mealId} was not found for this account.`,
    });
  }

  await input.audit.create({
    action: "mcp.meal.delete",
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
      origin: meal.origin,
      profileId: input.profileId,
    },
  });

  return deleteResult({
    deleted: true,
    mealId: meal.id,
    text: `Deleted meal ${meal.id}.`,
  });
}

function deleteResult(input: {
  deleted: boolean;
  mealId: string;
  text: string;
  error?: string | undefined;
}): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: input.text,
      },
    ],
    structuredContent: {
      result: {
        deleted: input.deleted,
        mealId: input.mealId,
        ...(input.error === undefined ? {} : { error: input.error }),
      },
    },
  };
}
