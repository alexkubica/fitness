import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFERRED_MCP_WRITE_SCOPES,
  FIRST_SLICE_MCP_SCOPES,
  HEALTH_SYNC_SCOPES,
  IOS_APP_SCOPES,
  MCP_CONNECTOR_SCOPES,
  MCP_MEAL_WRITE_SCOPES,
  COACH_WRITE_SCOPES,
  assertNoDeferredScopes,
  createFakeAuthToken,
  decodeFakeAuthToken,
  getDefaultMcpScopes,
  hasRequiredScopes,
  isAuthScope,
  validateTokenClaims,
  type FitnessTokenClaims,
  type TokenValidationOptions,
  type TokenValidationReason,
} from "./index.js";

const nowSeconds = 1_800_000_000;

const validationOptions: TokenValidationOptions = {
  expectedIssuer: "https://auth.fitness.local",
  expectedAudience: "fitness-mcp",
  expectedResource: "https://mcp.fitness.local",
  expectedSubject: "user_alex",
  requiredScopes: FIRST_SLICE_MCP_SCOPES,
  now: nowSeconds,
};

type InvalidClaimsCase = readonly [
  name: string,
  claims: FitnessTokenClaims,
  reason: TokenValidationReason,
  optionOverrides?: Partial<TokenValidationOptions>,
];

function validClaims(
  overrides: Partial<FitnessTokenClaims> = {},
): FitnessTokenClaims {
  return {
    iss: "https://auth.fitness.local",
    aud: "fitness-mcp",
    resource: "https://mcp.fitness.local",
    sub: "user_alex",
    exp: nowSeconds + 300,
    iat: nowSeconds - 30,
    scope: "health:read coach:read report:read",
    jti: "token-1",
    ...overrides,
  };
}

describe("auth scope contracts", () => {
  it("contains exactly the first-slice MCP read scopes", () => {
    expect(FIRST_SLICE_MCP_SCOPES).toEqual([
      "health:read",
      "coach:read",
      "report:read",
    ]);
  });

  it("keeps deferred write scopes out of default MCP scope requests", () => {
    expect(MCP_MEAL_WRITE_SCOPES).toEqual(["meal:write"]);
    expect(COACH_WRITE_SCOPES).toEqual(["coach:write"]);
    expect(MCP_CONNECTOR_SCOPES).toEqual([
      "health:read",
      "coach:read",
      "report:read",
      "meal:write",
      "coach:write",
    ]);
    expect(DEFERRED_MCP_WRITE_SCOPES).toEqual([
      "checkin:write",
      "writeback:prepare",
      "writeback:commit",
    ]);
    expect(getDefaultMcpScopes()).toEqual(MCP_CONNECTOR_SCOPES);
    expect(
      getDefaultMcpScopes().some((scope) =>
        (DEFERRED_MCP_WRITE_SCOPES as readonly string[]).includes(scope),
      ),
    ).toBe(false);
    expect(() => assertNoDeferredScopes(getDefaultMcpScopes())).not.toThrow();
    expect(() =>
      assertNoDeferredScopes(["health:read", "writeback:prepare"]),
    ).toThrow(/deferred/i);
  });

  it("declares backend health sync scopes without adding them to MCP defaults", () => {
    expect(HEALTH_SYNC_SCOPES).toEqual(["health:write", "health:sync"]);
    expect(IOS_APP_SCOPES).toEqual([
      "health:write",
      "health:sync",
      "meal:write",
      "coach:write",
    ]);
    expect(getDefaultMcpScopes()).toEqual(MCP_CONNECTOR_SCOPES);
    expect(
      getDefaultMcpScopes().some((scope) =>
        (HEALTH_SYNC_SCOPES as readonly string[]).includes(scope),
      ),
    ).toBe(false);
  });

  it("recognizes only declared auth scopes and requires all requested scopes", () => {
    expect(isAuthScope("health:read")).toBe(true);
    expect(isAuthScope("health:write")).toBe(true);
    expect(isAuthScope("health:sync")).toBe(true);
    expect(isAuthScope("writeback:commit")).toBe(true);
    expect(isAuthScope("admin:all")).toBe(false);
    expect(
      hasRequiredScopes(
        ["health:read", "coach:read", "report:read"],
        FIRST_SLICE_MCP_SCOPES,
      ),
    ).toBe(true);
    expect(
      hasRequiredScopes(["health:read", "coach:read"], FIRST_SLICE_MCP_SCOPES),
    ).toBe(false);
  });
});

describe("test token helper guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws outside NODE_ENV=test unless fake auth tokens are explicitly allowed", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_FAKE_AUTH_TOKENS", "");

    expect(() => createFakeAuthToken(validClaims())).toThrow(/fake auth/i);
    expect(() => decodeFakeAuthToken("fitness.fake-auth-token.v1.e30")).toThrow(
      /fake auth/i,
    );
  });

  it("allows fake tokens in test or with the explicit override flag", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ALLOW_FAKE_AUTH_TOKENS", "");

    const token = createFakeAuthToken(validClaims());
    expect(decodeFakeAuthToken(token)).toEqual(validClaims());

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_FAKE_AUTH_TOKENS", "1");

    expect(decodeFakeAuthToken(createFakeAuthToken(validClaims()))).toEqual(
      validClaims(),
    );
  });
});

describe("token claim validation", () => {
  it("accepts exact first-slice MCP token claims", () => {
    expect(validateTokenClaims(validClaims(), validationOptions)).toEqual({
      ok: true,
      claims: validClaims(),
      scopes: FIRST_SLICE_MCP_SCOPES,
    });
  });

  it("accepts MCP connector claims with explicit meal-write allowance", () => {
    const claims = validClaims({ scope: MCP_CONNECTOR_SCOPES.join(" ") });

    expect(
      validateTokenClaims(claims, {
        ...validationOptions,
        allowedScopes: MCP_CONNECTOR_SCOPES,
      }),
    ).toEqual({
      ok: true,
      claims,
      scopes: MCP_CONNECTOR_SCOPES,
    });
  });

  const invalidClaimsCases: readonly InvalidClaimsCase[] = [
    ["expired", validClaims({ exp: nowSeconds - 1 }), "expired"],
    [
      "revoked",
      validClaims({ jti: "revoked-token" }),
      "revoked",
      { revokedTokenIds: new Set(["revoked-token"]) },
    ],
    ["wrong-user", validClaims({ sub: "user_other" }), "wrong-user"],
    ["wrong-audience", validClaims({ aud: "fitness-api" }), "wrong-audience"],
    [
      "wrong-resource",
      validClaims({ resource: "https://api.fitness.local" }),
      "wrong-resource",
    ],
    [
      "wrong-issuer",
      validClaims({ iss: "https://issuer.example.test" }),
      "wrong-issuer",
    ],
    [
      "missing-scope",
      validClaims({ scope: "health:read coach:read" }),
      "missing-scope",
    ],
    [
      "overbroad-scope",
      validClaims({ scope: "health:read coach:read report:read meal:write" }),
      "overbroad-scope",
    ],
  ];

  for (const [name, claims, reason, optionOverrides] of invalidClaimsCases) {
    it(`rejects ${name} token claims`, () => {
      expect(
        validateTokenClaims(claims, {
          ...validationOptions,
          ...(optionOverrides ?? {}),
        }),
      ).toMatchObject({
        ok: false,
        reason,
      });
    });
  }

  it("rejects malformed JWT and JWKS-like fixtures before trusting claims", () => {
    const missingScopeClaims: Record<string, unknown> = { ...validClaims() };
    delete missingScopeClaims.scope;

    expect(validateTokenClaims("not-a-jwt", validationOptions)).toMatchObject({
      ok: false,
      reason: "malformed",
    });
    expect(
      validateTokenClaims({ keys: "not-a-jwks-key-array" }, validationOptions),
    ).toMatchObject({
      ok: false,
      reason: "malformed",
    });
    expect(
      validateTokenClaims(missingScopeClaims, validationOptions),
    ).toMatchObject({
      ok: false,
      reason: "missing-scope",
    });
  });
});
