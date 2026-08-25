import {
  COACH_WRITE_SCOPES,
  FIRST_SLICE_MCP_SCOPES,
  MCP_CONNECTOR_SCOPES,
  MCP_MEAL_WRITE_SCOPES,
  createFakeAuthToken,
} from "@fitness/auth";
import { describe, expect, it } from "vitest";
import type { HealthMetricSample } from "../services/health-read.js";
import { createInMemoryHealthReadService } from "../services/health-read.js";
import { createInMemoryMealLogService } from "../services/meals.js";
import { createInMemoryProfileService } from "../services/profiles.js";
import { createApp } from "../app.js";
import type { FitnessTokenClaims } from "@fitness/auth";
import { buildMetricTimeseries } from "./tools/get-metric-timeseries.js";

const nowSeconds = 1_800_000_000;
const protocolVersion = "2025-11-25";

const seedSamples: readonly HealthMetricSample[] = [
  {
    userId: "user_alex",
    profileId: "profile_self_user_alex",
    metricName: "weight",
    unit: "kg",
    value: 87.55,
    startTime: "2026-06-10T06:00:00.000Z",
    endTime: "2026-06-10T06:00:00.000Z",
    timezone: "Asia/Jerusalem",
    source: "xiaomi-scale",
    sourceSampleId: "weight-2026-06-10",
  },
  {
    userId: "user_alex",
    profileId: "profile_self_user_alex",
    metricName: "steps",
    unit: "count",
    value: 11_800,
    startTime: "2026-06-10T00:00:00.000Z",
    endTime: "2026-06-10T23:59:59.000Z",
    timezone: "Asia/Jerusalem",
    source: "apple-watch",
    sourceSampleId: "steps-2026-06-10",
  },
  {
    userId: "user_alex",
    profileId: "profile_self_user_alex",
    metricName: "active_energy",
    unit: "kcal",
    value: 900,
    startTime: "2026-06-10T00:00:00.000Z",
    endTime: "2026-06-10T23:59:59.000Z",
    timezone: "Asia/Jerusalem",
    source: "apple-watch",
    sourceSampleId: "active-energy-2026-06-10",
  },
  {
    userId: "user_alex",
    profileId: "profile_self_user_alex",
    metricName: "resting_energy",
    unit: "kcal",
    value: 2_185,
    startTime: "2026-06-10T00:00:00.000Z",
    endTime: "2026-06-10T23:59:59.000Z",
    timezone: "Asia/Jerusalem",
    source: "apple-watch",
    sourceSampleId: "resting-energy-2026-06-10",
  },
  {
    userId: "user_alex",
    profileId: "profile_self_user_alex",
    metricName: "sleep",
    unit: "minute",
    value: 450,
    startTime: "2026-06-09T22:30:00.000Z",
    endTime: "2026-06-10T06:00:00.000Z",
    timezone: "Asia/Jerusalem",
    source: "apple-watch",
    sourceSampleId: "sleep-2026-06-10",
  },
  {
    userId: "user_alex",
    profileId: "profile_self_user_alex",
    metricName: "resting_heart_rate",
    unit: "bpm",
    value: 66,
    startTime: "2026-06-10T12:00:00.000Z",
    endTime: "2026-06-10T12:00:00.000Z",
    timezone: "Asia/Jerusalem",
    source: "apple-watch",
    sourceSampleId: "rhr-2026-06-10",
  },
  {
    userId: "user_alex",
    profileId: "profile_self_user_alex",
    metricName: "walking_heart_rate",
    unit: "bpm",
    value: 92,
    startTime: "2026-06-10T12:00:00.000Z",
    endTime: "2026-06-10T12:00:00.000Z",
    timezone: "Asia/Jerusalem",
    source: "apple-watch",
    sourceSampleId: "whr-2026-06-10",
  },
  {
    userId: "user_alex",
    profileId: "profile_self_user_alex",
    metricName: "steps",
    unit: "count",
    value: 1_000,
    startTime: "2026-06-11T00:00:00.000Z",
    endTime: "2026-06-11T00:00:00.000Z",
    timezone: "Asia/Jerusalem",
    source: "apple-watch",
    sourceSampleId: "steps-boundary-2026-06-11",
  },
  {
    userId: "other_user",
    metricName: "weight",
    unit: "kg",
    value: 120,
    startTime: "2026-06-10T06:00:00.000Z",
    endTime: "2026-06-10T06:00:00.000Z",
    timezone: "Asia/Jerusalem",
    source: "xiaomi-scale",
    sourceSampleId: "other-weight-2026-06-10",
  },
];

const seedMeals = [
  {
    id: "meal-1",
    userId: "user_alex",
    profileId: "profile_self_user_alex",
    idempotencyKey: "ios-meal:meal-1",
    clientMealId: "meal-1",
    occurredAt: "2026-06-10T08:00:00.000Z",
    timezone: "Asia/Jerusalem",
    title: "Eggs and toast",
    mealType: "Breakfast",
    note: "2 eggs and toast",
    totals: {
      calories: 410,
      proteinGrams: 24,
      carbsGrams: 35,
      fatGrams: 18,
      fiberGrams: 4,
    },
    ingredients: [
      {
        id: "ingredient-1",
        clientIngredientId: "ingredient-1",
        position: 0,
        name: "Eggs",
        quantity: 2,
        unit: "eggs",
        totals: {
          calories: 150,
          proteinGrams: 12,
          carbsGrams: 1,
          fatGrams: 10,
          fiberGrams: 0,
        },
      },
    ],
    photoCount: 1,
    estimateStatus: "ai_estimated",
    estimateConfidence: 0.8,
    estimateSummary: "Estimated from text.",
    origin: "ios",
    createdAt: "2026-06-10T08:01:00.000Z",
    updatedAt: "2026-06-10T08:01:00.000Z",
  },
  {
    id: "meal-other",
    userId: "other_user",
    idempotencyKey: "ios-meal:meal-other",
    clientMealId: "meal-other",
    occurredAt: "2026-06-10T08:00:00.000Z",
    timezone: "Asia/Jerusalem",
    title: "Other user meal",
    mealType: "Breakfast",
    note: "",
    totals: {
      calories: 999,
      proteinGrams: 99,
      carbsGrams: 99,
      fatGrams: 99,
      fiberGrams: 99,
    },
    ingredients: [],
    photoCount: 0,
    estimateStatus: "manual",
    origin: "ios",
    createdAt: "2026-06-10T08:01:00.000Z",
    updatedAt: "2026-06-10T08:01:00.000Z",
  },
] as const;

function validMcpClaims(
  overrides: Partial<FitnessTokenClaims> = {},
): FitnessTokenClaims {
  return {
    iss: "https://mcp.fitness.local",
    aud: "fitness-mcp",
    resource: "https://mcp.fitness.local/mcp",
    sub: "user_alex",
    exp: nowSeconds + 300,
    iat: nowSeconds - 30,
    scope: MCP_CONNECTOR_SCOPES.join(" "),
    jti: "mcp-read-token-1",
    ...overrides,
  };
}

function targetToolExpectation(
  name: string,
  readOnly: boolean,
  destructive = false,
) {
  return {
    name,
    _meta: {
      securitySchemes: [
        {
          type: "oauth2",
          scopes: readOnly ? FIRST_SLICE_MCP_SCOPES : COACH_WRITE_SCOPES,
        },
      ],
    },
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: destructive,
      openWorldHint: false,
    },
  };
}

function bearer(claims: FitnessTokenClaims): string {
  return `Bearer ${createFakeAuthToken(claims)}`;
}

function createMcpTestApp(
  options: {
    healthRead?: ReturnType<typeof createInMemoryHealthReadService> | undefined;
    meals?: ReturnType<typeof createInMemoryMealLogService> | undefined;
    profiles?: ReturnType<typeof createInMemoryProfileService> | undefined;
  } = {},
) {
  return createApp({
    mcp: { now: nowSeconds },
    services: {
      healthRead:
        options.healthRead ?? createInMemoryHealthReadService(seedSamples),
      meals: options.meals ?? createInMemoryMealLogService(seedMeals),
      profiles: options.profiles ?? createInMemoryProfileService(),
    },
  });
}

function expectedFirstSliceReadChallenge(): string {
  return `Bearer resource_metadata="https://mcp.fitness.local/.well-known/oauth-protected-resource", scope="${MCP_CONNECTOR_SCOPES.join(" ")}"`;
}

function expectedFirstSliceReadErrorChallenge(
  error: "invalid_token" | "insufficient_scope",
): string {
  return `Bearer error="${error}", resource_metadata="https://mcp.fitness.local/.well-known/oauth-protected-resource", scope="${MCP_CONNECTOR_SCOPES.join(" ")}"`;
}

async function postMcp(
  app: ReturnType<typeof createApp>,
  body: unknown,
  authorization: string | undefined,
  sessionId?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };

  if (authorization !== undefined) {
    headers.authorization = authorization;
  }

  if (sessionId !== undefined) {
    headers["mcp-session-id"] = sessionId;
    headers["mcp-protocol-version"] = protocolVersion;
  }

  return app.request("/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function initializeMcpSession(
  app: ReturnType<typeof createApp>,
  authorization = bearer(validMcpClaims()),
): Promise<string> {
  const response = await postMcp(
    app,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: {
          name: "fitness-server-test",
          version: "0.0.0",
        },
      },
    },
    authorization,
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    jsonrpc: "2.0",
    id: 1,
    result: {
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "fitness-coach-mcp",
      },
    },
  });

  const sessionId = response.headers.get("mcp-session-id");
  expect(sessionId).toEqual(expect.any(String));
  return sessionId as string;
}

async function callMcpTool(
  app: ReturnType<typeof createApp>,
  name: string,
  args: Record<string, unknown>,
  sessionId: string,
  authorization = bearer(validMcpClaims()),
): Promise<Record<string, unknown>> {
  const response = await postMcp(
    app,
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    },
    authorization,
    sessionId,
  );

  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
}

const rejectionCases = [
  {
    name: "malformed token",
    authorization: "Bearer not-a-jwt",
    status: 401,
    challengeError: "invalid_token",
    expectedError: "malformed",
  },
  {
    name: "expired token",
    authorization: bearer(validMcpClaims({ exp: nowSeconds - 1 })),
    status: 401,
    challengeError: "invalid_token",
    expectedError: "expired",
  },
  {
    name: "wrong issuer token",
    authorization: bearer(
      validMcpClaims({ iss: "https://issuer.example.test" }),
    ),
    status: 401,
    challengeError: "invalid_token",
    expectedError: "wrong-issuer",
  },
  {
    name: "wrong audience token",
    authorization: bearer(validMcpClaims({ aud: "fitness-api" })),
    status: 401,
    challengeError: "invalid_token",
    expectedError: "wrong-audience",
  },
  {
    name: "wrong resource token",
    authorization: bearer(
      validMcpClaims({ resource: "https://api.fitness.local" }),
    ),
    status: 401,
    challengeError: "invalid_token",
    expectedError: "wrong-resource",
  },
  {
    name: "wrong user token",
    authorization: bearer(validMcpClaims({ sub: "other_user" })),
    status: 401,
    challengeError: "invalid_token",
    expectedError: "wrong-user",
  },
  {
    name: "missing health read scope",
    authorization: bearer(validMcpClaims({ scope: "coach:read report:read" })),
    status: 403,
    challengeError: "insufficient_scope",
    expectedError: "missing-scope",
  },
  {
    name: "missing report read scope",
    authorization: bearer(validMcpClaims({ scope: "health:read coach:read" })),
    status: 403,
    challengeError: "insufficient_scope",
    expectedError: "missing-scope",
  },
  {
    name: "deferred write scope",
    authorization: bearer(
      validMcpClaims({
        scope:
          "health:read coach:read report:read meal:write writeback:prepare",
      }),
    ),
    status: 403,
    challengeError: "insufficient_scope",
    expectedError: "missing-scope",
  },
] as const satisfies readonly {
  name: string;
  authorization: string;
  status: 401 | 403;
  challengeError: "invalid_token" | "insufficient_scope";
  expectedError: string;
}[];

describe("authenticated MCP server", () => {
  it("protects the MCP endpoint with a full first-slice read OAuth challenge", async () => {
    const app = createMcpTestApp();

    const response = await postMcp(
      app,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      },
      undefined,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      expectedFirstSliceReadChallenge(),
    );
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it.each(rejectionCases)(
    "rejects $name before MCP request handling",
    async ({ authorization, status, challengeError, expectedError }) => {
      const app = createMcpTestApp();

      const response = await postMcp(
        app,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
        },
        authorization,
      );

      expect(response.status).toBe(status);
      expect(response.headers.get("www-authenticate")).toBe(
        expectedFirstSliceReadErrorChallenge(challengeError),
      );
      await expect(response.json()).resolves.toEqual({ error: expectedError });
    },
  );

  it("advertises read tools plus scoped meal write tools", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);

    const response = await postMcp(
      app,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      },
      bearer(validMcpClaims()),
      sessionId,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { tools: readonly { name: string }[] };
    };

    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        tools: [
          {
            name: "get_mcp_capabilities",
            _meta: {
              securitySchemes: [
                { type: "oauth2", scopes: FIRST_SLICE_MCP_SCOPES },
              ],
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
          },
          {
            name: "list_accessible_profiles",
            _meta: {
              securitySchemes: [
                { type: "oauth2", scopes: FIRST_SLICE_MCP_SCOPES },
              ],
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
          },
          {
            name: "get_profile",
            _meta: {
              securitySchemes: [
                { type: "oauth2", scopes: FIRST_SLICE_MCP_SCOPES },
              ],
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
          },
          {
            name: "get_profile_access",
            _meta: {
              securitySchemes: [
                { type: "oauth2", scopes: FIRST_SLICE_MCP_SCOPES },
              ],
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
          },
          {
            name: "get_health_summary",
            _meta: {
              securitySchemes: [
                { type: "oauth2", scopes: FIRST_SLICE_MCP_SCOPES },
              ],
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
          },
          {
            name: "get_metric_timeseries",
            _meta: {
              securitySchemes: [
                { type: "oauth2", scopes: FIRST_SLICE_MCP_SCOPES },
              ],
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
          },
          {
            name: "generate_report",
            _meta: {
              securitySchemes: [
                { type: "oauth2", scopes: FIRST_SLICE_MCP_SCOPES },
              ],
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
          },
          {
            name: "get_meal_log",
            _meta: {
              securitySchemes: [
                { type: "oauth2", scopes: FIRST_SLICE_MCP_SCOPES },
              ],
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
          },
          {
            name: "get_food_database",
            _meta: {
              securitySchemes: [
                { type: "oauth2", scopes: FIRST_SLICE_MCP_SCOPES },
              ],
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
          },
          {
            name: "get_food_aggregations",
            _meta: {
              securitySchemes: [
                { type: "oauth2", scopes: FIRST_SLICE_MCP_SCOPES },
              ],
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
          },
          {
            name: "get_coach_profile",
            _meta: {
              securitySchemes: [
                { type: "oauth2", scopes: FIRST_SLICE_MCP_SCOPES },
              ],
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
          },
          targetToolExpectation("get_active_target_plan", true),
          targetToolExpectation("get_target_plan", true),
          targetToolExpectation("list_target_plan_history", true),
          targetToolExpectation("calculate_recommended_targets", true),
          targetToolExpectation("create_target_plan_draft", false),
          targetToolExpectation("propose_target_plan", false),
          targetToolExpectation("approve_target_plan", false, true),
          targetToolExpectation("reject_target_plan", false),
          targetToolExpectation("activate_target_plan", false, true),
          targetToolExpectation("archive_target_plan", false, true),
          {
            name: "upsert_meal_log",
            _meta: {
              securitySchemes: [
                { type: "oauth2", scopes: MCP_MEAL_WRITE_SCOPES },
              ],
            },
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              openWorldHint: false,
            },
          },
          {
            name: "upsert_coach_profile",
            _meta: {
              securitySchemes: [{ type: "oauth2", scopes: COACH_WRITE_SCOPES }],
            },
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              openWorldHint: false,
            },
          },
          {
            name: "delete_meal_log",
            _meta: {
              securitySchemes: [
                { type: "oauth2", scopes: MCP_MEAL_WRITE_SCOPES },
              ],
            },
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              openWorldHint: false,
            },
          },
          {
            name: "list_meal_log_snapshots",
            _meta: {
              securitySchemes: [
                { type: "oauth2", scopes: MCP_MEAL_WRITE_SCOPES },
              ],
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
          },
          {
            name: "get_meal_log_snapshot",
            _meta: {
              securitySchemes: [
                { type: "oauth2", scopes: MCP_MEAL_WRITE_SCOPES },
              ],
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
          },
          {
            name: "rollback_meal_log_snapshot",
            _meta: {
              securitySchemes: [
                { type: "oauth2", scopes: MCP_MEAL_WRITE_SCOPES },
              ],
            },
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              openWorldHint: false,
            },
          },
          { name: "get_daily_meal_plan" },
          { name: "get_meal_plan_range" },
          { name: "upsert_daily_meal_plan" },
          { name: "copy_daily_meal_plan" },
          { name: "copy_meal_plan_range" },
          { name: "delete_daily_meal_plan" },
          { name: "get_planned_meal" },
          { name: "update_planned_meal" },
          { name: "replace_planned_meal" },
          { name: "mark_planned_meal_status" },
          { name: "convert_planned_meal_to_log" },
          { name: "compare_plan_to_actual" },
          { name: "create_eating_checkin" },
          { name: "update_eating_checkin" },
          { name: "get_eating_checkins" },
          { name: "get_latest_eating_checkin" },
          { name: "link_checkin_to_meal" },
          { name: "get_eating_trigger_summary" },
          { name: "get_binge_pattern_summary" },
          { name: "get_cbt_weekly_report" },
        ],
      },
    });
    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      "get_mcp_capabilities",
      "list_accessible_profiles",
      "get_profile",
      "get_profile_access",
      "get_health_summary",
      "get_metric_timeseries",
      "generate_report",
      "get_meal_log",
      "get_food_database",
      "get_food_aggregations",
      "get_coach_profile",
      "get_active_target_plan",
      "get_target_plan",
      "list_target_plan_history",
      "calculate_recommended_targets",
      "create_target_plan_draft",
      "propose_target_plan",
      "approve_target_plan",
      "reject_target_plan",
      "activate_target_plan",
      "archive_target_plan",
      "upsert_meal_log",
      "upsert_coach_profile",
      "delete_meal_log",
      "list_meal_log_snapshots",
      "get_meal_log_snapshot",
      "rollback_meal_log_snapshot",
      "get_daily_meal_plan",
      "get_meal_plan_range",
      "upsert_daily_meal_plan",
      "copy_daily_meal_plan",
      "copy_meal_plan_range",
      "delete_daily_meal_plan",
      "get_planned_meal",
      "update_planned_meal",
      "replace_planned_meal",
      "mark_planned_meal_status",
      "convert_planned_meal_to_log",
      "compare_plan_to_actual",
      "create_eating_checkin",
      "update_eating_checkin",
      "get_eating_checkins",
      "get_latest_eating_checkin",
      "link_checkin_to_meal",
      "get_eating_trigger_summary",
      "get_binge_pattern_summary",
      "get_cbt_weekly_report",
    ]);
    expect(FIRST_SLICE_MCP_SCOPES).toEqual([
      "health:read",
      "coach:read",
      "report:read",
    ]);
  });

  it("explains MCP capabilities through a read-only tool", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);

    const body = await callMcpTool(app, "get_mcp_capabilities", {}, sessionId);

    expect(body).toMatchObject({
      result: {
        structuredContent: {
          profileId: "profile_self_user_alex",
          relationship: "self",
          roleIdentifier: "owner",
          effectivePermissions: expect.arrayContaining([
            "health.summary.read",
            "meal.write",
          ]),
          availableTools: expect.arrayContaining([
            "get_health_summary",
            "upsert_meal_log",
          ]),
          readCapabilities: expect.arrayContaining(["get_health_summary"]),
          writeCapabilities: expect.arrayContaining(["upsert_meal_log"]),
          accessStatus: "active",
          toolGroups: expect.arrayContaining([
            expect.objectContaining({
              title: "Coach and reports",
            }),
          ]),
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain("apply_daily_plan");
    expect(JSON.stringify(body)).not.toContain("generate_daily_plan");
    expect(JSON.stringify(body)).toContain("Create meals");
    expect(JSON.stringify(body)).toContain("get_food_database");
    expect(JSON.stringify(body)).toContain("get_food_aggregations");
    expect(JSON.stringify(body)).toContain("HealthKit write permission");
    expect(JSON.stringify(body)).toContain("convert_planned_meal_to_log");
  });

  it("keeps advertised MCP capabilities aligned with registered tools", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);
    const toolsResponse = await postMcp(
      app,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/list",
        params: {},
      },
      bearer(validMcpClaims()),
      sessionId,
    );
    const toolsBody = (await toolsResponse.json()) as {
      result: { tools: readonly { name: string }[] };
    };
    const capabilities = (await callMcpTool(
      app,
      "get_mcp_capabilities",
      {},
      sessionId,
    )) as {
      result: {
        structuredContent: { availableTools: readonly string[] };
      };
    };
    const registered = toolsBody.result.tools.map((tool) => tool.name).sort();
    const advertised = [
      ...capabilities.result.structuredContent.availableTools,
    ].sort();

    expect(advertised).toEqual(registered);
  });

  it("creates and reads a separate daily meal plan through MCP", async () => {
    const app = createMcpTestApp({ meals: createInMemoryMealLogService([]) });
    const sessionId = await initializeMcpSession(app);
    const created = await callMcpTool(
      app,
      "upsert_daily_meal_plan",
      {
        localFoodDate: "2026-07-15",
        timezone: "Asia/Jerusalem",
        status: "active",
        idempotencyKey: "mcp-plan-2026-07-15", // gitleaks:allow -- synthetic test identifier
        meals: [
          {
            mealType: "Lunch",
            plannedTime: "13:00",
            title: "Chicken and rice",
            ingredients: [
              {
                displayName: "Chicken breast",
                quantity: 180,
                unit: "g",
                grams: 180,
                totals: {
                  calories: 300,
                  proteinGrams: 55,
                  carbsGrams: 0,
                  fatGrams: 7,
                  fiberGrams: 0,
                },
              },
            ],
          },
        ],
      },
      sessionId,
    );
    const read = await callMcpTool(
      app,
      "get_daily_meal_plan",
      {
        localFoodDate: "2026-07-15",
        timezone: "Asia/Jerusalem",
      },
      sessionId,
    );

    expect(created).toMatchObject({
      result: {
        structuredContent: {
          result: { plan: { plan: { version: 1 } } },
        },
      },
    });
    expect(read).toMatchObject({
      result: {
        structuredContent: {
          result: {
            plan: {
              plannedTotals: { calories: 300, proteinGrams: 55 },
              plan: { meals: [{ status: "planned" }] },
            },
          },
        },
      },
    });
  });

  it("creates CBT eating check-ins and summarizes behavioral patterns through MCP", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);

    const created = await callMcpTool(
      app,
      "create_eating_checkin",
      {
        idempotencyKey: "cbt-checkin-1",
        occurredAt: "2026-06-10T17:00:00.000Z",
        timezone: "Asia/Jerusalem",
        hungerBefore: 7,
        fullnessAfter: 8,
        urgeIntensity: 8,
        emotionIntensity: 6,
        emotions: ["stress", "stress"],
        triggers: ["screen", "late lunch"],
        automaticThought: "I already missed the plan.",
        balancedResponse: "I can still eat the planned snack.",
        eatingContext: "stress",
        lossOfControl: true,
        ateWithScreen: true,
        tookSecondServing: true,
        copingAction: "10 minute pause",
        urgeDelayMinutes: 10,
        outcome: "pause helped",
      },
      sessionId,
    );
    const replay = await callMcpTool(
      app,
      "create_eating_checkin",
      {
        idempotencyKey: "cbt-checkin-1",
        occurredAt: "2026-06-10T18:00:00.000Z",
        timezone: "Asia/Jerusalem",
        hungerBefore: 1,
      },
      sessionId,
    );
    const checkInId = (
      created as {
        result: {
          structuredContent: {
            result: { checkIn: { id: string } };
          };
        };
      }
    ).result.structuredContent.result.checkIn.id;

    expect(created).toMatchObject({
      result: {
        structuredContent: {
          result: {
            operation: "created",
            checkIn: {
              hungerBefore: 7,
              emotions: ["stress"],
              triggers: ["screen", "late lunch"],
            },
          },
        },
      },
    });
    expect(replay).toMatchObject({
      result: {
        structuredContent: {
          result: {
            operation: "unchanged",
            checkIn: {
              id: checkInId,
              hungerBefore: 7,
            },
          },
        },
      },
    });

    const linked = await callMcpTool(
      app,
      "link_checkin_to_meal",
      {
        checkInId,
        linkedMealId: "meal-1",
      },
      sessionId,
    );
    const latest = await callMcpTool(
      app,
      "get_latest_eating_checkin",
      {},
      sessionId,
    );
    const triggerSummary = await callMcpTool(
      app,
      "get_eating_trigger_summary",
      {
        range: {
          from: "2026-06-10T00:00:00.000Z",
          to: "2026-06-11T00:00:00.000Z",
        },
      },
      sessionId,
    );
    const weeklyReport = await callMcpTool(
      app,
      "get_cbt_weekly_report",
      {
        range: {
          from: "2026-06-10T00:00:00.000Z",
          to: "2026-06-17T00:00:00.000Z",
        },
      },
      sessionId,
    );

    expect(linked).toMatchObject({
      result: {
        structuredContent: {
          result: {
            checkIn: {
              id: checkInId,
              linkedMealId: "meal-1",
            },
          },
        },
      },
    });
    expect(latest).toMatchObject({
      result: {
        structuredContent: {
          result: {
            checkIn: {
              id: checkInId,
              linkedMealId: "meal-1",
            },
          },
        },
      },
    });
    expect(triggerSummary).toMatchObject({
      result: {
        structuredContent: {
          result: {
            summary: {
              checkInCount: 1,
              averageHungerBefore: 7,
              screenEatingCount: 1,
              secondServingCount: 1,
              lossOfControlCount: 1,
              safetyNote: expect.stringContaining("not a medical diagnosis"),
            },
          },
        },
      },
    });
    expect(JSON.stringify(weeklyReport)).toContain(
      "Avoid fasting, skipping meals, punitive exercise, or extreme restriction",
    );
  });

  it("lists and reads accessible health profiles through MCP", async () => {
    const profiles = createInMemoryProfileService({
      now: () => new Date("2026-07-15T08:00:00.000Z"),
    });
    const managed = await profiles.createManagedProfile("user_alex", {
      displayName: "Family member",
      timezone: "Asia/Jerusalem",
      relationship: "guardian",
      roleIdentifier: "owner",
    });
    const app = createMcpTestApp({ profiles });
    const sessionId = await initializeMcpSession(app);

    const list = await callMcpTool(
      app,
      "list_accessible_profiles",
      {},
      sessionId,
    );
    const self = await callMcpTool(app, "get_profile", {}, sessionId);
    const explicit = await callMcpTool(
      app,
      "get_profile_access",
      {
        profileId: managed.profileId,
      },
      sessionId,
    );

    expect(list).toMatchObject({
      result: {
        structuredContent: {
          profiles: [
            {
              profileId: "profile_self_user_alex",
              relationship: "self",
              ownershipStatus: "owner",
              isManaged: false,
              permissions: expect.arrayContaining([
                "profile.read",
                "health.summary.read",
              ]),
            },
            {
              profileId: managed.profileId,
              displayName: "Family member",
              relationship: "guardian",
              ownershipStatus: "owner",
              isManaged: true,
              permissions: expect.arrayContaining([
                "profile.read",
                "profile_members.manage",
              ]),
            },
          ],
        },
      },
    });
    expect(self).toMatchObject({
      result: {
        structuredContent: {
          profile: {
            profileId: "profile_self_user_alex",
            profileType: "self",
            relationship: "self",
            isManaged: false,
          },
        },
      },
    });
    expect(explicit).toMatchObject({
      result: {
        structuredContent: {
          access: {
            profileId: managed.profileId,
            relationship: "guardian",
            permissions: expect.arrayContaining([
              "profile.read",
              "profile_members.read",
            ]),
          },
          profile: {
            id: managed.profileId,
            profileType: "managed",
          },
        },
      },
    });
  });

  it("does not implicitly resolve another profile through MCP", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);

    const body = await callMcpTool(
      app,
      "get_profile",
      {
        profileId: "profile_self_user_bob",
      },
      sessionId,
    );

    expect(body).toMatchObject({
      result: {
        isError: true,
        structuredContent: {
          error: "PROFILE_NOT_ACCESSIBLE",
        },
      },
    });
  });

  it("enforces profile permissions for MCP tools and returns stable denials", async () => {
    const profiles = createInMemoryProfileService({
      initialProfiles: [
        {
          profile: {
            id: "profile_shared",
            displayName: "Shared profile",
            ownerUserId: "user_owner",
            profileType: "managed",
            timezone: "UTC",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
          access: {
            id: "access_shared",
            userId: "user_alex",
            profileId: "profile_shared",
            relationship: "coach",
            roleIdentifier: "coach",
            status: "active",
            accessVersion: 1,
            permissionOverrides: [],
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
        },
      ],
    });
    const app = createMcpTestApp({ profiles });
    const sessionId = await initializeMcpSession(app);

    const allowed = await callMcpTool(
      app,
      "get_health_summary",
      { profileId: "profile_shared", date: "2026-07-15" },
      sessionId,
    );
    const capabilities = await callMcpTool(
      app,
      "get_mcp_capabilities",
      { profileId: "profile_shared" },
      sessionId,
    );
    const denied = await callMcpTool(
      app,
      "get_metric_timeseries",
      {
        profileId: "profile_shared",
        metric: "steps",
        date: "2026-07-15",
      },
      sessionId,
    );

    expect(allowed.result).not.toMatchObject({ isError: true });
    expect(capabilities).toMatchObject({
      result: {
        structuredContent: {
          profileId: "profile_shared",
          relationship: "coach",
          roleIdentifier: "coach",
          effectivePermissions: expect.arrayContaining([
            "health.summary.read",
            "meal.plan.write",
          ]),
          availableTools: expect.arrayContaining([
            "get_health_summary",
            "get_meal_log",
          ]),
        },
      },
    });
    const availableTools = (
      capabilities as {
        result: { structuredContent: { availableTools: readonly string[] } };
      }
    ).result.structuredContent.availableTools;
    expect(availableTools).not.toContain("get_metric_timeseries");
    expect(denied).toMatchObject({
      result: {
        isError: true,
        structuredContent: {
          error: "PERMISSION_DENIED",
          requiredPermission: "health.detailed.read",
          requestedAction: "get_metric_timeseries",
        },
      },
    });
  });

  it("uses explicit profile ids for existing MCP health reads", async () => {
    const profiles = createInMemoryProfileService();
    const managed = await profiles.createManagedProfile("user_alex", {
      displayName: "Dependent",
      timezone: "Asia/Jerusalem",
    });
    const app = createMcpTestApp({
      healthRead: createInMemoryHealthReadService([
        {
          userId: "user_alex",
          profileId: managed.profileId,
          metricName: "weight",
          unit: "kg",
          value: 32.4,
          startTime: "2026-06-10T06:00:00.000Z",
          endTime: "2026-06-10T06:00:00.000Z",
          timezone: "Asia/Jerusalem",
          source: "managed-scale",
          sourceSampleId: "managed-weight-2026-06-10",
        },
      ]),
      profiles,
    });
    const sessionId = await initializeMcpSession(app);

    const self = await callMcpTool(
      app,
      "get_health_summary",
      {
        range: {
          from: "2026-06-10T00:00:00.000Z",
          to: "2026-06-11T00:00:00.000Z",
        },
      },
      sessionId,
    );
    const managedSummary = await callMcpTool(
      app,
      "get_health_summary",
      {
        profileId: managed.profileId,
        range: {
          from: "2026-06-10T00:00:00.000Z",
          to: "2026-06-11T00:00:00.000Z",
        },
      },
      sessionId,
    );

    expect(self).toMatchObject({
      result: {
        structuredContent: {
          summary: {
            sampleCount: 0,
          },
        },
      },
    });
    expect(managedSummary).toMatchObject({
      result: {
        structuredContent: {
          summary: {
            sampleCount: 1,
            metrics: {
              weight: {
                latest: {
                  value: 32.4,
                },
              },
            },
          },
        },
      },
    });
  });

  it("returns a scoped health summary for the authenticated user", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);

    const body = await callMcpTool(
      app,
      "get_health_summary",
      {
        range: {
          from: "2026-06-10T00:00:00.000Z",
          to: "2026-06-11T00:00:00.000Z",
        },
      },
      sessionId,
    );

    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      result: {
        structuredContent: {
          summary: {
            range: {
              from: "2026-06-10T00:00:00.000Z",
              to: "2026-06-11T00:00:00.000Z",
            },
            sampleCount: 7,
            metrics: {
              weight: {
                unit: "kg",
                count: 1,
                latest: {
                  value: 87.55,
                  at: "2026-06-10T06:00:00.000Z",
                },
              },
              steps: {
                unit: "count",
                count: 1,
                coveredDays: 1,
                firstDate: "2026-06-10",
                lastDate: "2026-06-10",
                total: 11_800,
                latest: {
                  localDate: "2026-06-10",
                },
              },
              resting_energy: {
                unit: "kcal",
                total: 2_185,
              },
              sleep: {
                unit: "minute",
                total: 450,
              },
              resting_heart_rate: {
                unit: "bpm",
                average: 66,
              },
            },
          },
        },
      },
    });
    expect(body).toMatchObject({
      result: {
        content: [
          {
            text: expect.stringContaining(
              "steps | 1d | avg 11,800 count | total 11,800 count | latest 11,800 count on 2026-06-10",
            ),
          },
        ],
      },
    });
    expect(body).toMatchObject({
      result: {
        content: [
          {
            text: expect.stringContaining(
              "Metric rows use each sample's local HealthKit timezone for day labels.",
            ),
          },
        ],
      },
    });
    expect(JSON.stringify(body)).not.toContain("other_user");
    expect(JSON.stringify(body)).not.toContain("120");
  });

  it("returns daily metric timeseries points for the authenticated user", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);

    const body = await callMcpTool(
      app,
      "get_metric_timeseries",
      {
        metric: "steps",
        granularity: "day",
        range: {
          from: "2026-06-10T00:00:00.000Z",
          to: "2026-06-11T00:00:00.000Z",
        },
      },
      sessionId,
    );

    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      result: {
        structuredContent: {
          timeseries: {
            metric: "steps",
            unit: "count",
            granularity: "day",
            points: [
              {
                date: "2026-06-10",
                value: 11_800,
                sampleCount: 1,
                aggregation: "sum",
              },
            ],
          },
        },
      },
    });
  });

  it("groups daily timeseries by the sample timezone date", () => {
    const timeseries = buildMetricTimeseries({
      metric: "steps",
      granularity: "day",
      range: {
        from: "2026-06-09T21:00:00.000Z",
        to: "2026-06-10T21:00:00.000Z",
      },
      samples: [
        {
          userId: "user_alex",
          metricName: "steps",
          unit: "count",
          value: 12_345,
          startTime: "2026-06-09T21:00:00.000Z",
          endTime: "2026-06-10T21:00:00.000Z",
          timezone: "Asia/Jerusalem",
          source: "apple_health_daily",
          sourceSampleId: "apple-health-daily:steps:2026-06-10:Asia_Jerusalem",
        },
      ],
    });

    expect(timeseries.points).toEqual([
      {
        date: "2026-06-10",
        value: 12_345,
        sampleCount: 1,
        aggregation: "sum",
      },
    ]);
  });

  it("returns a scoped deterministic coach report for ChatGPT", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);

    const body = await callMcpTool(
      app,
      "generate_report",
      {
        style: "daily",
        range: {
          from: "2026-06-10T00:00:00.000Z",
          to: "2026-06-11T00:00:00.000Z",
        },
      },
      sessionId,
    );

    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      result: {
        structuredContent: {
          report: {
            metrics: {
              latestWeightKg: 87.55,
              totalSteps: 11_800,
              totalEnergyKcal: 3_085,
            },
            guidance: expect.arrayContaining([
              "No historical step target is available for this range; activity is shown without an adherence judgment.",
            ]),
          },
        },
      },
    });
    expect(JSON.stringify(body)).toContain("not a medical diagnosis");
    expect(JSON.stringify(body)).not.toContain("other_user");
  });

  it("returns scoped meal logs and macro totals for ChatGPT", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);

    const body = await callMcpTool(
      app,
      "get_meal_log",
      {
        range: {
          from: "2026-06-10T00:00:00.000Z",
          to: "2026-06-11T00:00:00.000Z",
        },
      },
      sessionId,
    );

    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      result: {
        structuredContent: {
          mealLog: {
            mealCount: 1,
            totals: {
              calories: 410,
              proteinGrams: 24,
            },
            meals: [
              {
                title: "Eggs and toast",
                mealType: "Breakfast",
              },
            ],
          },
        },
        content: [
          {
            text: expect.stringContaining("Totals: 410 kcal, 24g protein"),
          },
        ],
      },
    });
    expect(JSON.stringify(body)).not.toContain("Other user meal");
    expect(JSON.stringify(body)).not.toContain("999");
  });

  it("reads meal logs by local date shortcuts for ChatGPT", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);

    const body = await callMcpTool(
      app,
      "get_meal_log",
      {
        date: "2026-06-10",
        timezone: "Asia/Jerusalem",
      },
      sessionId,
    );

    expect(body).toMatchObject({
      result: {
        structuredContent: {
          mealLog: {
            mealCount: 1,
            meals: [
              {
                title: "Eggs and toast",
              },
            ],
          },
        },
      },
    });
  });

  it("upserts a previous local food day after midnight without shifting to today", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);

    await callMcpTool(
      app,
      "upsert_meal_log",
      {
        clientMealId: "mcp-previous-food-day",
        localFoodDate: "2026-06-25",
        localTime: "23:30",
        timezone: "Asia/Jerusalem",
        title: "Late correction",
        mealType: "Meal",
        totals: {
          calories: 250,
          proteinGrams: 30,
          carbsGrams: 5,
          fatGrams: 9,
          fiberGrams: 1,
        },
        ingredients: [
          {
            name: "Protein yogurt",
            quantity: 1,
            unit: "cup",
            totals: {
              calories: 250,
              proteinGrams: 30,
              carbsGrams: 5,
              fatGrams: 9,
              fiberGrams: 1,
            },
          },
        ],
      },
      sessionId,
    );

    const previousDay = await callMcpTool(
      app,
      "get_meal_log",
      {
        date: "2026-06-25",
        timezone: "Asia/Jerusalem",
      },
      sessionId,
    );
    const nextDay = await callMcpTool(
      app,
      "get_meal_log",
      {
        date: "2026-06-26",
        timezone: "Asia/Jerusalem",
      },
      sessionId,
    );

    expect(previousDay).toMatchObject({
      result: {
        structuredContent: {
          mealLog: {
            localDate: "2026-06-25",
            timezone: "Asia/Jerusalem",
            utcRange: {
              from: "2026-06-24T21:00:00.000Z",
              to: "2026-06-25T21:00:00.000Z",
            },
            meals: expect.arrayContaining([
              expect.objectContaining({
                title: "Late correction",
              }),
            ]),
          },
        },
        content: [
          {
            text: expect.stringContaining(
              "Local food day: 2026-06-25 (Asia/Jerusalem)",
            ),
          },
        ],
      },
    });
    expect(JSON.stringify(nextDay)).not.toContain("Late correction");
  });

  it("exposes reusable food database entries from previous ingredients", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);

    const body = await callMcpTool(
      app,
      "get_food_database",
      {
        range: {
          from: "2026-06-10T00:00:00.000Z",
          to: "2026-06-11T00:00:00.000Z",
        },
        query: "egg",
      },
      sessionId,
    );

    expect(body).toMatchObject({
      result: {
        structuredContent: {
          foodDatabase: {
            itemCount: 1,
            items: [
              {
                name: "Eggs",
                defaultQuantity: 2,
                defaultUnit: "eggs",
                usageCount: 1,
                defaultTotals: {
                  calories: 150,
                  proteinGrams: 12,
                },
                sources: ["meal_log"],
              },
            ],
          },
        },
        content: [
          {
            text: expect.stringContaining("Eggs | 1 uses"),
          },
        ],
      },
    });
    expect(JSON.stringify(body)).not.toContain("other_user");
  });

  it("aggregates logged foods for pattern questions", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);

    const body = await callMcpTool(
      app,
      "get_food_aggregations",
      {
        range: {
          from: "2026-06-10T00:00:00.000Z",
          to: "2026-06-11T00:00:00.000Z",
        },
        groupBy: "food",
        sortBy: "protein",
      },
      sessionId,
    );

    expect(body).toMatchObject({
      result: {
        structuredContent: {
          foodAggregations: {
            groupBy: "food",
            sortBy: "protein",
            groupCount: 1,
            groups: [
              {
                label: "Eggs",
                usageCount: 1,
                totals: {
                  proteinGrams: 12,
                },
              },
            ],
          },
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain("Other user meal");
  });

  it("upserts a scoped meal log through MCP meal-write access", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);

    const body = await callMcpTool(
      app,
      "upsert_meal_log",
      {
        clientMealId: "mcp-meal-1",
        occurredAt: "2026-06-10T12:00:00.000Z",
        timezone: "Asia/Jerusalem",
        title: "Rice and chicken",
        mealType: "Lunch",
        totals: {
          calories: 620,
          proteinGrams: 48,
          carbsGrams: 70,
          fatGrams: 12,
          fiberGrams: 5,
        },
        ingredients: [
          {
            name: "Chicken breast",
            quantity: 150,
            unit: "g",
            grams: 150,
            totals: {
              calories: 248,
              proteinGrams: 46,
              carbsGrams: 0,
              fatGrams: 5,
              fiberGrams: 0,
            },
          },
        ],
      },
      sessionId,
    );

    expect(body).toMatchObject({
      result: {
        structuredContent: {
          meal: {
            title: "Rice and chicken",
            origin: "mcp",
            totals: {
              calories: 620,
              proteinGrams: 48,
            },
          },
        },
        content: [
          {
            text: expect.stringContaining("Saved meal"),
          },
        ],
      },
    });

    const mealLog = await callMcpTool(
      app,
      "get_meal_log",
      {
        range: {
          from: "2026-06-10T00:00:00.000Z",
          to: "2026-06-11T00:00:00.000Z",
        },
      },
      sessionId,
    );

    expect(mealLog).toMatchObject({
      result: {
        structuredContent: {
          mealLog: {
            mealCount: 2,
            totals: {
              calories: 1_030,
              proteinGrams: 72,
            },
          },
        },
      },
    });
  });

  it("logs one simple food with direct meal upsert and creates a rollback snapshot", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);

    await callMcpTool(
      app,
      "upsert_meal_log",
      {
        clientMealId: "milk-only",
        localFoodDate: "2026-06-25",
        localTime: "09:00",
        timezone: "Asia/Jerusalem",
        title: "Cup of milk",
        mealType: "Meal",
        totals: {
          calories: 120,
          proteinGrams: 8,
          carbsGrams: 12,
          fatGrams: 5,
          fiberGrams: 0,
        },
        ingredients: [
          {
            name: "Milk",
            quantity: 1,
            unit: "cup",
            totals: {
              calories: 120,
              proteinGrams: 8,
              carbsGrams: 12,
              fatGrams: 5,
              fiberGrams: 0,
            },
          },
        ],
      },
      sessionId,
    );

    const mealLog = await callMcpTool(
      app,
      "get_meal_log",
      {
        date: "2026-06-25",
        timezone: "Asia/Jerusalem",
      },
      sessionId,
    );

    expect(mealLog).toMatchObject({
      result: {
        structuredContent: {
          mealLog: {
            localDate: "2026-06-25",
            timezone: "Asia/Jerusalem",
            mealCount: 1,
            meals: [
              {
                title: "Cup of milk",
              },
            ],
          },
        },
      },
    });

    const snapshots = await callMcpTool(
      app,
      "list_meal_log_snapshots",
      {
        date: "2026-06-25",
        timezone: "Asia/Jerusalem",
      },
      sessionId,
    );

    expect(snapshots).toMatchObject({
      result: {
        structuredContent: {
          snapshots: [
            expect.objectContaining({
              affectedLocalDate: "2026-06-25",
              operationType: "upsert_create",
            }),
          ],
        },
      },
    });
  });

  it("requires explicit confirmation before deleting a meal through MCP", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);

    const unconfirmed = await callMcpTool(
      app,
      "delete_meal_log",
      {
        mealId: "meal-1",
        confirmDelete: false,
      },
      sessionId,
    );

    expect(unconfirmed).toMatchObject({
      result: {
        structuredContent: {
          result: {
            deleted: false,
            error: "confirmation-required",
            mealId: "meal-1",
          },
        },
      },
    });

    const confirmed = await callMcpTool(
      app,
      "delete_meal_log",
      {
        mealId: "meal-1",
        confirmDelete: true,
      },
      sessionId,
    );

    expect(confirmed).toMatchObject({
      result: {
        structuredContent: {
          result: {
            deleted: true,
            mealId: "meal-1",
          },
        },
      },
    });

    const mealLog = await callMcpTool(
      app,
      "get_meal_log",
      {
        range: {
          from: "2026-06-10T00:00:00.000Z",
          to: "2026-06-11T00:00:00.000Z",
        },
      },
      sessionId,
    );

    expect(mealLog).toMatchObject({
      result: {
        structuredContent: {
          mealLog: {
            mealCount: 0,
          },
        },
      },
    });
  });

  it("rolls back an MCP meal replacement from a snapshot", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);

    await callMcpTool(
      app,
      "delete_meal_log",
      {
        mealId: "meal-1",
        confirmDelete: true,
      },
      sessionId,
    );
    await callMcpTool(
      app,
      "upsert_meal_log",
      {
        clientMealId: "danone-veg",
        localFoodDate: "2026-06-10",
        localTime: "12:00",
        timezone: "Asia/Jerusalem",
        title: "Danone yogurt and vegetables",
        mealType: "Lunch",
        totals: {
          calories: 180,
          proteinGrams: 20,
          carbsGrams: 10,
          fatGrams: 5,
          fiberGrams: 3,
        },
        ingredients: [],
      },
      sessionId,
    );

    const snapshots = await callMcpTool(
      app,
      "list_meal_log_snapshots",
      {
        date: "2026-06-10",
        timezone: "Asia/Jerusalem",
      },
      sessionId,
    );
    const snapshotBody = snapshots as {
      result: {
        structuredContent: {
          snapshots: readonly {
            snapshotId: string;
            operationType: string;
          }[];
        };
      };
    };
    const snapshotId = snapshotBody.result.structuredContent.snapshots.find(
      (snapshot) => snapshot.operationType === "delete",
    )?.snapshotId;

    expect(snapshotId).toBeDefined();

    const rollback = await callMcpTool(
      app,
      "rollback_meal_log_snapshot",
      {
        snapshotId,
        confirmRollback: true,
      },
      sessionId,
    );

    expect(rollback).toMatchObject({
      result: {
        structuredContent: {
          result: {
            rolledBack: true,
            mealLog: {
              meals: expect.arrayContaining([
                expect.objectContaining({
                  title: "Eggs and toast",
                }),
              ]),
            },
          },
        },
      },
    });

    const mealLog = await callMcpTool(
      app,
      "get_meal_log",
      {
        date: "2026-06-10",
        timezone: "Asia/Jerusalem",
      },
      sessionId,
    );

    expect(JSON.stringify(mealLog)).toContain("Eggs and toast");
  });

  it("previews recommendations and confirms target-plan activation", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);
    const recommended = await callMcpTool(
      app,
      "calculate_recommended_targets",
      {
        goal: "lose_weight",
        currentWeightKg: 80,
        averageSteps: 8_000,
      },
      sessionId,
    );

    expect(recommended).toMatchObject({
      result: {
        structuredContent: {
          result: { activated: false },
        },
      },
    });

    const draft = await callMcpTool(
      app,
      "create_target_plan_draft",
      {
        goal: "lose_weight",
        calculationMode: "manual",
        reason: "Test target plan",
        targets: {
          maintenanceCalories: 2_400,
          selectedCalories: 2_000,
          proteinGrams: 150,
          carbohydratesGrams: 200,
          fatGrams: 65,
          fiberGrams: 30,
          steps: 10_000,
        },
      },
      sessionId,
    );
    const planId = (
      draft as {
        result: { structuredContent: { result: { plan: { id: string } } } };
      }
    ).result.structuredContent.result.plan.id;
    const preview = await callMcpTool(
      app,
      "activate_target_plan",
      { planId, effectiveFrom: "2026-07-15" },
      sessionId,
    );
    expect(preview).toMatchObject({
      result: {
        structuredContent: {
          result: { confirmationRequired: true },
        },
      },
    });

    const activated = await callMcpTool(
      app,
      "activate_target_plan",
      { planId, effectiveFrom: "2026-07-15", confirmActivation: true },
      sessionId,
    );
    expect(activated).toMatchObject({
      result: {
        structuredContent: {
          result: { plan: { status: "active", version: 1 } },
        },
      },
    });
  });

  it("upserts and reads a scoped coach profile through MCP", async () => {
    const app = createMcpTestApp();
    const sessionId = await initializeMcpSession(app);

    const upserted = await callMcpTool(
      app,
      "upsert_coach_profile",
      {
        goal: "lose_weight",
        weightKg: 87.5,
        estimatedStepsPerDay: 11_500,
        wakeTimeMinutes: 450,
        sleepTimeMinutes: 1_410,
        mealSlots: [
          {
            id: "breakfast",
            name: "Breakfast",
            timeMinutes: 540,
            remindersEnabled: true,
          },
          {
            id: "lunch",
            name: "Lunch",
            timeMinutes: 780,
            remindersEnabled: true,
          },
          {
            id: "dinner",
            name: "Dinner",
            timeMinutes: 1_200,
            remindersEnabled: true,
          },
        ],
      },
      sessionId,
    );

    expect(upserted).toMatchObject({
      result: {
        structuredContent: {
          profile: {
            goal: "lose_weight",
            source: "mcp",
            targets: {
              selectedCalories: 1900,
              proteinGrams: 160,
            },
          },
        },
      },
    });

    const profile = await callMcpTool(app, "get_coach_profile", {}, sessionId);

    expect(profile).toMatchObject({
      result: {
        structuredContent: {
          profile: {
            goal: "lose_weight",
            targets: {
              selectedCalories: 1900,
            },
          },
        },
        content: [
          {
            text: expect.stringContaining("Targets: 1,900 kcal"),
          },
        ],
      },
    });
  });
});
