import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ProfilePermission } from "@fitness/auth";
import type { ProfileContext } from "../../services/profiles.js";
import { availableMcpToolsForPermissions } from "../tool-permissions.js";
import * as z from "zod/v4";

export const GET_MCP_CAPABILITIES_TOOL_NAME = "get_mcp_capabilities";

export const getMcpCapabilitiesInputSchema = {
  profileId: z.string().min(1).max(120).optional(),
};

export const getMcpCapabilitiesOutputSchema = {
  toolGroups: z.array(
    z.object({
      title: z.string(),
      tools: z.array(
        z.object({
          name: z.string(),
          scope: z.string(),
          description: z.string(),
          confirmation: z.string().optional(),
        }),
      ),
    }),
  ),
  profileId: z.string(),
  relationship: z.string(),
  roleIdentifier: z.string(),
  effectivePermissions: z.array(z.string()),
  availableTools: z.array(z.string()),
  readCapabilities: z.array(z.string()),
  writeCapabilities: z.array(z.string()),
  confirmationRequirements: z.array(z.string()),
  accessExpiration: z.string().optional(),
  accessStatus: z.string(),
};

const toolGroups = [
  {
    title: "Profiles",
    tools: [
      {
        name: "list_accessible_profiles",
        scope: "health:read",
        description:
          "List health profiles the authenticated actor can access, including relationship, ownership, managed-profile status, expiration, and adapter-provided permissions.",
      },
      {
        name: "get_profile",
        scope: "health:read",
        description:
          "Read one health profile by explicit profileId. If profileId is omitted, only the actor's self profile is selected.",
      },
      {
        name: "get_profile_access",
        scope: "health:read",
        description:
          "Read the actor's access relationship for a profile, including role identifier and adapter-provided permissions.",
      },
    ],
  },
  {
    title: "Health reads",
    tools: [
      {
        name: "get_health_summary",
        scope: "health:read",
        description: "Summarize daily Apple Health aggregates by date range.",
      },
      {
        name: "get_metric_timeseries",
        scope: "health:read",
        description:
          "Read a normalized metric timeseries such as weight, steps, active energy, sleep, heart rate, or nutrition by today, date, or ISO range.",
      },
      {
        name: "generate_report",
        scope: "report:read",
        description:
          "Generate deterministic coach reports from health, meal, and check-in data.",
      },
    ],
  },
  {
    title: "Meals",
    tools: [
      {
        name: "get_meal_log",
        scope: "health:read",
        description:
          "Read account-backed meal logs, ingredients, and macros for today, a date, or a date range.",
      },
      {
        name: "get_food_database",
        scope: "health:read",
        description:
          "Search reusable foods derived from previous ingredients and saved templates, including latest portions, usage counts, macros, and protein density.",
      },
      {
        name: "get_food_aggregations",
        scope: "health:read",
        description:
          "Aggregate logged foods by food, meal section, or day for questions like most-eaten foods, protein sources, and macro contributors.",
      },
      {
        name: "upsert_meal_log",
        scope: "meal:write",
        description:
          "Create or update meal logs with explicit title, description, section/meal type, calories, macros, and ingredient breakdowns. Use this direct tool for normal log/add/change food requests. Use localFoodDate plus timezone whenever the user names a food day. Creates a 24-hour rollback snapshot.",
      },
      {
        name: "delete_meal_log",
        scope: "meal:write",
        description:
          "Delete a meal log. Creates a 24-hour rollback snapshot before deletion.",
        confirmation: "Requires confirmDelete=true after user approval.",
      },
      {
        name: "list_meal_log_snapshots",
        scope: "meal:write",
        description:
          "List recent 24-hour rollback snapshots for meal-log changes.",
      },
      {
        name: "get_meal_log_snapshot",
        scope: "meal:write",
        description:
          "Inspect the full beforeState and afterState for a meal-log rollback snapshot.",
      },
      {
        name: "rollback_meal_log_snapshot",
        scope: "meal:write",
        description:
          "Restore a previous meal-log beforeState from a 24-hour rollback snapshot.",
        confirmation: "Requires confirmRollback=true after user approval.",
      },
    ],
  },
  {
    title: "Versioned targets",
    tools: [
      {
        name: "get_active_target_plan",
        scope: "coach:read",
        description: "Read the target plan effective today.",
      },
      {
        name: "get_target_plan",
        scope: "coach:read",
        description: "Read one target-plan version.",
      },
      {
        name: "list_target_plan_history",
        scope: "coach:read",
        description:
          "List drafts, proposals, active, rejected, and superseded plans.",
      },
      {
        name: "calculate_recommended_targets",
        scope: "coach:read",
        description:
          "Preview deterministic recommendations without activation.",
      },
      {
        name: "create_target_plan_draft",
        scope: "coach:write",
        description: "Create a new immutable draft version.",
      },
      {
        name: "propose_target_plan",
        scope: "coach:write",
        description: "Submit a draft for owner approval.",
      },
      {
        name: "approve_target_plan",
        scope: "coach:write",
        description: "Approve a proposal and choose its local effective date.",
        confirmation:
          "Requires confirmActivation=true after comparison review.",
      },
      {
        name: "reject_target_plan",
        scope: "coach:write",
        description: "Reject a proposal with an owner response.",
      },
      {
        name: "activate_target_plan",
        scope: "coach:write",
        description: "Directly activate a plan for an authorized writer.",
        confirmation:
          "Requires confirmActivation=true after comparison review.",
      },
      {
        name: "archive_target_plan",
        scope: "coach:write",
        description: "Archive an inactive plan.",
        confirmation: "Requires confirmArchive=true.",
      },
    ],
  },
  {
    title: "Coach and reports",
    tools: [
      {
        name: "get_coach_profile",
        scope: "coach:read",
        description: "Read goals and target calories/macros.",
      },
      {
        name: "upsert_coach_profile",
        scope: "coach:write",
        description:
          "Create or update goals, baseline activity estimates, and meal slots.",
      },
    ],
  },
  {
    title: "Meal planning",
    tools: [
      {
        name: "get_daily_meal_plan",
        scope: "health:read",
        description: "Read one profile-local daily plan and planned totals.",
      },
      {
        name: "get_meal_plan_range",
        scope: "health:read",
        description: "Read plans across a profile-local date range.",
      },
      {
        name: "upsert_daily_meal_plan",
        scope: "meal:write",
        description: "Create or version-update a daily meal plan.",
        confirmation: "Replacing populated meals requires confirmReplace=true.",
      },
      {
        name: "copy_daily_meal_plan",
        scope: "meal:write",
        description: "Copy any selected plan date to another date.",
      },
      {
        name: "copy_meal_plan_range",
        scope: "meal:write",
        description: "Copy a contiguous range without implicit overwrites.",
      },
      {
        name: "delete_daily_meal_plan",
        scope: "meal:write",
        description: "Delete a draft plan only.",
        confirmation: "Requires confirmDelete=true.",
      },
      {
        name: "get_planned_meal",
        scope: "health:read",
        description: "Read a planned meal and nutrition snapshots.",
      },
      {
        name: "update_planned_meal",
        scope: "meal:write",
        description: "Edit, reorder, or reschedule a versioned planned meal.",
      },
      {
        name: "replace_planned_meal",
        scope: "meal:write",
        description: "Preserve an original planned meal and add a replacement.",
        confirmation: "Requires confirmReplace=true.",
      },
      {
        name: "mark_planned_meal_status",
        scope: "meal:write",
        description:
          "Mark a plan skipped or unconfirmed without logging intake.",
      },
      {
        name: "convert_planned_meal_to_log",
        scope: "meal:write",
        description:
          "Create and link one actual meal log while preserving planned values.",
      },
      {
        name: "compare_plan_to_actual",
        scope: "health:read",
        description:
          "Compare planned snapshots, actual logs, and effective targets.",
      },
    ],
  },
  {
    title: "CBT eating check-ins",
    tools: [
      {
        name: "create_eating_checkin",
        scope: "coach:write",
        description:
          "Create a structured eating check-in with hunger, fullness, urges, emotions, triggers, thoughts, context, and coping actions.",
      },
      {
        name: "update_eating_checkin",
        scope: "coach:write",
        description:
          "Correct a structured eating check-in while preserving typed CBT fields.",
      },
      {
        name: "get_eating_checkins",
        scope: "coach:read",
        description:
          "Read structured eating check-ins over an ISO range or linked meal/planned meal.",
      },
      {
        name: "get_latest_eating_checkin",
        scope: "coach:read",
        description:
          "Read the latest structured eating check-in for scheduled coaching context.",
      },
      {
        name: "link_checkin_to_meal",
        scope: "coach:write",
        description:
          "Link an existing check-in to one actual meal, planned meal, or both.",
      },
      {
        name: "get_eating_trigger_summary",
        scope: "coach:read",
        description:
          "Summarize hunger, emotions, triggers, screen eating, second servings, coping actions, and intensity trends without diagnosis.",
      },
      {
        name: "get_binge_pattern_summary",
        scope: "coach:read",
        description:
          "Surface loss-of-control and discomfort patterns without diagnosing an eating disorder.",
      },
      {
        name: "get_cbt_weekly_report",
        scope: "report:read",
        description:
          "Report weekly behavioral metrics and plan safer next actions after overeating events.",
      },
    ],
  },
] as const;

export function getMcpCapabilitiesToolResult(input: {
  profileContext: ProfileContext;
  permissions: readonly ProfilePermission[];
}): CallToolResult {
  const availableTools = availableMcpToolsForPermissions(input.permissions);
  const available = new Set<string>(availableTools);
  const availableGroups = toolGroups
    .map((group) => ({
      ...group,
      tools: group.tools.filter((tool) => available.has(tool.name)),
    }))
    .filter((group) => group.tools.length > 0);
  const readCapabilities = availableTools.filter(
    (toolName) => !isWriteTool(toolName),
  );
  const writeCapabilities = availableTools.filter(isWriteTool);
  const confirmationRequirements = availableGroups.flatMap((group) =>
    group.tools.flatMap((tool) =>
      "confirmation" in tool && tool.confirmation !== undefined
        ? [`${tool.name}: ${tool.confirmation}`]
        : [],
    ),
  );

  return {
    content: [
      {
        type: "text",
        text: [
          "Fitme MCP capabilities:",
          ...availableGroups.flatMap((group) => [
            "",
            `${group.title}:`,
            ...group.tools.map(
              (tool) =>
                `- ${tool.name} (${tool.scope}): ${tool.description}${
                  "confirmation" in tool && tool.confirmation !== undefined
                    ? ` ${tool.confirmation}`
                    : ""
                }`,
            ),
          ]),
          "",
          "Common ChatGPT flows:",
          "- Create meals: estimate the title, note, ingredients, and macros in ChatGPT, then call upsert_meal_log with meal:write. If the user mentions a date such as 25.6, pass localFoodDate='YYYY-MM-DD' and timezone='Asia/Jerusalem' instead of defaulting to now.",
          "- Change or delete meals: use direct meal-log mutation tools, then call get_meal_log for the affected local date to verify localDate, timezone, meals, and totals.",
          "- Undo mistakes: call list_meal_log_snapshots, inspect with get_meal_log_snapshot if needed, then rollback_meal_log_snapshot with confirmRollback=true.",
          "- See meal history: call get_meal_log with preset='today', date='YYYY-MM-DD', or an ISO range.",
          "- See stats: call get_health_summary or get_metric_timeseries with preset='today', date='YYYY-MM-DD', or an ISO range.",
          "- Reuse foods: call get_food_database with search text, then use those ingredient macros in upsert_meal_log.",
          "- Find patterns: call get_food_aggregations for most-eaten foods, usual protein sources, or macro contributors over a range.",
          "- Work with profiles: call list_accessible_profiles first when the user names a dependent or family member, then pass that explicit profileId to health, meal, coach, and report tools.",
          "- Review a day: call get_meal_log, get_coach_profile, and get_health_summary, then give behavioral nutrition feedback without medical claims.",
          "- Plan meals: use daily meal-plan tools for intentions, then convert a planned meal to an actual log only after the user confirms what was eaten.",
          "- Scheduled coaching: read today's planned meals, actual meals, and the latest CBT eating check-in; ask one short question, save the response with create_eating_checkin, and suggest one practical next action.",
          "- After overeating: record context, avoid compensation, return to the normal next meal, and identify one small adjustment for next time. Do not encourage fasting, skipped meals, punitive exercise, extreme restriction, guilt, or moral labels.",
          "",
          "Apple Health nutrition writeback is native-app only because iOS must request HealthKit write permission and show final confirmation.",
        ].join("\n"),
      },
    ],
    structuredContent: {
      toolGroups: availableGroups,
      profileId: input.profileContext.profileId,
      relationship: input.profileContext.access.relationship,
      roleIdentifier: input.profileContext.access.roleIdentifier,
      effectivePermissions: input.permissions,
      availableTools,
      readCapabilities,
      writeCapabilities,
      confirmationRequirements,
      accessExpiration: input.profileContext.access.expiresAt,
      accessStatus: input.profileContext.access.status,
    },
  };
}

function isWriteTool(toolName: string): boolean {
  return (
    toolName.startsWith("upsert_") ||
    toolName.startsWith("delete_") ||
    toolName.startsWith("rollback_") ||
    toolName.startsWith("copy_") ||
    toolName.startsWith("replace_") ||
    toolName.startsWith("mark_") ||
    toolName.startsWith("convert_") ||
    toolName.startsWith("link_") ||
    toolName.startsWith("update_") ||
    toolName.startsWith("create_eating_") ||
    toolName.startsWith("create_target_") ||
    toolName.startsWith("propose_target_") ||
    toolName.startsWith("approve_target_") ||
    toolName.startsWith("reject_target_") ||
    toolName.startsWith("activate_target_") ||
    toolName.startsWith("archive_target_") ||
    toolName === "generate_report"
  );
}
