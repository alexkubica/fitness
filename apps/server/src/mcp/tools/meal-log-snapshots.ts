import type { MealLogSnapshot } from "@fitness/db";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import type { AuditPort } from "../../services/audit.js";
import {
  restoreMealLogSnapshot,
  type MealLogService,
  type MealLogSnapshotService,
} from "../../services/meals.js";

export const LIST_MEAL_LOG_SNAPSHOTS_TOOL_NAME = "list_meal_log_snapshots";
export const GET_MEAL_LOG_SNAPSHOT_TOOL_NAME = "get_meal_log_snapshot";
export const ROLLBACK_MEAL_LOG_SNAPSHOT_TOOL_NAME =
  "rollback_meal_log_snapshot";

export const listMealLogSnapshotsInputSchema = {
  profileId: z.string().min(1).max(120).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  timezone: z.string().min(1).max(80).default("Asia/Jerusalem"),
  includeExpired: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(20),
};

export const listMealLogSnapshotsOutputSchema = {
  snapshots: z.array(z.record(z.string(), z.unknown())),
};

export const getMealLogSnapshotInputSchema = {
  profileId: z.string().min(1).max(120).optional(),
  snapshotId: z.string().min(1).max(120),
};

export const getMealLogSnapshotOutputSchema = {
  snapshot: z.record(z.string(), z.unknown()).nullable(),
};

export const rollbackMealLogSnapshotInputSchema = {
  profileId: z.string().min(1).max(120).optional(),
  snapshotId: z.string().min(1).max(120),
  confirmRollback: z.boolean(),
};

export const rollbackMealLogSnapshotOutputSchema = {
  result: z.record(z.string(), z.unknown()),
};

export async function listMealLogSnapshotsToolResult(input: {
  snapshots: MealLogSnapshotService;
  scopes: readonly string[];
  userId: string;
  profileId?: string | undefined;
  date?: string | undefined;
  timezone: string;
  includeExpired: boolean;
  limit: number;
}): Promise<CallToolResult> {
  if (!input.scopes.includes("meal:write")) {
    return snapshotScopeResult("list");
  }

  const snapshots = await input.snapshots.listSnapshots({
    userId: input.userId,
    profileId: input.profileId,
    date: input.date,
    includeExpired: input.includeExpired,
    limit: input.limit,
  });

  const summaries = snapshots
    .filter((snapshot) =>
      input.date === undefined ? true : snapshot.timezone === input.timezone,
    )
    .map(snapshotSummary);

  return {
    content: [
      {
        type: "text",
        text:
          summaries.length === 0
            ? "No meal log rollback snapshots found."
            : [
                "Meal log rollback snapshots:",
                ...summaries.map(
                  (snapshot) =>
                    `- ${snapshot.snapshotId}: ${snapshot.description} (${snapshot.operationType}, expires ${snapshot.expiresAt})`,
                ),
              ].join("\n"),
      },
    ],
    structuredContent: {
      snapshots: summaries,
    },
  };
}

export async function getMealLogSnapshotToolResult(input: {
  snapshots: MealLogSnapshotService;
  scopes: readonly string[];
  userId: string;
  profileId?: string | undefined;
  snapshotId: string;
}): Promise<CallToolResult> {
  if (!input.scopes.includes("meal:write")) {
    return snapshotScopeResult("get");
  }

  const snapshot = await input.snapshots.getSnapshot({
    userId: input.userId,
    profileId: input.profileId,
    snapshotId: input.snapshotId,
  });

  if (snapshot === undefined) {
    return {
      content: [{ type: "text", text: "Meal log snapshot not found." }],
      structuredContent: { snapshot: null },
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `${snapshot.description}\nBefore: ${snapshot.beforeState.meals.length} meals, ${formatNumber(snapshot.beforeState.totals.calories)} kcal.${
          snapshot.afterState === undefined
            ? ""
            : `\nAfter: ${snapshot.afterState.meals.length} meals, ${formatNumber(snapshot.afterState.totals.calories)} kcal.`
        }`,
      },
    ],
    structuredContent: {
      snapshot,
    },
  };
}

export async function rollbackMealLogSnapshotToolResult(input: {
  audit: AuditPort;
  meals: MealLogService;
  snapshots: MealLogSnapshotService;
  scopes: readonly string[];
  userId: string;
  profileId?: string | undefined;
  snapshotId: string;
  confirmRollback: boolean;
}): Promise<CallToolResult> {
  if (!input.scopes.includes("meal:write")) {
    return rollbackResult({
      rolledBack: false,
      error: "missing-scope",
      text: "MCP token is missing meal:write scope. Reconnect the connector and approve meal write access.",
    });
  }

  if (!input.confirmRollback) {
    return rollbackResult({
      rolledBack: false,
      error: "confirmation-required",
      text: "Rollback requires confirmRollback=true after explicit user approval.",
    });
  }

  const snapshot = await input.snapshots.getSnapshot({
    userId: input.userId,
    profileId: input.profileId,
    snapshotId: input.snapshotId,
  });

  if (snapshot === undefined) {
    return rollbackResult({
      rolledBack: false,
      error: "not-found",
      text: "Meal log snapshot not found.",
    });
  }

  if (Date.parse(snapshot.expiresAt) <= Date.now()) {
    return rollbackResult({
      rolledBack: false,
      error: "expired",
      text: `Snapshot ${snapshot.id} has expired and can no longer be rolled back.`,
    });
  }

  const restored = await restoreMealLogSnapshot({
    meals: input.meals,
    snapshots: input.snapshots,
    snapshot,
    source: "mcp",
  });

  await input.audit.create({
    action: "mcp.meal.rollback",
    actor: { type: "user", id: input.userId },
    target: { type: "meal_log_snapshot", id: snapshot.id },
    userId: input.userId,
    metadata: {
      affectedLocalDate: snapshot.affectedLocalDate,
      mealCount: restored.meals.length,
      profileId: input.profileId,
      timezone: snapshot.timezone,
    },
  });

  return rollbackResult({
    rolledBack: true,
    snapshot,
    restored,
    text: `Rolled back ${snapshot.id}. Restored ${restored.meals.length} meals for ${snapshot.affectedLocalDate}.`,
  });
}

function snapshotScopeResult(action: "get" | "list"): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: `MCP token is missing meal:write scope. Reconnect the connector and approve meal write access before ${action}ing rollback snapshots.`,
      },
    ],
    structuredContent:
      action === "list" ? { snapshots: [] } : { snapshot: null },
  };
}

function rollbackResult(input: {
  rolledBack: boolean;
  text: string;
  error?: string | undefined;
  snapshot?: MealLogSnapshot | undefined;
  restored?: unknown;
}): CallToolResult {
  return {
    content: [{ type: "text", text: input.text }],
    structuredContent: {
      result: {
        rolledBack: input.rolledBack,
        ...(input.error === undefined ? {} : { error: input.error }),
        ...(input.snapshot === undefined
          ? {}
          : {
              snapshotId: input.snapshot.id,
              affectedLocalDate: input.snapshot.affectedLocalDate,
              timezone: input.snapshot.timezone,
            }),
        ...(input.restored === undefined ? {} : { mealLog: input.restored }),
      },
    },
  };
}

function snapshotSummary(snapshot: MealLogSnapshot) {
  return {
    snapshotId: snapshot.id,
    createdAt: snapshot.createdAt,
    expiresAt: snapshot.expiresAt,
    affectedLocalDate: snapshot.affectedLocalDate,
    timezone: snapshot.timezone,
    operationType: snapshot.operationType,
    description: snapshot.description,
    source: snapshot.source,
    canRollback: Date.parse(snapshot.expiresAt) > Date.now(),
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value);
}
