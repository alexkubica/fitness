import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFERRED_MCP_WRITE_SCOPES,
  HEALTH_SYNC_SCOPES,
  MCP_CONNECTOR_SCOPES,
  buildFitnessJwks,
  createFakeAuthToken,
  generateFitnessJwtKeyPair,
  signFitnessJwt,
  type FitnessTokenClaims,
} from "@fitness/auth";
import { Hono } from "hono";
import { createApp } from "../app.js";
import type { ServerEnv } from "../auth.js";
import { requireMcpAuth } from "./auth.js";
import { resolveMcpOAuthConfig } from "./oauth-metadata.js";

const nowSeconds = 1_800_000_000;

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
    jti: "mcp-token-1",
    ...overrides,
  };
}

function bearer(claims: FitnessTokenClaims): string {
  return `Bearer ${createFakeAuthToken(claims)}`;
}

function expectedMcpChallenge(): string {
  return `Bearer resource_metadata="https://mcp.fitness.local/.well-known/oauth-protected-resource", scope="${MCP_CONNECTOR_SCOPES.join(" ")}"`;
}

function expectedMcpErrorChallenge(
  error: "invalid_token" | "insufficient_scope",
): string {
  return `Bearer error="${error}", resource_metadata="https://mcp.fitness.local/.well-known/oauth-protected-resource", scope="${MCP_CONNECTOR_SCOPES.join(" ")}"`;
}

async function requestProtectedMcpRoute(
  authorization: string | undefined,
  config: Parameters<typeof resolveMcpOAuthConfig>[0] = {},
): Promise<Response> {
  const app = protectedMcpTestApp(config);

  if (authorization === undefined) {
    return app.request("/mcp/protected");
  }

  return app.request("/mcp/protected", {
    headers: {
      authorization,
    },
  });
}

function protectedMcpTestApp(
  config: Parameters<typeof resolveMcpOAuthConfig>[0] = {},
) {
  const app = new Hono<ServerEnv>();

  app.use(
    "/mcp/*",
    requireMcpAuth(
      resolveMcpOAuthConfig({ now: nowSeconds, ...config }),
      MCP_CONNECTOR_SCOPES,
    ),
  );
  app.get("/mcp/protected", (context) =>
    context.json({
      userId: context.get("auth").userId,
      scopes: context.get("auth").scopes,
    }),
  );

  return app;
}

describe("MCP OAuth protected resource metadata", () => {
  it("serves RFC 9728 protected resource metadata for the canonical MCP resource", async () => {
    const app = createApp({ mcp: { now: nowSeconds } });

    const response = await app.request("/.well-known/oauth-protected-resource");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      resource: "https://mcp.fitness.local/mcp",
      authorization_servers: ["https://mcp.fitness.local"],
      scopes_supported: MCP_CONNECTOR_SCOPES,
      bearer_methods_supported: ["header"],
    });
  });

  it("derives issuer and metadata URL from a custom resource when not explicitly overridden", () => {
    expect(
      resolveMcpOAuthConfig({
        resource: "https://coach.example.test/custom-mcp",
      }),
    ).toMatchObject({
      resource: "https://coach.example.test/custom-mcp",
      issuer: "https://coach.example.test",
      metadataUrl:
        "https://coach.example.test/.well-known/oauth-protected-resource",
    });
  });

  it("reads deploy-time OAuth metadata settings from environment variables", () => {
    expect(
      resolveMcpOAuthConfig(
        {},
        {
          MCP_AUDIENCE: "fitness-mcp-production",
          MCP_EXPECTED_SUBJECT: "user_alex",
          MCP_ISSUER_URL: "https://auth.fitness.example",
          MCP_METADATA_URL:
            "https://coach.fitness.example/.well-known/oauth-protected-resource",
          MCP_RESOURCE_URL: "https://coach.fitness.example/mcp",
        },
      ),
    ).toMatchObject({
      audience: "fitness-mcp-production",
      expectedSubject: "user_alex",
      issuer: "https://auth.fitness.example",
      metadataUrl:
        "https://coach.fitness.example/.well-known/oauth-protected-resource",
      resource: "https://coach.fitness.example/mcp",
    });
  });

  it("derives deploy metadata from Render's external URL when explicit MCP URLs are not set", () => {
    expect(
      resolveMcpOAuthConfig(
        {},
        {
          MCP_AUDIENCE: "fitness-mcp-production",
          RENDER_EXTERNAL_URL: "https://fitness-coach.onrender.com",
        },
      ),
    ).toMatchObject({
      audience: "fitness-mcp-production",
      issuer: "https://fitness-coach.onrender.com",
      metadataUrl:
        "https://fitness-coach.onrender.com/.well-known/oauth-protected-resource",
      resource: "https://fitness-coach.onrender.com/mcp",
    });
  });

  it("derives deploy metadata from Vercel's production URL when explicit MCP URLs are not set", () => {
    expect(
      resolveMcpOAuthConfig(
        {},
        {
          MCP_AUDIENCE: "fitness-mcp-production",
          VERCEL_PROJECT_PRODUCTION_URL: "fitness-coach.vercel.app",
        },
      ),
    ).toMatchObject({
      audience: "fitness-mcp-production",
      issuer: "https://fitness-coach.vercel.app",
      metadataUrl:
        "https://fitness-coach.vercel.app/.well-known/oauth-protected-resource",
      resource: "https://fitness-coach.vercel.app/mcp",
    });
  });
});

describe("MCP OAuth authorization server metadata", () => {
  it("serves OAuth and OIDC discovery metadata for the planned Better Auth issuer", async () => {
    const app = createApp({ mcp: { now: nowSeconds } });

    const oauthResponse = await app.request(
      "/.well-known/oauth-authorization-server",
    );
    const oidcResponse = await app.request("/.well-known/openid-configuration");

    expect(oauthResponse.status).toBe(200);
    expect(oidcResponse.status).toBe(200);

    const oauthMetadata = await oauthResponse.json();
    const oidcMetadata = await oidcResponse.json();
    const expectedOAuthMetadata = {
      issuer: "https://mcp.fitness.local",
      authorization_endpoint: "https://mcp.fitness.local/oauth2/authorize",
      token_endpoint: "https://mcp.fitness.local/oauth2/token",
      jwks_uri: "https://mcp.fitness.local/.well-known/jwks.json",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: MCP_CONNECTOR_SCOPES,
      client_registration_strategy: "predefined",
      dynamic_client_registration_supported: false,
    };

    expect(oauthMetadata).toMatchObject(expectedOAuthMetadata);
    expect(oauthMetadata).not.toHaveProperty("subject_types_supported");
    expect(oidcMetadata).toMatchObject({
      ...expectedOAuthMetadata,
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
    });
  });

  it("serves the configured public JWKS for signed token verification", async () => {
    const keyPair = await generateFitnessJwtKeyPair({ keyId: "jwks-key-1" });
    const jwks = buildFitnessJwks([keyPair.publicJwk]);
    const app = createApp({
      mcp: {
        now: nowSeconds,
        trustedJwks: jwks,
      },
    });

    const response = await app.request("/.well-known/jwks.json");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(jwks);
  });
});

describe("MCP OAuth auth middleware", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a protected resource metadata challenge when authorization is missing", async () => {
    const app = protectedMcpTestApp();

    const response = await app.request("/mcp/protected");

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      expectedMcpChallenge(),
    );
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("accepts a valid MCP connector token that echoes the resource", async () => {
    const app = protectedMcpTestApp();

    const response = await app.request("/mcp/protected", {
      headers: {
        authorization: bearer(validMcpClaims()),
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      userId: "user_alex",
      scopes: MCP_CONNECTOR_SCOPES,
    });
  });

  it("accepts signed production MCP tokens when a trusted JWKS is configured", async () => {
    const keyPair = await generateFitnessJwtKeyPair({ keyId: "mcp-key-1" });
    const token = await signFitnessJwt(validMcpClaims(), {
      keyId: keyPair.keyId,
      privateJwk: keyPair.privateJwk,
      now: nowSeconds,
    });

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_FAKE_AUTH_TOKENS", "1");

    const response = await requestProtectedMcpRoute(`Bearer ${token}`, {
      trustedJwks: buildFitnessJwks([keyPair.publicJwk]),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      userId: "user_alex",
      scopes: MCP_CONNECTOR_SCOPES,
    });
  });

  it.each([
    {
      name: "malformed token",
      authorization: "Bearer not-a-jwt",
      expectedError: "malformed",
    },
    {
      name: "expired token",
      authorization: bearer(validMcpClaims({ exp: nowSeconds - 1 })),
      expectedError: "expired",
    },
    {
      name: "revoked token",
      authorization: bearer(validMcpClaims({ jti: "revoked-mcp-token" })),
      expectedError: "revoked",
      config: { revokedTokenIds: ["revoked-mcp-token"] },
    },
    {
      name: "wrong issuer token",
      authorization: bearer(
        validMcpClaims({ iss: "https://issuer.example.test" }),
      ),
      expectedError: "wrong-issuer",
    },
    {
      name: "wrong audience token",
      authorization: bearer(validMcpClaims({ aud: "fitness-api" })),
      expectedError: "wrong-audience",
    },
    {
      name: "wrong resource token",
      authorization: bearer(
        validMcpClaims({ resource: "https://api.fitness.local" }),
      ),
      expectedError: "wrong-resource",
    },
  ])(
    "rejects $name with a protected resource metadata challenge",
    async ({ authorization, expectedError, config }) => {
      const response = await requestProtectedMcpRoute(authorization, config);

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(
        expectedMcpErrorChallenge("invalid_token"),
      );
      await expect(response.json()).resolves.toEqual({ error: expectedError });
    },
  );

  it.each([
    {
      name: "missing first-slice read scope",
      scope: "health:read coach:read meal:write",
    },
    {
      name: "deferred MCP write scope",
      scope: `health:read coach:read report:read meal:write ${DEFERRED_MCP_WRITE_SCOPES[0]}`,
    },
    {
      name: "health sync scope",
      scope: `health:read coach:read report:read meal:write ${HEALTH_SYNC_SCOPES[0]}`,
    },
  ])("rejects $name before reaching an MCP route", async ({ scope }) => {
    const response = await requestProtectedMcpRoute(
      bearer(validMcpClaims({ scope })),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toBe(
      expectedMcpErrorChallenge("insufficient_scope"),
    );
    await expect(response.json()).resolves.toEqual({ error: "missing-scope" });
  });

  it("rejects fake MCP tokens in production even if the override flag is set", async () => {
    const authorization = bearer(validMcpClaims());

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_FAKE_AUTH_TOKENS", "1");

    const response = await requestProtectedMcpRoute(authorization);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      expectedMcpErrorChallenge("invalid_token"),
    );
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });
});
