import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FAKE_AUTH_TOKEN_PREFIX,
  buildFitnessJwks,
  createFakeAuthToken,
  generateFitnessJwtKeyPair,
  signFitnessJwt,
  type FitnessTokenClaims,
  type FitnessJwks,
} from "@fitness/auth";
import { createApp } from "./app.js";
import { resolveServerAuthConfig } from "./auth.js";
import { createAuditService, type AuditService } from "./services/audit.js";
import {
  createHealthSyncService,
  type HealthSyncService,
} from "./services/health-sync.js";
import type {
  MealEstimateInput,
  MealEstimateResult,
  MealNutritionEstimator,
} from "./services/meal-estimate.js";

const nowSeconds = 1_800_000_000;
const nowIso = "2027-01-15T08:00:00.000Z";

type AuditMutationMethod = Extract<
  keyof AuditService,
  "delete" | "remove" | "update"
>;

const auditHasNoMutationMethods: AuditMutationMethod extends never
  ? true
  : false = true;

function validClaims(
  overrides: Partial<FitnessTokenClaims> = {},
): FitnessTokenClaims {
  return {
    iss: "https://auth.fitness.local",
    aud: "fitness-api",
    resource: "https://api.fitness.local",
    sub: "user_alex",
    exp: nowSeconds + 300,
    iat: nowSeconds - 30,
    scope: "health:write",
    jti: "token-1",
    ...overrides,
  };
}

function bearer(claims: FitnessTokenClaims): string {
  return `Bearer ${createFakeAuthToken(claims)}`;
}

function malformedJwksToken(): string {
  return `Bearer ${FAKE_AUTH_TOKEN_PREFIX}${encodeURIComponent(
    JSON.stringify({ keys: [] }),
  )}`;
}

function validPayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    userId: "user_alex",
    idempotencyKey: "healthkit-batch-1",
    samples: [
      {
        metricName: "weight",
        unit: "kg",
        value: 87.4,
        startTime: "2026-06-11T06:00:00.000Z",
        endTime: "2026-06-11T06:00:00.000Z",
        timezone: "Asia/Jerusalem",
        source: "apple_health_daily",
        sourceSampleId: "apple-health-daily:weight:2026-06-11:Asia_Jerusalem",
      },
    ],
    ...overrides,
  };
}

function validSample(overrides: Record<string, unknown> = {}) {
  return {
    ...(
      validPayload() as {
        samples: [Record<string, unknown>];
      }
    ).samples[0],
    ...overrides,
  };
}

function validDeletedSample(overrides: Record<string, unknown> = {}) {
  return {
    metricName: "weight",
    source: "apple_health_daily",
    sourceSampleId: "apple-health-daily:weight:2026-06-11:Asia_Jerusalem",
    ...overrides,
  };
}

function appWithServices(
  options: {
    revokedTokenIds?: readonly string[] | undefined;
    trustedJwks?: FitnessJwks | undefined;
    mealEstimator?: MealNutritionEstimator | undefined;
  } = {},
) {
  const audit = createAuditService({
    now: () => new Date(nowIso),
  });
  const healthSync = createHealthSyncService();
  const app = createApp({
    auth: {
      now: nowSeconds,
      revokedTokenIds: options.revokedTokenIds,
      trustedJwks: options.trustedJwks,
    },
    services: {
      audit,
      healthSync,
      ...(options.mealEstimator === undefined
        ? {}
        : { mealEstimator: options.mealEstimator }),
    },
  });

  return { app, audit, healthSync };
}

function createFakeMealEstimator(
  result: MealEstimateResult = {
    totals: {
      calories: 240,
      proteinGrams: 22,
      carbsGrams: 11,
      fatGrams: 12.5,
      fiberGrams: 0,
    },
    ingredients: [],
    confidence: 0.82,
    summary: "Estimated from the meal description.",
    provider: "openrouter",
    model: "test-model",
  },
): MealNutritionEstimator & { calls: MealEstimateInput[] } {
  const calls: MealEstimateInput[] = [];

  return {
    calls,
    async estimate(input) {
      calls.push(input);
      return result;
    },
  };
}

async function postSamples(
  app: ReturnType<typeof createApp>,
  options: {
    authorization?: string;
    headers?: Record<string, string>;
    payload?: unknown;
  } = {},
): Promise<Response> {
  return app.request("/api/health/samples", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.authorization === undefined
        ? {}
        : { authorization: options.authorization }),
      ...options.headers,
    },
    body: JSON.stringify(options.payload ?? validPayload()),
  });
}

async function postMealEstimate(
  app: ReturnType<typeof createApp>,
  options: {
    authorization?: string;
    payload?: unknown;
  } = {},
): Promise<Response> {
  return app.request("/api/meals/estimate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.authorization === undefined
        ? {}
        : { authorization: options.authorization }),
    },
    body: JSON.stringify(
      options.payload ?? {
        mealType: "Breakfast",
        description: "גבינה לבנה 250ג 5 אחוז",
        note: "",
        photos: [],
      },
    ),
  });
}

function validMealLogPayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    clientMealId: "11111111-1111-4111-8111-111111111111",
    occurredAt: "2026-06-22T07:30:00.000Z",
    timezone: "Asia/Jerusalem",
    title: "גבינה לבנה וטוסט",
    mealType: "Breakfast",
    note: "גבינה לבנה 250ג 5 אחוז וטוסט",
    totals: {
      calories: 430,
      proteinGrams: 32,
      carbsGrams: 42,
      fatGrams: 13,
      fiberGrams: 4,
    },
    ingredients: [
      {
        clientIngredientId: "ingredient-1",
        name: "White cheese 5%",
        quantity: 250,
        unit: "g",
        grams: 250,
        totals: {
          calories: 242,
          proteinGrams: 24,
          carbsGrams: 9,
          fatGrams: 12,
          fiberGrams: 0,
        },
      },
    ],
    photoCount: 1,
    estimateStatus: "ai_estimated",
    estimateConfidence: 0.82,
    estimateSummary: "Estimated from text.",
    ...overrides,
  };
}

async function postMealLog(
  app: ReturnType<typeof createApp>,
  options: {
    authorization?: string;
    payload?: unknown;
  } = {},
): Promise<Response> {
  return app.request("/api/meals/logs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.authorization === undefined
        ? {}
        : { authorization: options.authorization }),
    },
    body: JSON.stringify(options.payload ?? validMealLogPayload()),
  });
}

async function getMealLogs(
  app: ReturnType<typeof createApp>,
  options: {
    authorization?: string;
    query?: string;
  } = {},
): Promise<Response> {
  return app.request(`/api/meals/logs${options.query ?? ""}`, {
    method: "GET",
    headers: {
      ...(options.authorization === undefined
        ? {}
        : { authorization: options.authorization }),
    },
  });
}

async function deleteMealLog(
  app: ReturnType<typeof createApp>,
  id: string,
  authorization: string,
): Promise<Response> {
  return app.request(`/api/meals/logs/${id}`, {
    method: "DELETE",
    headers: {
      authorization,
    },
  });
}

function validCoachProfilePayload(
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    goal: "lose_weight",
    weightKg: 87.5,
    estimatedStepsPerDay: 11_500,
    wakeTimeMinutes: 450,
    sleepTimeMinutes: 1_410,
    mealRemindersEnabled: true,
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
    completedAt: "2026-06-22T09:00:00.000Z",
    source: "ios",
    ...overrides,
  };
}

async function putCoachProfile(
  app: ReturnType<typeof createApp>,
  options: {
    authorization?: string;
    payload?: unknown;
  } = {},
): Promise<Response> {
  return app.request("/api/coach/profile", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(options.authorization === undefined
        ? {}
        : { authorization: options.authorization }),
    },
    body: JSON.stringify(options.payload ?? validCoachProfilePayload()),
  });
}

async function getCoachProfile(
  app: ReturnType<typeof createApp>,
  authorization?: string,
): Promise<Response> {
  return app.request("/api/coach/profile", {
    method: "GET",
    headers: {
      ...(authorization === undefined ? {} : { authorization }),
    },
  });
}

async function getProfiles(
  app: ReturnType<typeof createApp>,
  authorization?: string,
): Promise<Response> {
  return app.request("/api/profiles", {
    method: "GET",
    headers: {
      ...(authorization === undefined ? {} : { authorization }),
    },
  });
}

async function getProfile(
  app: ReturnType<typeof createApp>,
  profileId: string,
  authorization?: string,
): Promise<Response> {
  return app.request(`/api/profiles/${profileId}`, {
    method: "GET",
    headers: {
      ...(authorization === undefined ? {} : { authorization }),
    },
  });
}

async function getProfileAccess(
  app: ReturnType<typeof createApp>,
  profileId: string,
  authorization?: string,
): Promise<Response> {
  return app.request(`/api/profiles/${profileId}/access`, {
    method: "GET",
    headers: {
      ...(authorization === undefined ? {} : { authorization }),
    },
  });
}

async function postManagedProfile(
  app: ReturnType<typeof createApp>,
  options: {
    authorization?: string;
    payload?: unknown;
  } = {},
): Promise<Response> {
  return app.request("/api/profiles/managed", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.authorization === undefined
        ? {}
        : { authorization: options.authorization }),
    },
    body: JSON.stringify(
      options.payload ?? {
        displayName: "Family member",
        timezone: "Asia/Jerusalem",
        relationship: "guardian",
        roleIdentifier: "owner",
      },
    ),
  });
}

function validEatingCheckInPayload(
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    occurredAt: "2027-01-15T14:45:00.000Z",
    timezone: "Asia/Jerusalem",
    idempotencyKey: "checkin-lunch-1",
    hungerBefore: 7,
    fullnessAfter: 6,
    urgeIntensity: 4,
    emotionIntensity: 5,
    emotions: ["stressed"],
    triggers: ["work stress"],
    eatingContext: "stress",
    ateWithScreen: true,
    tookSecondServing: false,
    copingAction: "ate planned snack",
    urgeDelayMinutes: 10,
    outcome: "helped",
    note: "brief app note",
    ...overrides,
  };
}

async function postEatingCheckIn(
  app: ReturnType<typeof createApp>,
  options: {
    authorization?: string;
    payload?: unknown;
  } = {},
): Promise<Response> {
  return app.request("/api/eating-checkins", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.authorization === undefined
        ? {}
        : { authorization: options.authorization }),
    },
    body: JSON.stringify(options.payload ?? validEatingCheckInPayload()),
  });
}

describe("service health endpoints", () => {
  it("returns an unauthenticated health response", async () => {
    const app = createApp();

    const response = await app.request("/healthz");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "fitness-server",
      status: "ok",
    });
  });

  it("returns an unauthenticated readiness response for platform probes", async () => {
    const app = createApp();

    const response = await app.request("/readyz");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      checks: {
        http: "ok",
      },
      service: "fitness-server",
      status: "ready",
    });
  });
});

describe("eating check-in API", () => {
  const writeAuthorization = bearer(validClaims({ scope: "coach:write" }));
  const readAuthorization = bearer(validClaims({ scope: "coach:read" }));

  it("creates, replays, lists, and summarizes lightweight CBT check-ins", async () => {
    const { app, audit } = appWithServices();

    const created = await postEatingCheckIn(app, {
      authorization: writeAuthorization,
    });
    const createdBody = (await created.json()) as {
      checkIn: {
        id: string;
        profileId: string;
        hungerBefore: number;
        urgeIntensity: number;
        eatingContext: string;
      };
      operation: string;
    };
    const replay = await postEatingCheckIn(app, {
      authorization: writeAuthorization,
    });
    const latest = await app.request("/api/eating-checkins/latest", {
      headers: { authorization: readAuthorization },
    });
    const list = await app.request(
      "/api/eating-checkins?from=2027-01-15T00%3A00%3A00.000Z&to=2027-01-16T00%3A00%3A00.000Z",
      { headers: { authorization: readAuthorization } },
    );
    const report = await app.request(
      "/api/eating-checkins/weekly-report?from=2027-01-09T00%3A00%3A00.000Z&to=2027-01-16T00%3A00%3A00.000Z",
      { headers: { authorization: readAuthorization } },
    );

    expect(created.status).toBe(200);
    expect(createdBody).toMatchObject({
      operation: "created",
      checkIn: {
        profileId: "profile_self_user_alex",
        hungerBefore: 7,
        urgeIntensity: 4,
        eatingContext: "stress",
      },
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      operation: "unchanged",
      checkIn: { id: createdBody.checkIn.id },
    });
    expect(latest.status).toBe(200);
    await expect(latest.json()).resolves.toMatchObject({
      checkIn: { id: createdBody.checkIn.id },
    });
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      checkIns: [{ id: createdBody.checkIn.id }],
    });
    expect(report.status).toBe(200);
    await expect(report.json()).resolves.toMatchObject({
      report: {
        metrics: {
          checkIns: 1,
          eatingWithScreens: 1,
          urgesDelayedSuccessfully: 1,
        },
        safetyNote: expect.stringContaining("not a medical diagnosis"),
      },
    });
    expect(JSON.stringify(audit.list())).not.toContain("brief app note");
  });

  it("updates and links a check-in to an actual and planned meal", async () => {
    const { app } = appWithServices();
    const created = (await (
      await postEatingCheckIn(app, { authorization: writeAuthorization })
    ).json()) as { checkIn: { id: string } };

    const updated = await app.request(
      `/api/eating-checkins/${created.checkIn.id}`,
      {
        method: "PATCH",
        headers: {
          authorization: writeAuthorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          fullnessAfter: 8,
          emotions: ["calm"],
          automaticThought: "I need to finish everything",
          balancedResponse: "I can stop when full",
        }),
      },
    );
    const linked = await app.request(
      `/api/eating-checkins/${created.checkIn.id}/link`,
      {
        method: "POST",
        headers: {
          authorization: writeAuthorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          linkedMealId: "actual-meal-1",
          linkedPlannedMealId: "planned-meal-1",
        }),
      },
    );

    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      checkIn: {
        fullnessAfter: 8,
        emotions: ["calm"],
        balancedResponse: "I can stop when full",
      },
    });
    expect(linked.status).toBe(200);
    await expect(linked.json()).resolves.toMatchObject({
      checkIn: {
        linkedMealId: "actual-meal-1",
        linkedPlannedMealId: "planned-meal-1",
      },
    });
  });

  it("requires coach write scope and validates app scale values", async () => {
    const { app } = appWithServices();

    const readOnly = await postEatingCheckIn(app, {
      authorization: readAuthorization,
    });
    const invalidScale = await postEatingCheckIn(app, {
      authorization: writeAuthorization,
      payload: validEatingCheckInPayload({ hungerBefore: 11 }),
    });

    expect(readOnly.status).toBe(403);
    await expect(readOnly.json()).resolves.toMatchObject({
      error: "missing-scope",
    });
    expect(invalidScale.status).toBe(400);
    await expect(invalidScale.json()).resolves.toMatchObject({
      error: "invalid-payload",
      message: "hungerBefore must be an integer from 0 to 10.",
    });
  });
});

describe("daily meal plan API", () => {
  const authorization = bearer(validClaims({ scope: "meal:write" }));

  function planPayload(overrides: Record<string, unknown> = {}) {
    return {
      localFoodDate: "2027-01-15",
      timezone: "Asia/Jerusalem",
      status: "active",
      title: "Friday plan",
      idempotencyKey: "plan-friday-1",
      meals: [
        {
          mealType: "Breakfast",
          plannedTime: "09:00",
          title: "Yogurt bowl",
          ingredients: [
            {
              displayName: "Yogurt",
              quantity: 200,
              unit: "g",
              grams: 200,
              totals: {
                calories: 180,
                proteinGrams: 20,
                carbsGrams: 16,
                fatGrams: 4,
                fiberGrams: 0,
              },
            },
          ],
        },
      ],
      ...overrides,
    };
  }

  async function writePlan(
    app: ReturnType<typeof createApp>,
    payload: unknown = planPayload(),
  ) {
    return app.request("/api/meals/plans", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  it("creates profile-owned plans without changing actual meal logs", async () => {
    const { app } = appWithServices();
    const created = await writePlan(app);
    expect(created.status).toBe(200);
    const body = (await created.json()) as {
      plan: { profileId: string; version: number };
      plannedTotals: { calories: number; proteinGrams: number };
    };
    expect(body.plan.profileId).toBe("profile_self_user_alex");
    expect(body.plan.version).toBe(1);
    expect(body.plannedTotals).toMatchObject({
      calories: 180,
      proteinGrams: 20,
    });

    const logs = await getMealLogs(app, {
      authorization,
      query: "?date=2027-01-15&timezone=Asia%2FJerusalem",
    });
    expect(logs.status).toBe(200);
    expect(await logs.json()).toEqual({ meals: [] });
  });

  it("marks a planned meal skipped without creating a zero-calorie log", async () => {
    const { app } = appWithServices();
    const created = (await (await writePlan(app)).json()) as {
      plan: { version: number; meals: Array<{ id: string; version: number }> };
    };
    const meal = created.plan.meals[0];
    expect(meal).toBeDefined();

    const status = await app.request(`/api/meals/planned/${meal!.id}/status`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({
        status: "skipped",
        expectedPlanVersion: created.plan.version,
        expectedMealVersion: meal!.version,
      }),
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      plannedMeal: { status: "skipped" },
    });

    const logs = await getMealLogs(app, {
      authorization,
      query: "?date=2027-01-15&timezone=Asia%2FJerusalem",
    });
    expect(await logs.json()).toEqual({ meals: [] });
  });

  it("requires explicit confirmation before replacing a populated plan", async () => {
    const { app } = appWithServices();
    const created = (await (await writePlan(app)).json()) as {
      plan: { version: number };
    };
    const response = await writePlan(
      app,
      planPayload({
        idempotencyKey: "plan-friday-replacement",
        expectedVersion: created.plan.version,
        meals: [],
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "MEAL_PLAN_CONFIRMATION_REQUIRED",
    });
  });
});

describe("server auth configuration", () => {
  it("reads deploy-time token validation settings from environment variables", () => {
    expect(
      resolveServerAuthConfig(
        {},
        {
          HEALTH_SYNC_TOKEN_AUDIENCE: "fitness-api-production",
          HEALTH_SYNC_TOKEN_ISSUER: "https://auth.fitness.example",
          HEALTH_SYNC_TOKEN_RESOURCE: "https://api.fitness.example",
          HEALTH_SYNC_EXPECTED_SUBJECT: "user_alex",
        },
      ),
    ).toMatchObject({
      expectedAudience: "fitness-api-production",
      expectedIssuer: "https://auth.fitness.example",
      expectedResource: "https://api.fitness.example",
      expectedSubject: "user_alex",
    });
  });

  it("derives deploy-time token URLs from Render's external URL when explicit HealthKit URLs are not set", () => {
    expect(
      resolveServerAuthConfig(
        {},
        {
          HEALTH_SYNC_TOKEN_AUDIENCE: "fitness-api-production",
          RENDER_EXTERNAL_URL: "https://fitness-coach.onrender.com",
        },
      ),
    ).toMatchObject({
      expectedAudience: "fitness-api-production",
      expectedIssuer: "https://fitness-coach.onrender.com",
      expectedResource: "https://fitness-coach.onrender.com",
    });
  });

  it("derives deploy-time token URLs from Vercel's production URL when explicit HealthKit URLs are not set", () => {
    expect(
      resolveServerAuthConfig(
        {},
        {
          HEALTH_SYNC_TOKEN_AUDIENCE: "fitness-api-production",
          VERCEL_PROJECT_PRODUCTION_URL: "fitness-coach.vercel.app",
        },
      ),
    ).toMatchObject({
      expectedAudience: "fitness-api-production",
      expectedIssuer: "https://fitness-coach.vercel.app",
      expectedResource: "https://fitness-coach.vercel.app",
    });
  });
});

describe("POST /api/health/samples auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 without auth", async () => {
    const { app } = appWithServices();

    const response = await postSamples(app);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "unauthorized",
    });
  });

  const invalidAuthCases: readonly {
    name: string;
    authorization: () => string;
    expectedStatus: number;
    expectedReason: string;
    revokedTokenIds?: readonly string[];
  }[] = [
    {
      name: "expired token",
      authorization: () => bearer(validClaims({ exp: nowSeconds - 1 })),
      expectedStatus: 401,
      expectedReason: "expired",
    },
    {
      name: "revoked token",
      authorization: () => bearer(validClaims({ jti: "revoked-token" })),
      expectedStatus: 401,
      expectedReason: "revoked",
      revokedTokenIds: ["revoked-token"],
    },
    {
      name: "wrong user token",
      authorization: () => bearer(validClaims({ sub: "user_other" })),
      expectedStatus: 403,
      expectedReason: "wrong-user",
    },
    {
      name: "wrong audience token",
      authorization: () => bearer(validClaims({ aud: "fitness-mcp" })),
      expectedStatus: 401,
      expectedReason: "wrong-audience",
    },
    {
      name: "wrong resource token",
      authorization: () =>
        bearer(validClaims({ resource: "https://mcp.fitness.local" })),
      expectedStatus: 401,
      expectedReason: "wrong-resource",
    },
    {
      name: "wrong issuer token",
      authorization: () =>
        bearer(validClaims({ iss: "https://issuer.example.test" })),
      expectedStatus: 401,
      expectedReason: "wrong-issuer",
    },
    {
      name: "malformed JWT token",
      authorization: () => "Bearer not-a-jwt",
      expectedStatus: 401,
      expectedReason: "malformed",
    },
    {
      name: "malformed JWKS-shaped fake token",
      authorization: malformedJwksToken,
      expectedStatus: 401,
      expectedReason: "malformed",
    },
    {
      name: "read-only MCP token",
      authorization: () =>
        bearer(validClaims({ scope: "health:read coach:read report:read" })),
      expectedStatus: 403,
      expectedReason: "missing-scope",
    },
  ];

  for (const testCase of invalidAuthCases) {
    it(`rejects ${testCase.name}`, async () => {
      const { app } = appWithServices({
        revokedTokenIds: testCase.revokedTokenIds,
      });

      const response = await postSamples(app, {
        authorization: testCase.authorization(),
      });

      expect(response.status).toBe(testCase.expectedStatus);
      await expect(response.json()).resolves.toMatchObject({
        error: testCase.expectedReason,
      });
    });
  }

  it("rejects fake tokens when the explicit test/dev guard is disabled", async () => {
    const authorization = bearer(validClaims());
    const { app } = appWithServices();

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_FAKE_AUTH_TOKENS", "");

    const response = await postSamples(app, { authorization });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "unauthorized",
    });
  });

  it("rejects fake tokens in production even if the fake-token override flag is set", async () => {
    const authorization = bearer(validClaims());
    const { app } = appWithServices();

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_FAKE_AUTH_TOKENS", "1");

    const response = await postSamples(app, { authorization });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "unauthorized",
    });
  });

  it("accepts signed production tokens when a trusted JWKS is configured", async () => {
    const keyPair = await generateFitnessJwtKeyPair({ keyId: "api-key-1" });
    const token = await signFitnessJwt(validClaims(), {
      keyId: keyPair.keyId,
      privateJwk: keyPair.privateJwk,
      now: nowSeconds,
    });
    const { app } = appWithServices({
      trustedJwks: buildFitnessJwks([keyPair.publicJwk]),
    });

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_FAKE_AUTH_TOKENS", "1");

    const response = await postSamples(app, {
      authorization: `Bearer ${token}`,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: 1,
      duplicate: 0,
      deleted: 0,
      alreadyDeleted: 0,
      missingDeleted: 0,
    });
  });

  it("rejects a body that targets another user", async () => {
    const { app } = appWithServices();

    const response = await postSamples(app, {
      authorization: bearer(validClaims()),
      payload: validPayload({ userId: "user_other" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "wrong-user",
    });
  });
});

describe("POST /api/health/samples validation", () => {
  it.each([
    ["unknown metric", { metricName: "body_weight" }],
    ["wrong unit for metric", { unit: "count" }],
    ["non-numeric value", { value: "87.4" }],
    ["negative weight value", { value: -1 }],
    [
      "zero heart-rate value",
      { metricName: "heart_rate", unit: "bpm", value: 0 },
    ],
    [
      "sleep duration over 24 hours",
      { metricName: "sleep", unit: "minute", value: 1_441 },
    ],
    ["invalid start timestamp", { startTime: "yesterday" }],
    ["date-only start timestamp", { startTime: "2026-06-11" }],
    ["impossible calendar date", { startTime: "2026-02-30T06:00:00.000Z" }],
    ["invalid end timestamp", { endTime: "later" }],
    ["missing timezone", { timezone: "" }],
    ["missing source", { source: "" }],
    ["missing source sample id", { sourceSampleId: "" }],
  ])("rejects %s", async (_name, sampleOverrides) => {
    const { app } = appWithServices();
    const payload = validPayload({
      samples: [
        {
          ...(
            validPayload() as {
              samples: [Record<string, unknown>];
            }
          ).samples[0],
          ...sampleOverrides,
        },
      ],
    });

    const response = await postSamples(app, {
      authorization: bearer(validClaims()),
      payload,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid-payload",
    });
  });

  it.each([
    ["empty idempotency key", ""],
    ["idempotency key with spaces", "healthkit batch 1"],
    ["overlong idempotency key", "a".repeat(129)],
  ])("rejects %s", async (_name, idempotencyKey) => {
    const { app } = appWithServices();

    const response = await postSamples(app, {
      authorization: bearer(validClaims()),
      payload: validPayload({ idempotencyKey }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid-payload",
    });
  });

  it("rejects a payload with no samples or deleted samples", async () => {
    const { app } = appWithServices();

    const response = await postSamples(app, {
      authorization: bearer(validClaims()),
      payload: validPayload({
        samples: [],
        deletedSamples: [],
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid-payload",
    });
  });

  it("rejects raw Apple Health samples so stale clients cannot refill storage", async () => {
    const { app } = appWithServices();

    const response = await postSamples(app, {
      authorization: bearer(validClaims()),
      payload: validPayload({
        samples: [
          validSample({
            source: "apple_health",
            sourceSampleId: "raw-healthkit-uuid",
          }),
        ],
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid-payload",
      message:
        "Raw Apple Health sample uploads are no longer accepted; upload daily apple_health_daily aggregates.",
    });
  });

  it("rejects upload requests over 1000 total items before ingestion", async () => {
    const audit = createAuditService({
      now: () => new Date(nowIso),
    });
    let ingestCalls = 0;
    const healthSync: HealthSyncService = {
      ingest() {
        ingestCalls += 1;
        throw new Error("Oversized payload should not reach ingestion.");
      },
    };
    const app = createApp({
      auth: {
        now: nowSeconds,
      },
      services: {
        audit,
        healthSync,
      },
    });

    const response = await postSamples(app, {
      authorization: bearer(validClaims()),
      payload: validPayload({
        samples: Array.from({ length: 500 }, (_value, index) =>
          validSample({ sourceSampleId: `hk-weight-sample-${index}` }),
        ),
        deletedSamples: Array.from({ length: 501 }, (_value, index) =>
          validDeletedSample({ sourceSampleId: `hk-deleted-sample-${index}` }),
        ),
      }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "payload-too-large",
      message:
        "Payload samples plus deletedSamples must contain at most 1000 total items; received 1001.",
    });
    expect(ingestCalls).toBe(0);
    expect(audit.list()).toEqual([]);
  });

  it("accepts upload requests at the 1000 item total limit", async () => {
    let ingestCalls = 0;
    const healthSync: HealthSyncService = {
      ingest(input) {
        ingestCalls += 1;

        return {
          createdBatch: true,
          response: {
            status: "ok",
            idempotencyKey: input.idempotencyKey,
            accepted:
              input.samples.length + (input.deletedSamples ?? []).length,
            created: input.samples.length,
            duplicate: 0,
            deleted: 0,
            alreadyDeleted: 0,
            missingDeleted: input.deletedSamples?.length ?? 0,
            samples: [],
            deletedSamples: [],
          },
        };
      },
    };
    const app = createApp({
      auth: {
        now: nowSeconds,
      },
      services: {
        audit: createAuditService(),
        healthSync,
      },
    });

    const response = await postSamples(app, {
      authorization: bearer(validClaims()),
      payload: validPayload({
        samples: Array.from({ length: 500 }, (_value, index) =>
          validSample({ sourceSampleId: `hk-weight-sample-${index}` }),
        ),
        deletedSamples: Array.from({ length: 500 }, (_value, index) =>
          validDeletedSample({ sourceSampleId: `hk-deleted-sample-${index}` }),
        ),
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      accepted: 1_000,
    });
    expect(ingestCalls).toBe(1);
  });

  it("caches timezone validation for repeated timezones in one upload", async () => {
    const { app } = appWithServices();
    const timeZone = "Pacific/Chatham";
    const originalDateTimeFormat = Intl.DateTimeFormat;
    const dateTimeFormatSpy = vi
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(
        (
          locales?: Intl.LocalesArgument,
          options?: Intl.DateTimeFormatOptions,
        ) => originalDateTimeFormat(locales, options),
      );

    try {
      const response = await postSamples(app, {
        authorization: bearer(validClaims()),
        payload: validPayload({
          idempotencyKey: "healthkit-timezone-cache",
          samples: [
            validSample({
              sourceSampleId: "hk-weight-timezone-cache-1",
              timezone: timeZone,
            }),
            validSample({
              sourceSampleId: "hk-weight-timezone-cache-2",
              timezone: timeZone,
            }),
          ],
        }),
      });

      const matchingCalls = dateTimeFormatSpy.mock.calls.filter(
        ([, options]) => options?.timeZone === timeZone,
      );

      expect(response.status).toBe(200);
      expect(matchingCalls).toHaveLength(1);
    } finally {
      dateTimeFormatSpy.mockRestore();
    }
  });

  it.each([
    ["unknown deleted metric", { metricName: "body_weight" }],
    ["missing deleted source", { source: "" }],
    ["missing deleted source sample id", { sourceSampleId: "" }],
  ])("rejects %s", async (_name, deletedSampleOverrides) => {
    const { app } = appWithServices();

    const response = await postSamples(app, {
      authorization: bearer(validClaims()),
      payload: validPayload({
        samples: [],
        deletedSamples: [
          {
            metricName: "weight",
            source: "apple_health_daily",
            sourceSampleId:
              "apple-health-daily:weight:2026-06-11:Asia_Jerusalem",
            ...deletedSampleOverrides,
          },
        ],
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid-payload",
    });
  });
});

describe("POST /api/health/samples ingestion", () => {
  it("ingests one weight sample with health:write and returns a stable idempotent response", async () => {
    const { app, audit } = appWithServices();

    const firstResponse = await postSamples(app, {
      authorization: bearer(validClaims()),
    });
    const firstBody = await firstResponse.json();
    const secondResponse = await postSamples(app, {
      authorization: bearer(validClaims()),
    });
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(secondBody).toEqual(firstBody);
    expect(firstBody).toEqual({
      status: "ok",
      idempotencyKey: "healthkit-batch-1",
      accepted: 1,
      created: 1,
      duplicate: 0,
      deleted: 0,
      alreadyDeleted: 0,
      missingDeleted: 0,
      samples: [
        {
          id: "health_sample_1",
          metricName: "weight",
          sourceSampleId: "apple-health-daily:weight:2026-06-11:Asia_Jerusalem",
          status: "created",
        },
      ],
      deletedSamples: [],
    });
    expect(audit.list()).toEqual([
      {
        id: "audit_event_1",
        action: "health.samples.ingest",
        actor: {
          type: "user",
          id: "user_alex",
        },
        target: {
          type: "health_samples",
          id: "healthkit-batch-1",
        },
        userId: "user_alex",
        profileId: "profile_self_user_alex",
        createdAt: nowIso,
        metadata: {
          profileId: "profile_self_user_alex",
          accepted: 1,
          created: 1,
          duplicate: 0,
          deleted: 0,
          alreadyDeleted: 0,
          missingDeleted: 0,
        },
      },
    ]);
    expect(JSON.stringify(audit.list())).not.toContain(FAKE_AUTH_TOKEN_PREFIX);
  });

  it("accepts the internal health:sync scope", async () => {
    const { app } = appWithServices();

    const response = await postSamples(app, {
      authorization: bearer(validClaims({ scope: "health:sync" })),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      accepted: 1,
    });
  });

  it("rejects meal-only tokens for health uploads", async () => {
    const { app } = appWithServices();

    const response = await postSamples(app, {
      authorization: bearer(validClaims({ scope: "meal:write" })),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "missing-scope",
    });
  });

  it("returns a summary response for Prefer return=minimal without changing idempotent replay", async () => {
    const { app } = appWithServices();

    const minimalResponse = await postSamples(app, {
      authorization: bearer(validClaims()),
      headers: {
        Prefer: "respond-async, return=minimal",
      },
    });
    const minimalBody = await minimalResponse.json();
    const fullReplayResponse = await postSamples(app, {
      authorization: bearer(validClaims()),
    });

    expect(minimalResponse.status).toBe(200);
    expect(minimalResponse.headers.get("preference-applied")).toBe(
      "return=minimal",
    );
    expect(minimalBody).toEqual({
      status: "ok",
      idempotencyKey: "healthkit-batch-1",
      accepted: 1,
      created: 1,
      duplicate: 0,
      deleted: 0,
      alreadyDeleted: 0,
      missingDeleted: 0,
    });
    expect(minimalBody).not.toHaveProperty("samples");
    expect(minimalBody).not.toHaveProperty("deletedSamples");
    expect(fullReplayResponse.status).toBe(200);
    await expect(fullReplayResponse.json()).resolves.toEqual({
      status: "ok",
      idempotencyKey: "healthkit-batch-1",
      accepted: 1,
      created: 1,
      duplicate: 0,
      deleted: 0,
      alreadyDeleted: 0,
      missingDeleted: 0,
      samples: [
        {
          id: "health_sample_1",
          metricName: "weight",
          sourceSampleId: "apple-health-daily:weight:2026-06-11:Asia_Jerusalem",
          status: "created",
        },
      ],
      deletedSamples: [],
    });
  });

  it("accepts deletion-only HealthKit deltas and audits deletion counters", async () => {
    const { app, audit } = appWithServices();
    const createResponse = await postSamples(app, {
      authorization: bearer(validClaims()),
    });

    expect(createResponse.status).toBe(200);

    const deleteResponse = await postSamples(app, {
      authorization: bearer(validClaims()),
      payload: validPayload({
        idempotencyKey: "healthkit-delete-1",
        samples: [],
        deletedSamples: [
          {
            metricName: "weight",
            source: "apple_health_daily",
            sourceSampleId:
              "apple-health-daily:weight:2026-06-11:Asia_Jerusalem",
          },
        ],
      }),
    });
    const deleteBody = await deleteResponse.json();
    const replayResponse = await postSamples(app, {
      authorization: bearer(validClaims()),
      payload: validPayload({
        idempotencyKey: "healthkit-delete-1",
        samples: [],
        deletedSamples: [
          {
            metricName: "weight",
            source: "apple_health_daily",
            sourceSampleId:
              "apple-health-daily:weight:2026-06-11:Asia_Jerusalem",
          },
        ],
      }),
    });

    expect(deleteResponse.status).toBe(200);
    expect(replayResponse.status).toBe(200);
    await expect(replayResponse.json()).resolves.toEqual(deleteBody);
    expect(deleteBody).toEqual({
      status: "ok",
      idempotencyKey: "healthkit-delete-1",
      accepted: 1,
      created: 0,
      duplicate: 0,
      deleted: 1,
      alreadyDeleted: 0,
      missingDeleted: 0,
      samples: [],
      deletedSamples: [
        {
          id: "health_sample_1",
          metricName: "weight",
          sourceSampleId: "apple-health-daily:weight:2026-06-11:Asia_Jerusalem",
          status: "deleted",
        },
      ],
    });
    expect(audit.list()[1]).toMatchObject({
      action: "health.samples.ingest",
      profileId: "profile_self_user_alex",
      metadata: {
        profileId: "profile_self_user_alex",
        accepted: 1,
        created: 0,
        duplicate: 0,
        deleted: 1,
        alreadyDeleted: 0,
        missingDeleted: 0,
      },
    });
  });

  it("distinguishes already-deleted and missing HealthKit deletion records", async () => {
    const { app } = appWithServices();

    await postSamples(app, {
      authorization: bearer(validClaims()),
    });
    await postSamples(app, {
      authorization: bearer(validClaims()),
      payload: validPayload({
        idempotencyKey: "healthkit-delete-1",
        samples: [],
        deletedSamples: [
          {
            metricName: "weight",
            source: "apple_health_daily",
            sourceSampleId:
              "apple-health-daily:weight:2026-06-11:Asia_Jerusalem",
          },
        ],
      }),
    });

    const response = await postSamples(app, {
      authorization: bearer(validClaims()),
      payload: validPayload({
        idempotencyKey: "healthkit-delete-2",
        samples: [],
        deletedSamples: [
          {
            metricName: "weight",
            source: "apple_health_daily",
            sourceSampleId:
              "apple-health-daily:weight:2026-06-11:Asia_Jerusalem",
          },
          {
            metricName: "weight",
            source: "apple_health_daily",
            sourceSampleId:
              "apple-health-daily:weight:2026-06-10:Asia_Jerusalem",
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: 2,
      deleted: 0,
      alreadyDeleted: 1,
      missingDeleted: 1,
      deletedSamples: [
        {
          id: "health_sample_1",
          metricName: "weight",
          sourceSampleId: "apple-health-daily:weight:2026-06-11:Asia_Jerusalem",
          status: "already_deleted",
        },
        {
          id: null,
          metricName: "weight",
          sourceSampleId: "apple-health-daily:weight:2026-06-10:Asia_Jerusalem",
          status: "missing",
        },
      ],
    });
  });

  it("awaits async repository-backed ingestion before auditing", async () => {
    const audit = createAuditService({
      now: () => new Date(nowIso),
    });
    const healthSync: HealthSyncService = {
      async ingest(input) {
        expect(input.userId).toBe("user_alex");
        expect(input.profileId).toBe("profile_self_user_alex");

        return {
          createdBatch: true,
          response: {
            status: "ok",
            idempotencyKey: input.idempotencyKey,
            accepted: input.samples.length,
            created: 1,
            duplicate: 0,
            deleted: 0,
            alreadyDeleted: 0,
            missingDeleted: 0,
            samples: [
              {
                id: "db-health-sample-1",
                metricName: "weight",
                sourceSampleId:
                  "apple-health-daily:weight:2026-06-11:Asia_Jerusalem",
                status: "created",
              },
            ],
            deletedSamples: [],
          },
        };
      },
    };
    const app = createApp({
      auth: {
        now: nowSeconds,
      },
      services: {
        audit,
        healthSync,
      },
    });

    const response = await postSamples(app, {
      authorization: bearer(validClaims()),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      samples: [
        {
          id: "db-health-sample-1",
        },
      ],
    });
    expect(audit.list()).toHaveLength(1);
  });

  it("awaits async audit persistence before responding", async () => {
    const auditCalls: unknown[] = [];
    const audit = {
      async create(event: Parameters<AuditService["create"]>[0]) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        auditCalls.push(event);

        return {
          id: "audit-event-db-1",
          ...event,
          createdAt: nowIso,
        };
      },
      list() {
        return [];
      },
    };
    const app = createApp({
      auth: {
        now: nowSeconds,
      },
      services: {
        audit,
        healthSync: createHealthSyncService(),
      },
    });

    const response = await postSamples(app, {
      authorization: bearer(validClaims()),
    });

    expect(response.status).toBe(200);
    expect(auditCalls).toHaveLength(1);
  });
});

describe("POST /api/meals/estimate", () => {
  it("requires authentication", async () => {
    const { app } = appWithServices({
      mealEstimator: createFakeMealEstimator(),
    });

    const response = await postMealEstimate(app);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "unauthorized",
    });
  });

  it("requires the meal:write scope", async () => {
    const { app } = appWithServices({
      mealEstimator: createFakeMealEstimator(),
    });

    const response = await postMealEstimate(app, {
      authorization: bearer(validClaims({ scope: "health:sync" })),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "missing-scope",
    });
  });

  it("estimates macros from a meal description without auditing raw text", async () => {
    const estimator = createFakeMealEstimator();
    const { app, audit } = appWithServices({
      mealEstimator: estimator,
    });

    const response = await postMealEstimate(app, {
      authorization: bearer(validClaims({ scope: "health:sync meal:write" })),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      totals: {
        calories: 240,
        proteinGrams: 22,
        carbsGrams: 11,
        fatGrams: 12.5,
        fiberGrams: 0,
      },
      ingredients: [],
      confidence: 0.82,
      summary: "Estimated from the meal description.",
      provider: "openrouter",
      model: "test-model",
    });
    expect(estimator.calls).toEqual([
      {
        userId: "user_alex",
        mealType: "Breakfast",
        description: "גבינה לבנה 250ג 5 אחוז",
      },
    ]);
    expect(audit.list()).toEqual([
      {
        id: "audit_event_1",
        action: "meal.estimate",
        actor: {
          type: "user",
          id: "user_alex",
        },
        target: {
          type: "meal_estimate",
          id: "adhoc",
        },
        userId: "user_alex",
        createdAt: nowIso,
        metadata: {
          photoCount: 0,
          calories: 240,
          confidence: 0.82,
          provider: "openrouter",
          model: "test-model",
        },
      },
    ]);
    expect(JSON.stringify(audit.list())).not.toContain("גבינה");
  });

  it("rejects too many photos before calling the estimator", async () => {
    const estimator = createFakeMealEstimator();
    const { app } = appWithServices({
      mealEstimator: estimator,
    });

    const response = await postMealEstimate(app, {
      authorization: bearer(validClaims({ scope: "meal:write" })),
      payload: {
        mealType: "Lunch",
        description: "meal with photos",
        photos: Array.from({ length: 7 }, () => ({
          mediaType: "image/jpeg",
          base64: "abcd",
        })),
      },
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: "payload-too-large",
    });
    expect(estimator.calls).toEqual([]);
  });
});

describe("profile API", () => {
  it("requires authentication for profile discovery", async () => {
    const { app } = appWithServices();

    const response = await getProfiles(app);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "unauthorized",
    });
  });

  it("lists a self profile for the authenticated user by default", async () => {
    const { app } = appWithServices();
    const authorization = bearer(validClaims({ scope: "health:write" }));

    const response = await getProfiles(app, authorization);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profiles: [
        {
          profileId: "profile_self_user_alex",
          displayName: "user_alex",
          relationship: "self",
          roleIdentifier: "owner",
          ownershipStatus: "owner",
          isOwner: true,
          isManaged: false,
          permissions: expect.arrayContaining([
            "profile.read",
            "health.summary.read",
            "meal.write",
            "profile_members.manage",
          ]),
        },
      ],
    });
  });

  it("creates managed profiles without linked login users", async () => {
    const { app, audit } = appWithServices();
    const authorization = bearer(validClaims({ scope: "health:write" }));

    const createResponse = await postManagedProfile(app, { authorization });

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      profile: { profileId: string };
    };

    const [profileResponse, accessResponse, listResponse] = await Promise.all([
      getProfile(app, created.profile.profileId, authorization),
      getProfileAccess(app, created.profile.profileId, authorization),
      getProfiles(app, authorization),
    ]);

    expect(profileResponse.status).toBe(200);
    expect(accessResponse.status).toBe(200);
    expect(listResponse.status).toBe(200);
    await expect(profileResponse.json()).resolves.toMatchObject({
      profile: {
        profileId: created.profile.profileId,
        displayName: "Family member",
        ownerUserId: "user_alex",
        profileType: "managed",
        relationship: "guardian",
        roleIdentifier: "owner",
        isManaged: true,
      },
    });
    await expect(accessResponse.json()).resolves.toMatchObject({
      access: {
        userId: "user_alex",
        profileId: created.profile.profileId,
        relationship: "guardian",
      },
      profile: {
        id: created.profile.profileId,
        profileType: "managed",
      },
    });
    await expect(listResponse.json()).resolves.toMatchObject({
      profiles: [
        {
          profileId: "profile_self_user_alex",
        },
        {
          profileId: created.profile.profileId,
          isManaged: true,
        },
      ],
    });
    expect(audit.list()).toMatchObject([
      {
        action: "profile.managed.create",
        profileId: created.profile.profileId,
        userId: "user_alex",
        metadata: {
          profileId: created.profile.profileId,
          profileType: "managed",
        },
      },
    ]);
  });
});

describe("meal log API", () => {
  it("requires authentication for meal log reads and writes", async () => {
    const { app } = appWithServices();

    const readResponse = await getMealLogs(app);
    const writeResponse = await postMealLog(app);

    expect(readResponse.status).toBe(401);
    expect(writeResponse.status).toBe(401);
  });

  it("requires meal:write scope for meal log writes", async () => {
    const { app } = appWithServices();

    const response = await postMealLog(app, {
      authorization: bearer(validClaims({ scope: "health:sync" })),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "missing-scope",
    });
  });

  it("upserts meals with ingredients without auditing raw food text", async () => {
    const { app, audit } = appWithServices();
    const authorization = bearer(validClaims({ scope: "meal:write" }));

    const response = await postMealLog(app, { authorization });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      meal: {
        id: string;
        title: string;
        totals: { calories: number };
        ingredients: readonly { name: string }[];
      };
    };

    expect(body.meal.title).toBe("גבינה לבנה וטוסט");
    expect(body.meal.totals.calories).toBe(430);
    expect(body.meal.ingredients).toHaveLength(1);

    const updateResponse = await postMealLog(app, {
      authorization,
      payload: validMealLogPayload({
        idempotencyKey: "meal-log-update-1",
        totals: {
          calories: 450,
          proteinGrams: 35,
          carbsGrams: 42,
          fatGrams: 13,
          fiberGrams: 4,
        },
      }),
    });

    expect(updateResponse.status).toBe(200);

    const listResponse = await getMealLogs(app, {
      authorization,
      query: "?from=2026-06-22T00:00:00.000Z&to=2026-06-23T00:00:00.000Z",
    });

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      meals: [
        {
          title: "גבינה לבנה וטוסט",
          totals: {
            calories: 450,
          },
        },
      ],
    });
    expect(JSON.stringify(audit.list())).not.toContain("גבינה");
    expect(audit.list()).toMatchObject([
      {
        action: "meal.log.upsert",
        metadata: {
          calories: 430,
          ingredientCount: 1,
          photoCount: 1,
        },
      },
      {
        action: "meal.log.upsert",
        metadata: {
          calories: 450,
          ingredientCount: 1,
          photoCount: 1,
        },
      },
    ]);
  });

  it("accepts local food dates for API meal writes around Israel midnight", async () => {
    const { app } = appWithServices();
    const authorization = bearer(validClaims({ scope: "meal:write" }));

    const response = await postMealLog(app, {
      authorization,
      payload: validMealLogPayload({
        clientMealId: "local-food-date-meal",
        occurredAt: undefined,
        localFoodDate: "2026-06-25",
        localTime: "23:30",
        title: "Previous food day correction",
        totals: {
          calories: 250,
          proteinGrams: 30,
          carbsGrams: 5,
          fatGrams: 9,
          fiberGrams: 1,
        },
      }),
    });

    expect(response.status).toBe(200);

    const previousDay = await getMealLogs(app, {
      authorization,
      query: "?from=2026-06-24T21:00:00.000Z&to=2026-06-25T21:00:00.000Z",
    });
    const nextDay = await getMealLogs(app, {
      authorization,
      query: "?from=2026-06-25T21:00:00.000Z&to=2026-06-26T21:00:00.000Z",
    });

    await expect(previousDay.json()).resolves.toMatchObject({
      meals: [
        {
          title: "Previous food day correction",
          occurredAt: "2026-06-25T20:30:00.000Z",
        },
      ],
    });
    await expect(nextDay.json()).resolves.toMatchObject({
      meals: [],
    });
  });

  it("lists API meals by explicit local food date and reflects external mutations", async () => {
    const { app } = appWithServices();
    const authorization = bearer(validClaims({ scope: "meal:write" }));

    const chicken = await postMealLog(app, {
      authorization,
      payload: validMealLogPayload({
        clientMealId: "stale-chicken",
        localFoodDate: "2026-06-25",
        localTime: "20:00",
        occurredAt: undefined,
        title: "150 grams cooked chicken breast",
        totals: {
          calories: 248,
          proteinGrams: 46,
          carbsGrams: 0,
          fatGrams: 5.4,
          fiberGrams: 0,
        },
      }),
    });
    const chickenBody = (await chicken.json()) as {
      meal: { id: string };
    };

    expect(chicken.status).toBe(200);

    const deleteResponse = await deleteMealLog(
      app,
      chickenBody.meal.id,
      authorization,
    );

    expect(deleteResponse.status).toBe(200);

    const danone = await postMealLog(app, {
      authorization,
      payload: validMealLogPayload({
        clientMealId: "danone-pro-veg",
        localFoodDate: "2026-06-25",
        localTime: "21:00",
        occurredAt: undefined,
        title: "דנונה PRO וירקות",
        totals: {
          calories: 180,
          proteinGrams: 20,
          carbsGrams: 10,
          fatGrams: 5,
          fiberGrams: 3,
        },
      }),
    });

    expect(danone.status).toBe(200);

    const response = await getMealLogs(app, {
      authorization,
      query: "?date=2026-06-25&timezone=Asia%2FJerusalem",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      meals: [
        {
          title: "דנונה PRO וירקות",
          occurredAt: "2026-06-25T18:00:00.000Z",
        },
      ],
    });
  });

  it("ignores caller-supplied user ids and scopes meals to auth", async () => {
    const { app } = appWithServices();
    const alexAuth = bearer(validClaims({ scope: "meal:write" }));

    const writeResponse = await postMealLog(app, {
      authorization: alexAuth,
      payload: validMealLogPayload({
        actorUserId: "user_bob",
        userId: "user_bob",
      }),
    });

    expect(writeResponse.status).toBe(200);

    const response = await getMealLogs(app, { authorization: alexAuth });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      meals: readonly { title: string; userId: string; profileId: string }[];
    };

    expect(body.meals).toMatchObject([
      {
        profileId: "profile_self_user_alex",
        title: "גבינה לבנה וטוסט",
        userId: "user_alex",
      },
    ]);
  });

  it("preserves explicit managed profile ids through meal service calls", async () => {
    const { app } = appWithServices();
    const authorization = bearer(validClaims({ scope: "meal:write" }));
    const profileResponse = await postManagedProfile(app, { authorization });
    const profileBody = (await profileResponse.json()) as {
      profile: { profileId: string };
    };
    const profileId = profileBody.profile.profileId;

    const writeResponse = await postMealLog(app, {
      authorization,
      payload: validMealLogPayload({
        clientMealId: "managed-profile-meal",
        profileId,
        title: "Managed profile meal",
      }),
    });

    expect(writeResponse.status).toBe(200);
    await expect(writeResponse.json()).resolves.toMatchObject({
      meal: {
        profileId,
        title: "Managed profile meal",
        userId: "user_alex",
      },
    });

    const selfList = await getMealLogs(app, { authorization });
    const managedList = await getMealLogs(app, {
      authorization,
      query: `?profileId=${encodeURIComponent(profileId)}`,
    });

    await expect(selfList.json()).resolves.toEqual({ meals: [] });
    await expect(managedList.json()).resolves.toMatchObject({
      meals: [
        {
          profileId,
          title: "Managed profile meal",
        },
      ],
    });
  });

  it("soft-deletes a meal by client id", async () => {
    const { app } = appWithServices();
    const authorization = bearer(validClaims({ scope: "meal:write" }));

    expect(await postMealLog(app, { authorization })).toHaveProperty(
      "status",
      200,
    );

    const deleteResponse = await deleteMealLog(
      app,
      "11111111-1111-4111-8111-111111111111",
      authorization,
    );

    expect(deleteResponse.status).toBe(200);

    const listResponse = await getMealLogs(app, { authorization });

    await expect(listResponse.json()).resolves.toEqual({ meals: [] });
  });
});

describe("coach profile API", () => {
  it("requires authentication and coach write scope for profile changes", async () => {
    const { app } = appWithServices();

    const unauthenticated = await putCoachProfile(app);
    const wrongScope = await putCoachProfile(app, {
      authorization: bearer(validClaims({ scope: "meal:write" })),
    });

    expect(unauthenticated.status).toBe(401);
    expect(wrongScope.status).toBe(403);
    await expect(wrongScope.json()).resolves.toMatchObject({
      error: "missing-scope",
    });
  });

  it("stores a profile with server-derived nutrition targets", async () => {
    const { app, audit } = appWithServices();
    const authorization = bearer(validClaims({ scope: "coach:write" }));

    const writeResponse = await putCoachProfile(app, {
      authorization,
      payload: validCoachProfilePayload({
        targets: {
          selectedCalories: 9999,
        },
      }),
    });

    expect(writeResponse.status).toBe(200);
    await expect(writeResponse.json()).resolves.toMatchObject({
      profile: {
        goal: "lose_weight",
        weightKg: 87.5,
        estimatedStepsPerDay: 11_500,
        targets: {
          maintenanceCalories: 2400,
          loseCalories: 1900,
          maintainCalories: 2400,
          gainCalories: 2800,
          selectedCalories: 1900,
          proteinGrams: 160,
          fatGrams: 60,
          carbsGrams: 180,
          fiberGrams: 30,
        },
      },
    });

    const readResponse = await getCoachProfile(app, authorization);

    expect(readResponse.status).toBe(200);
    await expect(readResponse.json()).resolves.toMatchObject({
      profile: {
        goal: "lose_weight",
        targets: {
          selectedCalories: 1900,
        },
      },
    });
    expect(audit.list()).toMatchObject([
      {
        action: "coach.profile.upsert",
        metadata: {
          goal: "lose_weight",
          mealSlotCount: 3,
          selectedCalories: 1900,
          source: "ios",
        },
      },
    ]);
    expect(JSON.stringify(audit.list())).not.toContain("eggs");
  });

  it("uses optional active and resting calories for profile targets", async () => {
    const { app } = appWithServices();
    const authorization = bearer(validClaims({ scope: "coach:write" }));

    const response = await putCoachProfile(app, {
      authorization,
      payload: validCoachProfilePayload({
        estimatedActiveCaloriesPerDay: 900,
        estimatedRestingCaloriesPerDay: 2_100,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profile: {
        estimatedActiveCaloriesPerDay: 900,
        estimatedRestingCaloriesPerDay: 2_100,
        targets: {
          maintenanceCalories: 2800,
          selectedCalories: 2300,
        },
      },
    });
  });
});

describe("audit service API surface", () => {
  it("exposes create/list behavior without update or delete methods", () => {
    expect(auditHasNoMutationMethods).toBe(true);

    const audit = createAuditService();

    expect(Object.keys(audit).sort()).toEqual(["create", "list"]);
    expect("update" in audit).toBe(false);
    expect("delete" in audit).toBe(false);
    expect("remove" in audit).toBe(false);
  });

  it("does not allow callers to mutate stored audit events through input or list results", () => {
    const audit = createAuditService({
      now: () => new Date(nowIso),
    });
    const metadata = {
      nested: {
        accepted: 1,
      },
    };

    const created = audit.create({
      action: "health.samples.ingest",
      actor: {
        type: "user",
        id: "user_alex",
      },
      target: {
        type: "health_samples",
        id: "healthkit-batch-1",
      },
      userId: "user_alex",
      metadata,
    });

    metadata.nested.accepted = 2;
    expect(audit.list()[0]?.metadata).toEqual({
      nested: {
        accepted: 1,
      },
    });

    const listed = audit.list()[0];
    const listedMetadata = listed?.metadata as {
      nested: {
        accepted: number;
      };
    };

    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(listed)).toBe(true);
    expect(Object.isFrozen(listedMetadata.nested)).toBe(true);
    expect(() => {
      listedMetadata.nested.accepted = 3;
    }).toThrow(TypeError);
    expect(audit.list()[0]?.metadata).toEqual({
      nested: {
        accepted: 1,
      },
    });
  });
});
