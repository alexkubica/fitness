import { randomUUID } from "node:crypto";
import {
  COACH_WRITE_SCOPES,
  FIRST_SLICE_MCP_SCOPES,
  MCP_CONNECTOR_SCOPES,
  MCP_MEAL_WRITE_SCOPES,
} from "@fitness/auth";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  WebStandardStreamableHTTPServerTransport,
  type WebStandardStreamableHTTPServerTransportOptions,
} from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Hono } from "hono";
import type { ZodType } from "zod/v4";
import type { AuthContext, ServerEnv } from "../auth.js";
import type { AuditPort } from "../services/audit.js";
import {
  AuthorizationError,
  type AuthorizationService,
} from "../services/authorization.js";
import type { CoachService } from "../services/coach.js";
import type { CoachReportPort } from "../services/coach-report.js";
import type { EatingCheckInService } from "../services/eating-checkins.js";
import type { EatingCheckInPatch } from "@fitness/db";
import type { TargetPlanService } from "../services/target-plans.js";
import type { HealthReadService } from "../services/health-read.js";
import type {
  MealLogService,
  MealLogSnapshotService,
} from "../services/meals.js";
import type {
  MealPlanAccessContext,
  MealPlanService,
  PlannedMealDraft,
} from "../services/meal-plans.js";
import {
  ProfileAccessError,
  type ProfileContext,
  type ProfileService,
} from "../services/profiles.js";
import { requireMcpAuth } from "./auth.js";
import { requiredPermissionsForMcpTool } from "./tool-permissions.js";
import type { McpOAuthConfig } from "./oauth-metadata.js";
import {
  DELETE_MEAL_LOG_TOOL_NAME,
  deleteMealLogInputSchema,
  deleteMealLogOutputSchema,
  deleteMealLogToolResult,
} from "./tools/delete-meal-log.js";
import {
  GENERATE_REPORT_TOOL_NAME,
  generateReportInputSchema,
  generateReportOutputSchema,
  generateReportToolResult,
} from "./tools/generate-report.js";
import {
  GET_FOOD_AGGREGATIONS_TOOL_NAME,
  getFoodAggregationsInputSchema,
  getFoodAggregationsOutputSchema,
  getFoodAggregationsToolResult,
} from "./tools/get-food-aggregations.js";
import {
  GET_FOOD_DATABASE_TOOL_NAME,
  getFoodDatabaseInputSchema,
  getFoodDatabaseOutputSchema,
  getFoodDatabaseToolResult,
} from "./tools/get-food-database.js";
import {
  GET_COACH_PROFILE_TOOL_NAME,
  getCoachProfileInputSchema,
  getCoachProfileOutputSchema,
  getCoachProfileToolResult,
} from "./tools/get-coach-profile.js";
import {
  GET_HEALTH_SUMMARY_TOOL_NAME,
  getHealthSummaryInputSchema,
  getHealthSummaryOutputSchema,
  getHealthSummaryToolResult,
} from "./tools/get-health-summary.js";
import {
  GET_METRIC_TIMESERIES_TOOL_NAME,
  getMetricTimeseriesInputSchema,
  getMetricTimeseriesOutputSchema,
  getMetricTimeseriesToolResult,
} from "./tools/get-metric-timeseries.js";
import {
  GET_MEAL_LOG_TOOL_NAME,
  getMealLogInputSchema,
  getMealLogOutputSchema,
  getMealLogToolResult,
} from "./tools/get-meal-log.js";
import {
  GET_MCP_CAPABILITIES_TOOL_NAME,
  getMcpCapabilitiesInputSchema,
  getMcpCapabilitiesOutputSchema,
  getMcpCapabilitiesToolResult,
} from "./tools/get-mcp-capabilities.js";
import {
  GET_PROFILE_ACCESS_TOOL_NAME,
  GET_PROFILE_TOOL_NAME,
  LIST_ACCESSIBLE_PROFILES_TOOL_NAME,
  getProfileAccessInputSchema,
  getProfileAccessOutputSchema,
  getProfileAccessToolResult,
  getProfileInputSchema,
  getProfileOutputSchema,
  getProfileToolResult,
  listAccessibleProfilesInputSchema,
  listAccessibleProfilesOutputSchema,
  listAccessibleProfilesToolResult,
} from "./tools/profiles.js";
import {
  GET_MEAL_LOG_SNAPSHOT_TOOL_NAME,
  LIST_MEAL_LOG_SNAPSHOTS_TOOL_NAME,
  ROLLBACK_MEAL_LOG_SNAPSHOT_TOOL_NAME,
  getMealLogSnapshotInputSchema,
  getMealLogSnapshotOutputSchema,
  getMealLogSnapshotToolResult,
  listMealLogSnapshotsInputSchema,
  listMealLogSnapshotsOutputSchema,
  listMealLogSnapshotsToolResult,
  rollbackMealLogSnapshotInputSchema,
  rollbackMealLogSnapshotOutputSchema,
  rollbackMealLogSnapshotToolResult,
} from "./tools/meal-log-snapshots.js";
import {
  MEAL_PLAN_TOOL_NAMES,
  comparePlanToActualInputSchema,
  comparePlanToActualOutputSchema,
  convertPlannedMealToLogInputSchema,
  convertPlannedMealToLogOutputSchema,
  copyDailyMealPlanInputSchema,
  copyDailyMealPlanOutputSchema,
  copyMealPlanRangeInputSchema,
  copyMealPlanRangeOutputSchema,
  deleteDailyMealPlanInputSchema,
  deleteDailyMealPlanOutputSchema,
  getDailyMealPlanInputSchema,
  getDailyMealPlanOutputSchema,
  getMealPlanRangeInputSchema,
  getMealPlanRangeOutputSchema,
  getPlannedMealInputSchema,
  getPlannedMealOutputSchema,
  markPlannedMealStatusInputSchema,
  markPlannedMealStatusOutputSchema,
  mealPlanToolResult,
  replacePlannedMealInputSchema,
  replacePlannedMealOutputSchema,
  updatePlannedMealInputSchema,
  updatePlannedMealOutputSchema,
  upsertDailyMealPlanInputSchema,
  upsertDailyMealPlanOutputSchema,
} from "./tools/meal-plans.js";
import {
  EATING_CHECKIN_TOOL_NAMES,
  createEatingCheckInInputSchema,
  eatingCheckInOutputSchema,
  eatingCheckInToolResult,
  eatingSummaryInputSchema,
  getEatingCheckInsInputSchema,
  getLatestEatingCheckInInputSchema,
  linkCheckInToMealInputSchema,
  updateEatingCheckInInputSchema,
} from "./tools/eating-checkins.js";
import {
  UPSERT_MEAL_LOG_TOOL_NAME,
  upsertMealLogInputSchema,
  upsertMealLogOutputSchema,
  upsertMealLogToolResult,
} from "./tools/upsert-meal-log.js";
import {
  UPSERT_COACH_PROFILE_TOOL_NAME,
  upsertCoachProfileInputSchema,
  upsertCoachProfileOutputSchema,
  upsertCoachProfileToolResult,
} from "./tools/upsert-coach-profile.js";
import {
  ACTIVATE_TARGET_PLAN_TOOL_NAME,
  APPROVE_TARGET_PLAN_TOOL_NAME,
  ARCHIVE_TARGET_PLAN_TOOL_NAME,
  CALCULATE_RECOMMENDED_TARGETS_TOOL_NAME,
  CREATE_TARGET_PLAN_DRAFT_TOOL_NAME,
  GET_ACTIVE_TARGET_PLAN_TOOL_NAME,
  GET_TARGET_PLAN_TOOL_NAME,
  LIST_TARGET_PLAN_HISTORY_TOOL_NAME,
  PROPOSE_TARGET_PLAN_TOOL_NAME,
  REJECT_TARGET_PLAN_TOOL_NAME,
  activateTargetPlanInputSchema,
  approveTargetPlanInputSchema,
  archiveTargetPlanInputSchema,
  calculateRecommendedTargetsInputSchema,
  createTargetPlanDraftInputSchema,
  getActiveTargetPlanInputSchema,
  getTargetPlanInputSchema,
  listTargetPlanHistoryInputSchema,
  proposeTargetPlanInputSchema,
  rejectTargetPlanInputSchema,
  targetPlanOutputSchema,
  targetPlanToolResult,
  type TargetAction,
} from "./tools/target-plans.js";

export type McpReadServices = Readonly<{
  audit: AuditPort;
  authorization: AuthorizationService;
  coach: CoachService;
  eatingCheckIns: EatingCheckInService;
  healthRead: HealthReadService;
  meals: MealLogService;
  mealPlans: MealPlanService;
  mealSnapshots: MealLogSnapshotService;
  profiles: ProfileService;
  reports: CoachReportPort;
  targetPlans: TargetPlanService;
}>;

const MCP_READ_SECURITY_SCHEMES = [
  { type: "oauth2", scopes: FIRST_SLICE_MCP_SCOPES },
] as const;

const MCP_READ_TOOL_META = {
  securitySchemes: MCP_READ_SECURITY_SCHEMES,
} satisfies Record<string, unknown>;

const MCP_MEAL_WRITE_SECURITY_SCHEMES = [
  { type: "oauth2", scopes: MCP_MEAL_WRITE_SCOPES },
] as const;

const MCP_MEAL_WRITE_TOOL_META = {
  securitySchemes: MCP_MEAL_WRITE_SECURITY_SCHEMES,
} satisfies Record<string, unknown>;

const MCP_COACH_WRITE_SECURITY_SCHEMES = [
  { type: "oauth2", scopes: COACH_WRITE_SCOPES },
] as const;

const MCP_COACH_WRITE_TOOL_META = {
  securitySchemes: MCP_COACH_WRITE_SECURITY_SCHEMES,
} satisfies Record<string, unknown>;

type McpSession = Readonly<{
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
}>;

export function createFitnessMcpServer(services: McpReadServices): McpServer {
  const server = new McpServer(
    {
      name: "fitness-coach-mcp",
      version: "0.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.registerTool(
    GET_MCP_CAPABILITIES_TOOL_NAME,
    {
      title: "Get MCP Capabilities",
      description:
        "List the Fitme MCP tool groups, scopes, side effects, and confirmation requirements.",
      inputSchema: getMcpCapabilitiesInputSchema,
      outputSchema: getMcpCapabilitiesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: MCP_READ_TOOL_META,
    },
    async ({ profileId }, extra) => {
      const actorUserId = userIdFromAuthInfo(extra.authInfo);

      if (actorUserId === undefined) {
        return unauthenticatedToolResult();
      }

      const profileContext = await requireToolProfileContext(
        services.profiles,
        services.authorization,
        actorUserId,
        profileId,
        GET_MCP_CAPABILITIES_TOOL_NAME,
      );

      if (profileContext.ok === false) return profileContext.result;

      return getMcpCapabilitiesToolResult({
        profileContext: profileContext.value,
        permissions: await services.authorization.getEffectivePermissions(
          actorUserId,
          profileContext.value.profileId,
        ),
      });
    },
  );

  server.registerTool(
    LIST_ACCESSIBLE_PROFILES_TOOL_NAME,
    {
      title: "List Accessible Profiles",
      description:
        "List health profiles the authenticated user can explicitly access, including ownership, relationship, managed status, expiration, and adapter-supplied permissions.",
      inputSchema: listAccessibleProfilesInputSchema,
      outputSchema: listAccessibleProfilesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: MCP_READ_TOOL_META,
    },
    async (_input, extra) => {
      const actorUserId = userIdFromAuthInfo(extra.authInfo);

      if (actorUserId === undefined) {
        return unauthenticatedToolResult();
      }

      return listAccessibleProfilesToolResult({
        actorUserId,
        profiles: services.profiles,
      });
    },
  );

  server.registerTool(
    GET_PROFILE_TOOL_NAME,
    {
      title: "Get Profile",
      description:
        "Return one accessible health profile. If profileId is omitted, only the authenticated user's self profile is selected.",
      inputSchema: getProfileInputSchema,
      outputSchema: getProfileOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: MCP_READ_TOOL_META,
    },
    async ({ profileId }, extra) => {
      const actorUserId = userIdFromAuthInfo(extra.authInfo);

      if (actorUserId === undefined) {
        return unauthenticatedToolResult();
      }

      return profileToolResult(() =>
        authorizeProfileTool(
          services,
          actorUserId,
          profileId,
          GET_PROFILE_TOOL_NAME,
          () =>
            getProfileToolResult({
              actorUserId,
              profileId,
              profiles: services.profiles,
            }),
        ),
      );
    },
  );

  server.registerTool(
    GET_PROFILE_ACCESS_TOOL_NAME,
    {
      title: "Get Profile Access",
      description:
        "Return the authenticated user's access relationship for a health profile. If profileId is omitted, only self-profile access is selected.",
      inputSchema: getProfileAccessInputSchema,
      outputSchema: getProfileAccessOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: MCP_READ_TOOL_META,
    },
    async ({ profileId }, extra) => {
      const actorUserId = userIdFromAuthInfo(extra.authInfo);

      if (actorUserId === undefined) {
        return unauthenticatedToolResult();
      }

      return profileToolResult(() =>
        authorizeProfileTool(
          services,
          actorUserId,
          profileId,
          GET_PROFILE_ACCESS_TOOL_NAME,
          () =>
            getProfileAccessToolResult({
              actorUserId,
              profileId,
              profiles: services.profiles,
            }),
        ),
      );
    },
  );

  server.registerTool(
    GET_HEALTH_SUMMARY_TOOL_NAME,
    {
      title: "Get Health Summary",
      description:
        "Summarize normalized health metrics for the authenticated user over an ISO timestamp range.",
      inputSchema: getHealthSummaryInputSchema,
      outputSchema: getHealthSummaryOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: MCP_READ_TOOL_META,
    },
    async ({ profileId, range, date, preset, timezone }, extra) => {
      const actorUserId = userIdFromAuthInfo(extra.authInfo);

      if (actorUserId === undefined) {
        return unauthenticatedToolResult();
      }

      const profileContext = await requireToolProfileContext(
        services.profiles,
        services.authorization,
        actorUserId,
        profileId,
        GET_HEALTH_SUMMARY_TOOL_NAME,
      );

      if (profileContext.ok === false) {
        return profileContext.result;
      }

      return getHealthSummaryToolResult({
        healthRead: services.healthRead,
        userId: profileContext.value.subjectUserId,
        profileId: profileContext.value.profileId,
        range: { range, date, preset, timezone },
      });
    },
  );

  server.registerTool(
    GET_METRIC_TIMESERIES_TOOL_NAME,
    {
      title: "Get Metric Timeseries",
      description:
        "Return sample or daily timeseries points for one normalized health metric for the authenticated user.",
      inputSchema: getMetricTimeseriesInputSchema,
      outputSchema: getMetricTimeseriesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: MCP_READ_TOOL_META,
    },
    async (
      { profileId, metric, range, date, preset, timezone, granularity },
      extra,
    ) => {
      const actorUserId = userIdFromAuthInfo(extra.authInfo);

      if (actorUserId === undefined) {
        return unauthenticatedToolResult();
      }

      const profileContext = await requireToolProfileContext(
        services.profiles,
        services.authorization,
        actorUserId,
        profileId,
        GET_METRIC_TIMESERIES_TOOL_NAME,
      );

      if (profileContext.ok === false) {
        return profileContext.result;
      }

      return getMetricTimeseriesToolResult({
        healthRead: services.healthRead,
        userId: profileContext.value.subjectUserId,
        profileId: profileContext.value.profileId,
        metric,
        range: { range, date, preset, timezone },
        granularity,
      });
    },
  );

  server.registerTool(
    GENERATE_REPORT_TOOL_NAME,
    {
      title: "Generate Report",
      description:
        "Generate a deterministic daily coach report for the authenticated user over an ISO timestamp range.",
      inputSchema: generateReportInputSchema,
      outputSchema: generateReportOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: MCP_READ_TOOL_META,
    },
    async ({ profileId, style, range }, extra) => {
      const actorUserId = userIdFromAuthInfo(extra.authInfo);

      if (actorUserId === undefined) {
        return unauthenticatedToolResult();
      }

      const profileContext = await requireToolProfileContext(
        services.profiles,
        services.authorization,
        actorUserId,
        profileId,
        GENERATE_REPORT_TOOL_NAME,
      );

      if (profileContext.ok === false) {
        return profileContext.result;
      }

      return generateReportToolResult({
        reports: services.reports,
        userId: profileContext.value.subjectUserId,
        profileId: profileContext.value.profileId,
        scopes: extra.authInfo?.scopes ?? [],
        style,
        range,
        timezone: profileContext.value.profile.timezone,
      });
    },
  );

  server.registerTool(
    GET_MEAL_LOG_TOOL_NAME,
    {
      title: "Get Meal Log",
      description:
        "Return account-scoped meal logs, ingredients, photo counts, and macro totals over an ISO timestamp range.",
      inputSchema: getMealLogInputSchema,
      outputSchema: getMealLogOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: MCP_READ_TOOL_META,
    },
    async ({ profileId, range, date, preset, timezone, limit }, extra) => {
      const actorUserId = userIdFromAuthInfo(extra.authInfo);

      if (actorUserId === undefined) {
        return unauthenticatedToolResult();
      }

      const profileContext = await requireToolProfileContext(
        services.profiles,
        services.authorization,
        actorUserId,
        profileId,
        GET_MEAL_LOG_TOOL_NAME,
      );

      if (profileContext.ok === false) {
        return profileContext.result;
      }

      return getMealLogToolResult({
        meals: services.meals,
        userId: profileContext.value.subjectUserId,
        profileId: profileContext.value.profileId,
        range: { range, date, preset, timezone },
        limit,
      });
    },
  );

  server.registerTool(
    GET_FOOD_DATABASE_TOOL_NAME,
    {
      title: "Get Food Database",
      description:
        "Return reusable foods derived from previous meal ingredients and saved templates, with search, latest portions, usage counts, and macros.",
      inputSchema: getFoodDatabaseInputSchema,
      outputSchema: getFoodDatabaseOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: MCP_READ_TOOL_META,
    },
    async (
      {
        profileId,
        range,
        date,
        preset,
        timezone,
        query,
        proteinOnly,
        includeTemplates,
        limit,
      },
      extra,
    ) => {
      const actorUserId = userIdFromAuthInfo(extra.authInfo);

      if (actorUserId === undefined) {
        return unauthenticatedToolResult();
      }

      const profileContext = await requireToolProfileContext(
        services.profiles,
        services.authorization,
        actorUserId,
        profileId,
        GET_FOOD_DATABASE_TOOL_NAME,
      );

      if (profileContext.ok === false) {
        return profileContext.result;
      }

      return getFoodDatabaseToolResult({
        meals: services.meals,
        userId: profileContext.value.subjectUserId,
        profileId: profileContext.value.profileId,
        range: { range, date, preset, timezone },
        query,
        proteinOnly,
        includeTemplates,
        limit,
      });
    },
  );

  server.registerTool(
    GET_FOOD_AGGREGATIONS_TOOL_NAME,
    {
      title: "Get Food Aggregations",
      description:
        "Aggregate logged foods by food, meal section, or day over a date range to answer most-eaten foods and usual protein sources.",
      inputSchema: getFoodAggregationsInputSchema,
      outputSchema: getFoodAggregationsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: MCP_READ_TOOL_META,
    },
    async (
      {
        profileId,
        range,
        date,
        preset,
        timezone,
        groupBy,
        sortBy,
        query,
        minProteinGrams,
        limit,
      },
      extra,
    ) => {
      const actorUserId = userIdFromAuthInfo(extra.authInfo);

      if (actorUserId === undefined) {
        return unauthenticatedToolResult();
      }

      const profileContext = await requireToolProfileContext(
        services.profiles,
        services.authorization,
        actorUserId,
        profileId,
        GET_FOOD_AGGREGATIONS_TOOL_NAME,
      );

      if (profileContext.ok === false) {
        return profileContext.result;
      }

      return getFoodAggregationsToolResult({
        meals: services.meals,
        userId: profileContext.value.subjectUserId,
        profileId: profileContext.value.profileId,
        range: { range, date, preset, timezone },
        groupBy,
        sortBy,
        query,
        minProteinGrams,
        limit,
      });
    },
  );

  server.registerTool(
    GET_COACH_PROFILE_TOOL_NAME,
    {
      title: "Get Coach Profile",
      description:
        "Return the authenticated user's coach profile, calorie target, macro targets, and meal slots.",
      inputSchema: getCoachProfileInputSchema,
      outputSchema: getCoachProfileOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: MCP_READ_TOOL_META,
    },
    async ({ profileId }, extra) => {
      const actorUserId = userIdFromAuthInfo(extra.authInfo);

      if (actorUserId === undefined) {
        return unauthenticatedToolResult();
      }

      const profileContext = await requireToolProfileContext(
        services.profiles,
        services.authorization,
        actorUserId,
        profileId,
        GET_COACH_PROFILE_TOOL_NAME,
      );

      if (profileContext.ok === false) {
        return profileContext.result;
      }

      return getCoachProfileToolResult({
        coach: services.coach,
        userId: profileContext.value.subjectUserId,
        profileId: profileContext.value.profileId,
        profileContext: profileContext.value,
        targetPlans: services.targetPlans,
      });
    },
  );

  server.registerTool(
    GET_ACTIVE_TARGET_PLAN_TOOL_NAME,
    targetToolDefinition(
      "Get Active Target Plan",
      "Return the versioned target plan effective today in the profile timezone.",
      getActiveTargetPlanInputSchema,
      true,
    ),
    async (input, extra) =>
      runTargetTool(
        services,
        extra.authInfo,
        GET_ACTIVE_TARGET_PLAN_TOOL_NAME,
        "active",
        input,
      ),
  );

  server.registerTool(
    GET_TARGET_PLAN_TOOL_NAME,
    targetToolDefinition(
      "Get Target Plan",
      "Return one target plan version by ID.",
      getTargetPlanInputSchema,
      true,
    ),
    async (input, extra) =>
      runTargetTool(
        services,
        extra.authInfo,
        GET_TARGET_PLAN_TOOL_NAME,
        "get",
        input,
      ),
  );

  server.registerTool(
    LIST_TARGET_PLAN_HISTORY_TOOL_NAME,
    targetToolDefinition(
      "List Target Plan History",
      "List complete target-plan history, including proposals and superseded versions.",
      listTargetPlanHistoryInputSchema,
      true,
    ),
    async (input, extra) =>
      runTargetTool(
        services,
        extra.authInfo,
        LIST_TARGET_PLAN_HISTORY_TOOL_NAME,
        "history",
        input,
      ),
  );

  server.registerTool(
    CALCULATE_RECOMMENDED_TARGETS_TOOL_NAME,
    targetToolDefinition(
      "Calculate Recommended Targets",
      "Preview deterministic nutrition and fitness recommendations without activating them.",
      calculateRecommendedTargetsInputSchema,
      true,
    ),
    async (input, extra) =>
      runTargetTool(
        services,
        extra.authInfo,
        CALCULATE_RECOMMENDED_TARGETS_TOOL_NAME,
        "recommend",
        input,
      ),
  );

  server.registerTool(
    CREATE_TARGET_PLAN_DRAFT_TOOL_NAME,
    targetToolDefinition(
      "Create Target Plan Draft",
      "Create an immutable draft version without activating it.",
      createTargetPlanDraftInputSchema,
      false,
    ),
    async (input, extra) =>
      runTargetTool(
        services,
        extra.authInfo,
        CREATE_TARGET_PLAN_DRAFT_TOOL_NAME,
        "draft",
        input,
      ),
  );

  server.registerTool(
    PROPOSE_TARGET_PLAN_TOOL_NAME,
    targetToolDefinition(
      "Propose Target Plan",
      "Submit a draft target plan for profile-owner review.",
      proposeTargetPlanInputSchema,
      false,
    ),
    async (input, extra) =>
      runTargetTool(
        services,
        extra.authInfo,
        PROPOSE_TARGET_PLAN_TOOL_NAME,
        "propose",
        input,
      ),
  );

  server.registerTool(
    APPROVE_TARGET_PLAN_TOOL_NAME,
    targetToolDefinition(
      "Approve Target Plan",
      "Approve and activate a proposal on a local effective date after explicit confirmation.",
      approveTargetPlanInputSchema,
      false,
      true,
    ),
    async (input, extra) =>
      runTargetTool(
        services,
        extra.authInfo,
        APPROVE_TARGET_PLAN_TOOL_NAME,
        "approve",
        input,
      ),
  );

  server.registerTool(
    REJECT_TARGET_PLAN_TOOL_NAME,
    targetToolDefinition(
      "Reject Target Plan",
      "Reject a proposed target plan with an owner response.",
      rejectTargetPlanInputSchema,
      false,
    ),
    async (input, extra) =>
      runTargetTool(
        services,
        extra.authInfo,
        REJECT_TARGET_PLAN_TOOL_NAME,
        "reject",
        input,
      ),
  );

  server.registerTool(
    ACTIVATE_TARGET_PLAN_TOOL_NAME,
    targetToolDefinition(
      "Activate Target Plan",
      "Directly activate a target plan for an authorized writer after explicit confirmation.",
      activateTargetPlanInputSchema,
      false,
      true,
    ),
    async (input, extra) =>
      runTargetTool(
        services,
        extra.authInfo,
        ACTIVATE_TARGET_PLAN_TOOL_NAME,
        "activate",
        input,
      ),
  );

  server.registerTool(
    ARCHIVE_TARGET_PLAN_TOOL_NAME,
    targetToolDefinition(
      "Archive Target Plan",
      "Archive an inactive target plan after explicit confirmation.",
      archiveTargetPlanInputSchema,
      false,
      true,
    ),
    async (input, extra) =>
      runTargetTool(
        services,
        extra.authInfo,
        ARCHIVE_TARGET_PLAN_TOOL_NAME,
        "archive",
        input,
      ),
  );

  server.registerTool(
    UPSERT_MEAL_LOG_TOOL_NAME,
    {
      title: "Upsert Meal Log",
      description:
        "Creates or updates a meal log for the authenticated user with explicit macro totals and optional ingredient breakdown. If this modifies existing data or affects an existing day, the system creates a 24-hour rollback snapshot. Use list_meal_log_snapshots and rollback_meal_log_snapshot to restore if needed.",
      inputSchema: upsertMealLogInputSchema,
      outputSchema: upsertMealLogOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: MCP_MEAL_WRITE_TOOL_META,
    },
    async (input, extra) => {
      const actorUserId = userIdFromAuthInfo(extra.authInfo);

      if (actorUserId === undefined) {
        return unauthenticatedToolResult();
      }

      const profileContext = await requireToolProfileContext(
        services.profiles,
        services.authorization,
        actorUserId,
        input.profileId,
        UPSERT_MEAL_LOG_TOOL_NAME,
      );

      if (profileContext.ok === false) {
        return profileContext.result;
      }

      return upsertMealLogToolResult({
        ...input,
        audit: services.audit,
        meals: services.meals,
        scopes: extra.authInfo?.scopes ?? [],
        userId: profileContext.value.subjectUserId,
        profileId: profileContext.value.profileId,
      });
    },
  );

  server.registerTool(
    UPSERT_COACH_PROFILE_TOOL_NAME,
    {
      title: "Upsert Coach Profile",
      description:
        "Create or update the authenticated user's coach profile and server-calculated nutrition targets.",
      inputSchema: upsertCoachProfileInputSchema,
      outputSchema: upsertCoachProfileOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: MCP_COACH_WRITE_TOOL_META,
    },
    async (input, extra) => {
      const actorUserId = userIdFromAuthInfo(extra.authInfo);

      if (actorUserId === undefined) {
        return unauthenticatedToolResult();
      }

      const profileContext = await requireToolProfileContext(
        services.profiles,
        services.authorization,
        actorUserId,
        input.profileId,
        UPSERT_COACH_PROFILE_TOOL_NAME,
      );

      if (profileContext.ok === false) {
        return profileContext.result;
      }

      return upsertCoachProfileToolResult({
        ...input,
        audit: services.audit,
        coach: services.coach,
        profileContext: profileContext.value,
        targetPlans: services.targetPlans,
        scopes: extra.authInfo?.scopes ?? [],
        userId: profileContext.value.subjectUserId,
        profileId: profileContext.value.profileId,
      });
    },
  );

  server.registerTool(
    DELETE_MEAL_LOG_TOOL_NAME,
    {
      title: "Delete Meal Log",
      description:
        "Deletes a meal log for the authenticated user. Before deletion, the system creates a 24-hour rollback snapshot. Use list_meal_log_snapshots and rollback_meal_log_snapshot to restore if needed. This requires confirmDelete=true after explicit user confirmation.",
      inputSchema: deleteMealLogInputSchema,
      outputSchema: deleteMealLogOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
      _meta: MCP_MEAL_WRITE_TOOL_META,
    },
    async ({ profileId, mealId, confirmDelete }, extra) => {
      const actorUserId = userIdFromAuthInfo(extra.authInfo);

      if (actorUserId === undefined) {
        return unauthenticatedToolResult();
      }

      const profileContext = await requireToolProfileContext(
        services.profiles,
        services.authorization,
        actorUserId,
        profileId,
        DELETE_MEAL_LOG_TOOL_NAME,
      );

      if (profileContext.ok === false) {
        return profileContext.result;
      }

      return deleteMealLogToolResult({
        audit: services.audit,
        meals: services.meals,
        scopes: extra.authInfo?.scopes ?? [],
        userId: profileContext.value.subjectUserId,
        profileId: profileContext.value.profileId,
        mealId,
        confirmDelete,
      });
    },
  );

  server.registerTool(
    LIST_MEAL_LOG_SNAPSHOTS_TOOL_NAME,
    {
      title: "List Meal Log Snapshots",
      description:
        "List 24-hour meal-log rollback snapshots created before meal writes, deletes, and plan applies.",
      inputSchema: listMealLogSnapshotsInputSchema,
      outputSchema: listMealLogSnapshotsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: MCP_MEAL_WRITE_TOOL_META,
    },
    async ({ profileId, date, timezone, includeExpired, limit }, extra) => {
      const actorUserId = userIdFromAuthInfo(extra.authInfo);

      if (actorUserId === undefined) {
        return unauthenticatedToolResult();
      }

      const profileContext = await requireToolProfileContext(
        services.profiles,
        services.authorization,
        actorUserId,
        profileId,
        LIST_MEAL_LOG_SNAPSHOTS_TOOL_NAME,
      );

      if (profileContext.ok === false) {
        return profileContext.result;
      }

      return listMealLogSnapshotsToolResult({
        snapshots: services.mealSnapshots,
        scopes: extra.authInfo?.scopes ?? [],
        userId: profileContext.value.subjectUserId,
        profileId: profileContext.value.profileId,
        date,
        timezone,
        includeExpired,
        limit,
      });
    },
  );

  server.registerTool(
    GET_MEAL_LOG_SNAPSHOT_TOOL_NAME,
    {
      title: "Get Meal Log Snapshot",
      description:
        "Return the full beforeState and afterState for a meal-log rollback snapshot.",
      inputSchema: getMealLogSnapshotInputSchema,
      outputSchema: getMealLogSnapshotOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: MCP_MEAL_WRITE_TOOL_META,
    },
    async ({ profileId, snapshotId }, extra) => {
      const actorUserId = userIdFromAuthInfo(extra.authInfo);

      if (actorUserId === undefined) {
        return unauthenticatedToolResult();
      }

      const profileContext = await requireToolProfileContext(
        services.profiles,
        services.authorization,
        actorUserId,
        profileId,
        GET_MEAL_LOG_SNAPSHOT_TOOL_NAME,
      );

      if (profileContext.ok === false) {
        return profileContext.result;
      }

      return getMealLogSnapshotToolResult({
        snapshots: services.mealSnapshots,
        scopes: extra.authInfo?.scopes ?? [],
        userId: profileContext.value.subjectUserId,
        profileId: profileContext.value.profileId,
        snapshotId,
      });
    },
  );

  server.registerTool(
    ROLLBACK_MEAL_LOG_SNAPSHOT_TOOL_NAME,
    {
      title: "Rollback Meal Log Snapshot",
      description:
        "Restore a previous meal-log beforeState from a 24-hour rollback snapshot. Creates another rollback snapshot before restoring so the rollback can be undone.",
      inputSchema: rollbackMealLogSnapshotInputSchema,
      outputSchema: rollbackMealLogSnapshotOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
      _meta: MCP_MEAL_WRITE_TOOL_META,
    },
    async ({ profileId, snapshotId, confirmRollback }, extra) => {
      const actorUserId = userIdFromAuthInfo(extra.authInfo);

      if (actorUserId === undefined) {
        return unauthenticatedToolResult();
      }

      const profileContext = await requireToolProfileContext(
        services.profiles,
        services.authorization,
        actorUserId,
        profileId,
        ROLLBACK_MEAL_LOG_SNAPSHOT_TOOL_NAME,
      );

      if (profileContext.ok === false) {
        return profileContext.result;
      }

      return rollbackMealLogSnapshotToolResult({
        audit: services.audit,
        meals: services.meals,
        snapshots: services.mealSnapshots,
        scopes: extra.authInfo?.scopes ?? [],
        userId: profileContext.value.subjectUserId,
        profileId: profileContext.value.profileId,
        snapshotId,
        confirmRollback,
      });
    },
  );

  registerMealPlanMcpTools(server, services);
  registerEatingCheckInMcpTools(server, services);

  return server;
}

function registerMealPlanMcpTools(
  server: McpServer,
  services: McpReadServices,
): void {
  server.registerTool(
    MEAL_PLAN_TOOL_NAMES.getDaily,
    {
      title: "Get Daily Meal Plan",
      description:
        "Read planned meals and planned macro totals for one profile-local food date. Plans are intentions, not actual intake.",
      inputSchema: getDailyMealPlanInputSchema,
      outputSchema: getDailyMealPlanOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: MCP_READ_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await mealPlanToolContext(
        services,
        extra.authInfo,
        input.profileId,
        MEAL_PLAN_TOOL_NAMES.getDaily,
      );
      if (resolved.ok === false) return resolved.result;
      const value = await services.mealPlans.getDailyPlan({
        access: resolved.access,
        localFoodDate: input.localFoodDate,
      });
      return mealPlanToolResult(
        { plan: value ?? null, timezone: input.timezone },
        value === undefined
          ? `No meal plan exists for ${input.localFoodDate}.`
          : `Meal plan ${value.plan.id} for ${input.localFoodDate}, version ${value.plan.version}.`,
      );
    },
  );

  server.registerTool(
    MEAL_PLAN_TOOL_NAMES.getRange,
    {
      title: "Get Meal Plan Range",
      description: "Read planned meals over a profile-local date range.",
      inputSchema: getMealPlanRangeInputSchema,
      outputSchema: getMealPlanRangeOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: MCP_READ_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await mealPlanToolContext(
        services,
        extra.authInfo,
        input.profileId,
        MEAL_PLAN_TOOL_NAMES.getRange,
      );
      if (resolved.ok === false) return resolved.result;
      const plans = await services.mealPlans.getPlanRange({
        access: resolved.access,
        fromLocalFoodDate: input.fromLocalFoodDate,
        toLocalFoodDate: input.toLocalFoodDate,
        includeArchived: input.includeArchived,
      });
      return mealPlanToolResult(
        { plans, timezone: input.timezone },
        `Found ${plans.length} meal plans.`,
      );
    },
  );

  server.registerTool(
    MEAL_PLAN_TOOL_NAMES.upsertDaily,
    {
      title: "Upsert Daily Meal Plan",
      description:
        "Create or update a daily plan. Replacing populated meals requires confirmReplace=true and the current plan version.",
      inputSchema: upsertDailyMealPlanInputSchema,
      outputSchema: upsertDailyMealPlanOutputSchema,
      annotations: writeAnnotations,
      _meta: MCP_MEAL_WRITE_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await mealPlanToolContext(
        services,
        extra.authInfo,
        input.profileId,
        MEAL_PLAN_TOOL_NAMES.upsertDaily,
      );
      if (resolved.ok === false) return resolved.result;
      const result = await services.mealPlans.upsertDailyPlan({
        access: resolved.access,
        localFoodDate: input.localFoodDate,
        timezone: input.timezone,
        status: input.status,
        title: input.title,
        note: input.note,
        meals: input.meals,
        idempotencyKey: input.idempotencyKey,
        expectedVersion: input.expectedVersion,
        confirmReplace: input.confirmReplace,
      });
      await auditMealPlanTool(
        services.audit,
        resolved.profile,
        "upsert",
        result.plan.id,
        result.plan.version,
      );
      return mealPlanToolResult(
        { plan: result },
        `Saved meal plan version ${result.plan.version}.`,
      );
    },
  );

  server.registerTool(
    MEAL_PLAN_TOOL_NAMES.copyDaily,
    {
      title: "Copy Daily Meal Plan",
      description:
        "Copy a selected date to another local food date without overwriting an existing plan unless explicitly confirmed.",
      inputSchema: copyDailyMealPlanInputSchema,
      outputSchema: copyDailyMealPlanOutputSchema,
      annotations: destructiveAnnotations,
      _meta: MCP_MEAL_WRITE_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await mealPlanToolContext(
        services,
        extra.authInfo,
        input.profileId,
        MEAL_PLAN_TOOL_NAMES.copyDaily,
      );
      if (resolved.ok === false) return resolved.result;
      const result = await services.mealPlans.copyDailyPlan({
        access: resolved.access,
        sourceLocalFoodDate: input.sourceLocalFoodDate,
        destinationLocalFoodDate: input.destinationLocalFoodDate,
        timezone: input.timezone,
        idempotencyKey: input.idempotencyKey,
        expectedDestinationVersion: input.expectedDestinationVersion,
        confirmReplace: input.confirmReplace,
      });
      await auditMealPlanTool(
        services.audit,
        resolved.profile,
        "copy",
        result.plan.id,
        result.plan.version,
      );
      return mealPlanToolResult(
        { plan: result },
        `Copied meal plan to ${input.destinationLocalFoodDate}.`,
      );
    },
  );

  server.registerTool(
    MEAL_PLAN_TOOL_NAMES.copyRange,
    {
      title: "Copy Meal Plan Range",
      description:
        "Copy a contiguous date range transactionally where supported. Existing destination plans require explicit replacement confirmation.",
      inputSchema: copyMealPlanRangeInputSchema,
      outputSchema: copyMealPlanRangeOutputSchema,
      annotations: destructiveAnnotations,
      _meta: MCP_MEAL_WRITE_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await mealPlanToolContext(
        services,
        extra.authInfo,
        input.profileId,
        MEAL_PLAN_TOOL_NAMES.copyRange,
      );
      if (resolved.ok === false) return resolved.result;
      const plans = await services.mealPlans.copyPlanRange({
        access: resolved.access,
        sourceFromLocalFoodDate: input.sourceFromLocalFoodDate,
        sourceToLocalFoodDate: input.sourceToLocalFoodDate,
        destinationStartLocalFoodDate: input.destinationStartLocalFoodDate,
        timezone: input.timezone,
        idempotencyKey: input.idempotencyKey,
        confirmReplace: input.confirmReplace,
      });
      await auditMealPlanTool(
        services.audit,
        resolved.profile,
        "copy_range",
        input.idempotencyKey,
        plans.at(-1)?.plan.version ?? 0,
      );
      return mealPlanToolResult(
        { plans },
        `Copied ${plans.length} meal plans.`,
      );
    },
  );

  server.registerTool(
    MEAL_PLAN_TOOL_NAMES.deleteDaily,
    {
      title: "Delete Daily Meal Plan",
      description: "Delete a draft daily plan after explicit confirmation.",
      inputSchema: deleteDailyMealPlanInputSchema,
      outputSchema: deleteDailyMealPlanOutputSchema,
      annotations: destructiveAnnotations,
      _meta: MCP_MEAL_WRITE_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await mealPlanToolContext(
        services,
        extra.authInfo,
        input.profileId,
        MEAL_PLAN_TOOL_NAMES.deleteDaily,
      );
      if (resolved.ok === false) return resolved.result;
      const deleted = await services.mealPlans.deleteDraftPlan({
        access: resolved.access,
        localFoodDate: input.localFoodDate,
        expectedVersion: input.expectedVersion,
        confirmDelete: input.confirmDelete,
      });
      await auditMealPlanTool(
        services.audit,
        resolved.profile,
        "delete",
        input.localFoodDate,
        input.expectedVersion,
      );
      return mealPlanToolResult(
        { deleted, timezone: input.timezone },
        deleted
          ? "Deleted draft meal plan."
          : "No draft meal plan was deleted.",
      );
    },
  );

  server.registerTool(
    MEAL_PLAN_TOOL_NAMES.getMeal,
    {
      title: "Get Planned Meal",
      description: "Read a planned meal and its immutable nutrition snapshots.",
      inputSchema: getPlannedMealInputSchema,
      outputSchema: getPlannedMealOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: MCP_READ_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await mealPlanToolContext(
        services,
        extra.authInfo,
        input.profileId,
        MEAL_PLAN_TOOL_NAMES.getMeal,
      );
      if (resolved.ok === false) return resolved.result;
      const value = await services.mealPlans.getPlannedMeal({
        access: resolved.access,
        plannedMealId: input.plannedMealId,
      });
      return mealPlanToolResult(
        { plannedMeal: value ?? null },
        value === undefined
          ? "Planned meal not found."
          : `Planned meal ${value.plannedMeal.title}, version ${value.plannedMeal.version}.`,
      );
    },
  );

  server.registerTool(
    MEAL_PLAN_TOOL_NAMES.updateMeal,
    {
      title: "Update Planned Meal",
      description:
        "Update, reorder, reschedule, or replace ingredients in a planned meal using resource versions.",
      inputSchema: updatePlannedMealInputSchema,
      outputSchema: updatePlannedMealOutputSchema,
      annotations: writeAnnotations,
      _meta: MCP_MEAL_WRITE_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await mealPlanToolContext(
        services,
        extra.authInfo,
        input.profileId,
        MEAL_PLAN_TOOL_NAMES.updateMeal,
      );
      if (resolved.ok === false) return resolved.result;
      const result = await services.mealPlans.updatePlannedMeal({
        access: resolved.access,
        plannedMealId: input.plannedMealId,
        expectedPlanVersion: input.expectedPlanVersion,
        expectedMealVersion: input.expectedMealVersion,
        patch: definedMealPatch(input.patch),
      });
      await auditMealPlanTool(
        services.audit,
        resolved.profile,
        "meal_update",
        result.plannedMeal.id,
        result.plannedMeal.version,
      );
      return mealPlanToolResult(
        { plan: result },
        `Updated planned meal to version ${result.plannedMeal.version}.`,
      );
    },
  );

  server.registerTool(
    MEAL_PLAN_TOOL_NAMES.replaceMeal,
    {
      title: "Replace Planned Meal",
      description:
        "Preserve the original planned meal and add its replacement after explicit confirmation.",
      inputSchema: replacePlannedMealInputSchema,
      outputSchema: replacePlannedMealOutputSchema,
      annotations: destructiveAnnotations,
      _meta: MCP_MEAL_WRITE_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await mealPlanToolContext(
        services,
        extra.authInfo,
        input.profileId,
        MEAL_PLAN_TOOL_NAMES.replaceMeal,
      );
      if (resolved.ok === false) return resolved.result;
      const result = await services.mealPlans.replacePlannedMeal({
        access: resolved.access,
        plannedMealId: input.plannedMealId,
        expectedPlanVersion: input.expectedPlanVersion,
        expectedMealVersion: input.expectedMealVersion,
        replacement: input.replacement,
        reason: input.reason,
        confirmReplace: input.confirmReplace,
      });
      await auditMealPlanTool(
        services.audit,
        resolved.profile,
        "replace",
        result.originalMeal.id,
        result.plan.version,
      );
      return mealPlanToolResult(
        { plan: result },
        `Replaced planned meal; plan version ${result.plan.version}.`,
      );
    },
  );

  server.registerTool(
    MEAL_PLAN_TOOL_NAMES.markStatus,
    {
      title: "Mark Planned Meal Status",
      description:
        "Mark a planned meal planned, skipped, or not confirmed. Skipping never creates an actual meal log.",
      inputSchema: markPlannedMealStatusInputSchema,
      outputSchema: markPlannedMealStatusOutputSchema,
      annotations: writeAnnotations,
      _meta: MCP_MEAL_WRITE_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await mealPlanToolContext(
        services,
        extra.authInfo,
        input.profileId,
        MEAL_PLAN_TOOL_NAMES.markStatus,
      );
      if (resolved.ok === false) return resolved.result;
      const result = await services.mealPlans.markPlannedMealStatus({
        access: resolved.access,
        plannedMealId: input.plannedMealId,
        status: input.status,
        expectedPlanVersion: input.expectedPlanVersion,
        expectedMealVersion: input.expectedMealVersion,
        coachNote: input.coachNote,
      });
      await auditMealPlanTool(
        services.audit,
        resolved.profile,
        "status",
        result.plannedMeal.id,
        result.plan.version,
      );
      return mealPlanToolResult(
        { plan: result },
        `Marked planned meal ${result.plannedMeal.status}.`,
      );
    },
  );

  server.registerTool(
    MEAL_PLAN_TOOL_NAMES.convertToLog,
    {
      title: "Convert Planned Meal To Log",
      description:
        "Create one actual meal log from a planned meal, preserving the plan and snapshots. Replays do not create duplicate logs.",
      inputSchema: convertPlannedMealToLogInputSchema,
      outputSchema: convertPlannedMealToLogOutputSchema,
      annotations: writeAnnotations,
      _meta: MCP_MEAL_WRITE_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await mealPlanToolContext(
        services,
        extra.authInfo,
        input.profileId,
        MEAL_PLAN_TOOL_NAMES.convertToLog,
      );
      if (resolved.ok === false) return resolved.result;
      const result = await services.mealPlans.convertPlannedMealToLog({
        access: resolved.access,
        plannedMealId: input.plannedMealId,
        status: input.status,
        expectedPlanVersion: input.expectedPlanVersion,
        expectedMealVersion: input.expectedMealVersion,
        actualIngredients: input.actualIngredients,
        actualTitle: input.actualTitle,
        actualDescription: input.actualDescription,
        replacementReason: input.replacementReason,
        idempotencyKey: input.idempotencyKey,
        origin: "mcp",
      });
      await auditMealPlanTool(
        services.audit,
        resolved.profile,
        "convert",
        result.mealLog.id,
        result.plan.version,
      );
      return mealPlanToolResult(
        { conversion: result, idempotencyKey: input.idempotencyKey ?? null },
        result.idempotentReplay
          ? "Returned the existing actual meal log."
          : "Created and linked an actual meal log.",
      );
    },
  );

  server.registerTool(
    MEAL_PLAN_TOOL_NAMES.compare,
    {
      title: "Compare Plan To Actual",
      description:
        "Compare planned snapshots with actual logged intake without counting unconfirmed plans as consumed.",
      inputSchema: comparePlanToActualInputSchema,
      outputSchema: comparePlanToActualOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: MCP_READ_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await mealPlanToolContext(
        services,
        extra.authInfo,
        input.profileId,
        MEAL_PLAN_TOOL_NAMES.compare,
      );
      if (resolved.ok === false) return resolved.result;
      const comparison = await services.mealPlans.comparePlanToActual({
        access: resolved.access,
        localFoodDate: input.localFoodDate,
      });
      return mealPlanToolResult(
        { comparison: comparison ?? null, timezone: input.timezone },
        comparison === undefined
          ? "Meal plan not found."
          : `Compared ${comparison.meals.length} planned meals with actual intake.`,
      );
    },
  );
}

function registerEatingCheckInMcpTools(
  server: McpServer,
  services: McpReadServices,
): void {
  server.registerTool(
    EATING_CHECKIN_TOOL_NAMES.create,
    {
      title: "Create Eating Check-In",
      description:
        "Create a structured CBT-style eating check-in for hunger, fullness, urges, emotions, triggers, thoughts, context, and coping actions.",
      inputSchema: createEatingCheckInInputSchema,
      outputSchema: eatingCheckInOutputSchema,
      annotations: writeAnnotations,
      _meta: MCP_COACH_WRITE_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await eatingCheckInToolContext(
        services,
        extra.authInfo,
        input.profileId,
        EATING_CHECKIN_TOOL_NAMES.create,
      );
      if (resolved.ok === false) return resolved.result;
      const result = await services.eatingCheckIns.createCheckIn({
        ...input,
        userId: resolved.profile.subjectUserId,
        profileId: resolved.profile.profileId,
        occurredAt: input.occurredAt ?? new Date().toISOString(),
      });
      await auditEatingCheckInTool(
        services.audit,
        resolved.profile,
        "create",
        result.checkIn.id,
      );
      return eatingCheckInToolResult(
        result,
        result.operation === "unchanged"
          ? "Returned existing eating check-in."
          : "Created eating check-in.",
      );
    },
  );

  server.registerTool(
    EATING_CHECKIN_TOOL_NAMES.update,
    {
      title: "Update Eating Check-In",
      description: "Correct a structured eating check-in.",
      inputSchema: updateEatingCheckInInputSchema,
      outputSchema: eatingCheckInOutputSchema,
      annotations: writeAnnotations,
      _meta: MCP_COACH_WRITE_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await eatingCheckInToolContext(
        services,
        extra.authInfo,
        input.profileId,
        EATING_CHECKIN_TOOL_NAMES.update,
      );
      if (resolved.ok === false) return resolved.result;
      const checkIn = await services.eatingCheckIns.updateCheckIn({
        userId: resolved.profile.subjectUserId,
        profileId: resolved.profile.profileId,
        checkInId: input.checkInId,
        patch: compactUndefined(input.patch) as EatingCheckInPatch,
      });
      if (checkIn !== undefined) {
        await auditEatingCheckInTool(
          services.audit,
          resolved.profile,
          "update",
          checkIn.id,
        );
      }
      return eatingCheckInToolResult(
        { checkIn: checkIn ?? null },
        checkIn === undefined
          ? "Eating check-in not found."
          : "Updated eating check-in.",
      );
    },
  );

  server.registerTool(
    EATING_CHECKIN_TOOL_NAMES.list,
    {
      title: "Get Eating Check-Ins",
      description:
        "Read structured eating check-ins by range, actual meal, or planned meal.",
      inputSchema: getEatingCheckInsInputSchema,
      outputSchema: eatingCheckInOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: MCP_READ_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await eatingCheckInToolContext(
        services,
        extra.authInfo,
        input.profileId,
        EATING_CHECKIN_TOOL_NAMES.list,
      );
      if (resolved.ok === false) return resolved.result;
      const checkIns = await services.eatingCheckIns.getCheckIns({
        userId: resolved.profile.subjectUserId,
        profileId: resolved.profile.profileId,
        range: input.range,
        linkedMealId: input.linkedMealId,
        linkedPlannedMealId: input.linkedPlannedMealId,
        limit: input.limit,
      });
      return eatingCheckInToolResult(
        { checkIns },
        `Found ${checkIns.length} eating check-ins.`,
      );
    },
  );

  server.registerTool(
    EATING_CHECKIN_TOOL_NAMES.latest,
    {
      title: "Get Latest Eating Check-In",
      description: "Read the latest structured eating check-in.",
      inputSchema: getLatestEatingCheckInInputSchema,
      outputSchema: eatingCheckInOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: MCP_READ_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await eatingCheckInToolContext(
        services,
        extra.authInfo,
        input.profileId,
        EATING_CHECKIN_TOOL_NAMES.latest,
      );
      if (resolved.ok === false) return resolved.result;
      const checkIn = await services.eatingCheckIns.getLatestCheckIn({
        userId: resolved.profile.subjectUserId,
        profileId: resolved.profile.profileId,
      });
      return eatingCheckInToolResult(
        { checkIn: checkIn ?? null },
        checkIn === undefined
          ? "No eating check-in exists."
          : "Returned latest eating check-in.",
      );
    },
  );

  server.registerTool(
    EATING_CHECKIN_TOOL_NAMES.linkMeal,
    {
      title: "Link Check-In To Meal",
      description:
        "Link an existing eating check-in to one actual meal, one planned meal, or both.",
      inputSchema: linkCheckInToMealInputSchema,
      outputSchema: eatingCheckInOutputSchema,
      annotations: writeAnnotations,
      _meta: MCP_COACH_WRITE_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await eatingCheckInToolContext(
        services,
        extra.authInfo,
        input.profileId,
        EATING_CHECKIN_TOOL_NAMES.linkMeal,
      );
      if (resolved.ok === false) return resolved.result;
      const checkIn = await services.eatingCheckIns.linkCheckInToMeal({
        userId: resolved.profile.subjectUserId,
        profileId: resolved.profile.profileId,
        checkInId: input.checkInId,
        linkedMealId: input.linkedMealId,
        linkedPlannedMealId: input.linkedPlannedMealId,
      });
      if (checkIn !== undefined) {
        await auditEatingCheckInTool(
          services.audit,
          resolved.profile,
          "link",
          checkIn.id,
        );
      }
      return eatingCheckInToolResult(
        { checkIn: checkIn ?? null },
        checkIn === undefined
          ? "Eating check-in not found."
          : "Linked eating check-in.",
      );
    },
  );

  server.registerTool(
    EATING_CHECKIN_TOOL_NAMES.triggerSummary,
    {
      title: "Get Eating Trigger Summary",
      description:
        "Summarize hunger, emotions, triggers, context, screens, second servings, coping actions, and intensity trends.",
      inputSchema: eatingSummaryInputSchema,
      outputSchema: eatingCheckInOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: MCP_READ_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await eatingCheckInToolContext(
        services,
        extra.authInfo,
        input.profileId,
        EATING_CHECKIN_TOOL_NAMES.triggerSummary,
      );
      if (resolved.ok === false) return resolved.result;
      const summary = await services.eatingCheckIns.getTriggerSummary({
        userId: resolved.profile.subjectUserId,
        profileId: resolved.profile.profileId,
        range: defaultEatingSummaryRange(input.range),
        limit: input.limit,
      });
      return eatingCheckInToolResult(
        { summary },
        `Summarized ${summary.checkInCount} eating check-ins.`,
      );
    },
  );

  server.registerTool(
    EATING_CHECKIN_TOOL_NAMES.bingeSummary,
    {
      title: "Get Binge Pattern Summary",
      description:
        "Surface loss-of-control and discomfort eating patterns without diagnosing an eating disorder.",
      inputSchema: eatingSummaryInputSchema,
      outputSchema: eatingCheckInOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: MCP_READ_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await eatingCheckInToolContext(
        services,
        extra.authInfo,
        input.profileId,
        EATING_CHECKIN_TOOL_NAMES.bingeSummary,
      );
      if (resolved.ok === false) return resolved.result;
      const summary = await services.eatingCheckIns.getBingePatternSummary({
        userId: resolved.profile.subjectUserId,
        profileId: resolved.profile.profileId,
        range: defaultEatingSummaryRange(input.range),
        limit: input.limit,
      });
      return eatingCheckInToolResult(
        { summary },
        `Found ${summary.episodeCount} loss-of-control or discomfort-pattern episodes.`,
      );
    },
  );

  server.registerTool(
    EATING_CHECKIN_TOOL_NAMES.weeklyReport,
    {
      title: "Get CBT Weekly Report",
      description:
        "Report weekly behavioral eating metrics and safer next actions without diagnosis or compensation advice.",
      inputSchema: eatingSummaryInputSchema,
      outputSchema: eatingCheckInOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: MCP_READ_TOOL_META,
    },
    async (input, extra) => {
      const resolved = await eatingCheckInToolContext(
        services,
        extra.authInfo,
        input.profileId,
        EATING_CHECKIN_TOOL_NAMES.weeklyReport,
      );
      if (resolved.ok === false) return resolved.result;
      const report = await services.eatingCheckIns.getWeeklyReport({
        userId: resolved.profile.subjectUserId,
        profileId: resolved.profile.profileId,
        range: defaultEatingSummaryRange(input.range),
        limit: input.limit,
      });
      return eatingCheckInToolResult(
        { report },
        `Generated CBT weekly report from ${report.metrics.checkIns} check-ins.`,
      );
    },
  );
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;
const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;
const destructiveAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
} as const;

function definedMealPatch(
  patch: Readonly<Record<string, unknown>>,
): Partial<Omit<PlannedMealDraft, "id">> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<Omit<PlannedMealDraft, "id">>;
}

export function registerMcpRoutes(
  app: Hono<ServerEnv>,
  services: McpReadServices,
  config: McpOAuthConfig,
): void {
  const sessions = new Map<string, McpSession>();

  app.use("/mcp", requireMcpAuth(config, MCP_CONNECTOR_SCOPES));
  app.all("/mcp", async (context) => {
    const method = context.req.method.toUpperCase();

    if (method === "POST") {
      const parsedBody = await readJsonRpcBody(context.req.raw);

      if (parsedBody.ok === false) {
        const error = parsedBody;

        return jsonRpcError(error.status, error.code, error.error);
      }

      const session = await sessionForPostRequest({
        auth: context.get("auth"),
        body: parsedBody.body,
        config,
        request: context.req.raw,
        services,
        sessions,
      });

      if (session.ok === false) {
        const error = session;

        return jsonRpcError(error.status, error.code, error.error);
      }

      return session.value.transport.handleRequest(
        requestWithJsonBody(context.req.raw, parsedBody.body),
        {
          authInfo: authInfoForContext(context.get("auth"), config),
          parsedBody: parsedBody.body,
        },
      );
    }

    const sessionId = context.req.header("mcp-session-id");
    const session =
      sessionId === undefined ? undefined : sessions.get(sessionId);

    if (session === undefined) {
      return jsonRpcError(404, -32001, "Session not found");
    }

    return session.transport.handleRequest(context.req.raw, {
      authInfo: authInfoForContext(context.get("auth"), config),
    });
  });
}

async function sessionForPostRequest(input: {
  auth: AuthContext;
  body: unknown;
  config: McpOAuthConfig;
  request: Request;
  services: McpReadServices;
  sessions: Map<string, McpSession>;
}): Promise<
  | Readonly<{
      ok: true;
      value: McpSession;
    }>
  | Readonly<{
      ok: false;
      status: 400 | 404;
      code: number;
      error: string;
    }>
> {
  const sessionId = input.request.headers.get("mcp-session-id") ?? undefined;
  const existingSession =
    sessionId === undefined ? undefined : input.sessions.get(sessionId);

  if (existingSession !== undefined) {
    return {
      ok: true,
      value: existingSession,
    };
  }

  if (sessionId !== undefined) {
    return {
      ok: false,
      status: 404,
      code: -32001,
      error: "Session not found",
    };
  }

  if (!containsInitializeRequest(input.body)) {
    return {
      ok: false,
      status: 400,
      code: -32000,
      error: "Bad Request: Mcp-Session-Id header is required",
    };
  }

  const server = createFitnessMcpServer(input.services);
  let currentSession: McpSession | undefined;
  const transport = createMcpTransport({
    onsessioninitialized: (initializedSessionId) => {
      currentSession = {
        server,
        transport,
      };
      input.sessions.set(initializedSessionId, currentSession);
    },
    onsessionclosed: async (closedSessionId) => {
      input.sessions.delete(closedSessionId);
      await server.close();
    },
  });

  await server.connect(transport);

  return {
    ok: true,
    value: currentSession ?? {
      server,
      transport,
    },
  };
}

function createMcpTransport(
  options: Pick<
    WebStandardStreamableHTTPServerTransportOptions,
    "onsessionclosed" | "onsessioninitialized"
  >,
): WebStandardStreamableHTTPServerTransport {
  return new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    enableJsonResponse: true,
    ...options,
  });
}

async function readJsonRpcBody(request: Request): Promise<
  | Readonly<{ ok: true; body: unknown }>
  | Readonly<{
      ok: false;
      status: 400 | 415;
      code: number;
      error: string;
    }>
> {
  const contentType = request.headers.get("content-type");

  if (contentType === null || !contentType.includes("application/json")) {
    return {
      ok: false,
      status: 415,
      code: -32000,
      error: "Unsupported Media Type: Content-Type must be application/json",
    };
  }

  try {
    return {
      ok: true,
      body: await request.json(),
    };
  } catch {
    return {
      ok: false,
      status: 400,
      code: -32700,
      error: "Parse error: Invalid JSON",
    };
  }
}

function requestWithJsonBody(request: Request, body: unknown): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(body),
  });
}

function containsInitializeRequest(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.some(isInitializeRequest);
  }

  return isInitializeRequest(body);
}

function authInfoForContext(
  auth: AuthContext,
  config: McpOAuthConfig,
): AuthInfo {
  return {
    token: auth.claims.jti ?? "validated-access-token",
    clientId: auth.claims.sub,
    scopes: [...auth.scopes],
    expiresAt: auth.claims.exp,
    resource: new URL(config.resource),
    extra: {
      actorUserId: auth.actorUserId,
      userId: auth.userId,
      actorType: auth.actor.type,
      actorId: auth.actor.id,
    },
  };
}

function userIdFromAuthInfo(
  authInfo: AuthInfo | undefined,
): string | undefined {
  const userId = authInfo?.extra?.userId;

  return typeof userId === "string" ? userId : undefined;
}

async function mealPlanToolContext(
  services: McpReadServices,
  authInfo: AuthInfo | undefined,
  profileId: string | undefined,
  toolName: string,
): Promise<
  | Readonly<{
      ok: true;
      profile: ProfileContext;
      access: MealPlanAccessContext;
    }>
  | Readonly<{ ok: false; result: CallToolResult }>
> {
  const actorUserId = userIdFromAuthInfo(authInfo);
  if (actorUserId === undefined) {
    return { ok: false, result: unauthenticatedToolResult() };
  }
  const resolved = await requireToolProfileContext(
    services.profiles,
    services.authorization,
    actorUserId,
    profileId,
    toolName,
  );
  if (resolved.ok === false) return resolved;
  return {
    ok: true,
    profile: resolved.value,
    access: {
      actorUserId: resolved.value.actorUserId,
      subjectUserId: resolved.value.subjectUserId,
      profileId: resolved.value.profileId,
      permissions: resolved.value.permissions,
    },
  };
}

async function eatingCheckInToolContext(
  services: McpReadServices,
  authInfo: AuthInfo | undefined,
  profileId: string | undefined,
  toolName: string,
): Promise<
  | Readonly<{
      ok: true;
      profile: ProfileContext;
    }>
  | Readonly<{ ok: false; result: CallToolResult }>
> {
  const actorUserId = userIdFromAuthInfo(authInfo);
  if (actorUserId === undefined) {
    return { ok: false, result: unauthenticatedToolResult() };
  }
  const resolved = await requireToolProfileContext(
    services.profiles,
    services.authorization,
    actorUserId,
    profileId,
    toolName,
  );
  return resolved.ok === false
    ? resolved
    : {
        ok: true,
        profile: resolved.value,
      };
}

async function auditMealPlanTool(
  audit: AuditPort,
  profile: ProfileContext,
  operation: string,
  targetId: string,
  version: number,
): Promise<void> {
  await audit.create({
    action: `mcp.meal.plan.${operation}`,
    actor: { type: "user", id: profile.actorUserId },
    target: { type: "daily_meal_plan", id: targetId },
    userId: profile.subjectUserId,
    profileId: profile.profileId,
    metadata: { profileId: profile.profileId, version },
  });
}

async function auditEatingCheckInTool(
  audit: AuditPort,
  profile: ProfileContext,
  operation: string,
  targetId: string,
): Promise<void> {
  await audit.create({
    action: `mcp.eating_checkin.${operation}`,
    actor: { type: "user", id: profile.actorUserId },
    target: { type: "eating_checkin", id: targetId },
    userId: profile.subjectUserId,
    profileId: profile.profileId,
    metadata: { profileId: profile.profileId },
  });
}

function defaultEatingSummaryRange(
  range: Readonly<{ from: string; to: string }> | undefined,
): Readonly<{ from: string; to: string }> {
  if (range !== undefined) return range;

  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1_000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

function compactUndefined<T extends Readonly<Record<string, unknown>>>(
  value: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

async function requireToolProfileContext(
  profiles: ProfileService,
  authorization: AuthorizationService,
  actorUserId: string,
  profileId: string | undefined,
  toolName: string,
): Promise<
  | Readonly<{ ok: true; value: ProfileContext }>
  | Readonly<{ ok: false; result: CallToolResult }>
> {
  try {
    const requiredPermissions = requiredPermissionsForMcpTool(toolName);

    if (requiredPermissions === undefined) {
      throw new AuthorizationError("PERMISSION_DENIED", {
        requestedAction: toolName,
      });
    }

    if (profileId !== undefined) {
      await authorization.requireAllPermissions(
        actorUserId,
        profileId,
        requiredPermissions,
        { requestedAction: toolName },
      );
    }

    const value = await profiles.requireProfileContext(actorUserId, profileId);

    if (profileId === undefined) {
      await authorization.requireAllPermissions(
        actorUserId,
        value.profileId,
        requiredPermissions,
        { requestedAction: toolName },
      );
    }

    return {
      ok: true,
      value,
    };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return {
        ok: false,
        result: authorizationErrorToolResult(error),
      };
    }
    if (error instanceof ProfileAccessError) {
      return {
        ok: false,
        result: profileAccessErrorToolResult(error),
      };
    }

    throw error;
  }
}

async function profileToolResult(
  callback: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authorizationErrorToolResult(error);
    }
    if (error instanceof ProfileAccessError) {
      return profileAccessErrorToolResult(error);
    }

    throw error;
  }
}

function targetToolDefinition<T extends Record<string, ZodType>>(
  title: string,
  description: string,
  inputSchema: T,
  readOnly: boolean,
  destructive = false,
) {
  return {
    title,
    description,
    inputSchema,
    outputSchema: targetPlanOutputSchema,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: destructive,
      openWorldHint: false,
    },
    _meta: readOnly ? MCP_READ_TOOL_META : MCP_COACH_WRITE_TOOL_META,
  };
}

async function runTargetTool(
  services: McpReadServices,
  authInfo: AuthInfo | undefined,
  toolName: string,
  action: TargetAction,
  payload: Record<string, unknown>,
): Promise<CallToolResult> {
  const actorUserId = userIdFromAuthInfo(authInfo);
  if (actorUserId === undefined) return unauthenticatedToolResult();
  const suppliedProfileId =
    typeof payload.profileId === "string" ? payload.profileId : undefined;
  const profileContext = await requireToolProfileContext(
    services.profiles,
    services.authorization,
    actorUserId,
    suppliedProfileId,
    toolName,
  );
  if (profileContext.ok === false) return profileContext.result;
  return targetPlanToolResult({
    action,
    context: profileContext.value,
    service: services.targetPlans,
    payload,
  });
}

async function authorizeProfileTool(
  services: McpReadServices,
  actorUserId: string,
  profileId: string | undefined,
  toolName: string,
  callback: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const profileContext = await requireToolProfileContext(
    services.profiles,
    services.authorization,
    actorUserId,
    profileId,
    toolName,
  );

  if (profileContext.ok === false) return profileContext.result;
  return callback();
}

function authorizationErrorToolResult(
  error: AuthorizationError,
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text:
          error.code === "PROFILE_NOT_ACCESSIBLE"
            ? "Profile was not found or is not accessible for this user."
            : "This profile action is not authorized.",
      },
    ],
    structuredContent: {
      error: error.code,
      requiredPermission: error.requiredPermission,
      requestedAction: error.requestedAction,
      requestId: error.requestId,
    },
    isError: true,
  };
}

function profileAccessErrorToolResult(
  error: ProfileAccessError,
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text:
          error.code === "profile-not-found"
            ? "Profile was not found or is not accessible for this user."
            : "Profile access is not active for this user.",
      },
    ],
    structuredContent: {
      error:
        error.code === "profile-not-found"
          ? "PROFILE_NOT_ACCESSIBLE"
          : "PERMISSION_DENIED",
    },
    isError: true,
  };
}

function unauthenticatedToolResult() {
  return {
    content: [
      {
        type: "text" as const,
        text: "MCP tool call is missing authenticated user context.",
      },
    ],
    isError: true,
  };
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code,
        message,
      },
      id: null,
    }),
    {
      status,
      headers: {
        "content-type": "application/json",
      },
    },
  );
}
