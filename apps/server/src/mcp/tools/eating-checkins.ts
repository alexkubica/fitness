import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";

export const EATING_CHECKIN_TOOL_NAMES = {
  create: "create_eating_checkin",
  update: "update_eating_checkin",
  list: "get_eating_checkins",
  latest: "get_latest_eating_checkin",
  linkMeal: "link_checkin_to_meal",
  triggerSummary: "get_eating_trigger_summary",
  bingeSummary: "get_binge_pattern_summary",
  weeklyReport: "get_cbt_weekly_report",
} as const;

const profileId = z.string().min(1).max(120).optional();
const checkInId = z.string().min(1).max(120);
const linkedMealId = z.string().min(1).max(120).optional();
const linkedPlannedMealId = z.string().min(1).max(120).optional();
const timestamp = z.string().datetime();
const timezone = z.string().min(1).max(80).default("Asia/Jerusalem");
const scale = z.number().int().min(0).max(10);
const tags = z.array(z.string().min(1).max(80)).max(40);
const eatingContext = z.enum([
  "physical_hunger",
  "emotional_eating",
  "habit",
  "social",
  "boredom",
  "stress",
  "fatigue",
  "screen_eating",
  "unknown",
]);

const checkInFields = {
  linkedMealId,
  linkedPlannedMealId,
  hungerBefore: scale.optional(),
  fullnessAfter: scale.optional(),
  urgeIntensity: scale.optional(),
  emotionIntensity: scale.optional(),
  emotions: tags.optional(),
  triggers: tags.optional(),
  automaticThought: z.string().max(2_000).optional(),
  balancedResponse: z.string().max(2_000).optional(),
  eatingContext: eatingContext.optional(),
  lossOfControl: z.boolean().optional(),
  ateUntilPain: z.boolean().optional(),
  ateWithScreen: z.boolean().optional(),
  ateFromPackage: z.boolean().optional(),
  tookSecondServing: z.boolean().optional(),
  copingAction: z.string().max(1_000).optional(),
  urgeDelayMinutes: z.number().int().nonnegative().optional(),
  outcome: z.string().max(1_000).optional(),
  note: z.string().max(4_000).optional(),
} as const;

export const createEatingCheckInInputSchema = {
  profileId,
  idempotencyKey: z.string().min(1).max(200).optional(),
  occurredAt: timestamp.optional(),
  timezone,
  ...checkInFields,
};

export const updateEatingCheckInInputSchema = {
  profileId,
  checkInId,
  patch: z.object({
    occurredAt: timestamp.optional(),
    timezone: timezone.optional(),
    ...checkInFields,
  }),
};

export const getEatingCheckInsInputSchema = {
  profileId,
  range: z
    .object({
      from: timestamp,
      to: timestamp,
    })
    .optional(),
  linkedMealId,
  linkedPlannedMealId,
  limit: z.number().int().positive().max(500).default(100),
};

export const getLatestEatingCheckInInputSchema = {
  profileId,
};

export const linkCheckInToMealInputSchema = {
  profileId,
  checkInId,
  linkedMealId,
  linkedPlannedMealId,
};

export const eatingSummaryInputSchema = {
  profileId,
  range: z
    .object({
      from: timestamp,
      to: timestamp,
    })
    .optional(),
  limit: z.number().int().positive().max(500).default(250),
};

export const eatingCheckInOutputSchema = {
  result: z.record(z.string(), z.unknown()),
};

export function eatingCheckInToolResult(
  result: Readonly<Record<string, unknown>>,
  summary: string,
): CallToolResult {
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: { result },
  };
}
