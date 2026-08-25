import { describe, expect, it } from "vitest";
import {
  MCP_CONNECTOR_SCOPES,
  buildFitnessJwks,
  generateFitnessJwtKeyPair,
  runIssueFitnessTokenCli,
  verifyFitnessJwt,
} from "./index.js";

const nowSeconds = 1_800_000_000;

describe("issue-token CLI", () => {
  it("issues a raw HealthKit token from FITNESS_AUTH_PRIVATE_JWK without printing key material", async () => {
    const keyPair = await generateFitnessJwtKeyPair({ keyId: "test-key-1" });
    let stdout = "";
    let stderr = "";

    const result = await runIssueFitnessTokenCli({
      argv: [
        "--profile",
        "healthkit",
        "--ttl-seconds",
        "120",
        "--token-id",
        "cli-healthkit-token-1",
        "--now",
        String(nowSeconds),
        "--raw",
      ],
      env: {
        FITNESS_AUTH_PRIVATE_JWK: JSON.stringify(keyPair.privateJwk),
        HEALTH_SYNC_TOKEN_ISSUER: "https://coach.example.test",
        HEALTH_SYNC_TOKEN_AUDIENCE: "fitness-api-production",
        HEALTH_SYNC_TOKEN_RESOURCE: "https://coach.example.test",
        HEALTH_SYNC_EXPECTED_SUBJECT: "user_alex",
      },
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    });

    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).not.toContain(JSON.stringify(keyPair.privateJwk));
    expect(stdout).not.toContain(keyPair.privateJwk.d);

    const token = stdout.trim();
    const verifiedClaims = await verifyFitnessJwt(token, {
      audience: "fitness-api-production",
      issuer: "https://coach.example.test",
      jwks: buildFitnessJwks([keyPair.publicJwk]),
      now: nowSeconds,
    });

    expect(verifiedClaims).toEqual({
      iss: "https://coach.example.test",
      aud: "fitness-api-production",
      resource: "https://coach.example.test",
      sub: "user_alex",
      iat: nowSeconds,
      exp: nowSeconds + 120,
      scope: "health:write",
      jti: "cli-healthkit-token-1",
    });
  });

  it("reads the private JWK from Keychain service env and writes JSON output", async () => {
    const keyPair = await generateFitnessJwtKeyPair({ keyId: "test-key-1" });
    let stdout = "";
    let stderr = "";
    let requestedService = "";

    const result = await runIssueFitnessTokenCli({
      argv: [
        "--profile",
        "mcp",
        "--issuer",
        "https://auth.example.test",
        "--resource",
        "https://coach.example.test/mcp",
        "--ttl-seconds",
        "180",
        "--token-id",
        "cli-mcp-token-1",
        "--now",
        String(nowSeconds),
        "--json",
      ],
      env: {
        FITNESS_AUTH_PRIVATE_JWK_KEYCHAIN_SERVICE: "fitness-auth-private-jwk",
        MCP_AUDIENCE: "fitness-mcp-production",
        MCP_EXPECTED_SUBJECT: "user_alex",
      },
      readKeychainGenericPassword: async (service) => {
        requestedService = service;
        return JSON.stringify(keyPair.privateJwk);
      },
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    });

    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(requestedService).toBe("fitness-auth-private-jwk");
    expect(stdout).not.toContain(JSON.stringify(keyPair.privateJwk));
    expect(stdout).not.toContain(keyPair.privateJwk.d);

    const payload = JSON.parse(stdout) as {
      accessToken: string;
      tokenType: string;
      profile: string;
      expiresAt: string;
      scopes: readonly string[];
    };
    expect(payload).toMatchObject({
      tokenType: "Bearer",
      profile: "mcp",
      expiresAt: "2027-01-15T08:03:00.000Z",
      scopes: MCP_CONNECTOR_SCOPES,
    });

    await expect(
      verifyFitnessJwt(payload.accessToken, {
        audience: "fitness-mcp-production",
        issuer: "https://auth.example.test",
        jwks: buildFitnessJwks([keyPair.publicJwk]),
        now: nowSeconds,
      }),
    ).resolves.toEqual({
      iss: "https://auth.example.test",
      aud: "fitness-mcp-production",
      resource: "https://coach.example.test/mcp",
      sub: "user_alex",
      iat: nowSeconds,
      exp: nowSeconds + 180,
      scope: MCP_CONNECTOR_SCOPES.join(" "),
      jti: "cli-mcp-token-1",
    });
  });

  it("uses explicit approved scopes from repeated --scope arguments", async () => {
    const keyPair = await generateFitnessJwtKeyPair({ keyId: "test-key-1" });
    let stdout = "";
    let stderr = "";

    const result = await runIssueFitnessTokenCli({
      argv: [
        "--profile",
        "mcp",
        "--scope",
        "health:read",
        "--ttl-seconds",
        "60",
        "--now",
        String(nowSeconds),
        "--json",
      ],
      env: {
        FITNESS_AUTH_PRIVATE_JWK: JSON.stringify(keyPair.privateJwk),
      },
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    });

    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");

    const payload = JSON.parse(stdout) as {
      accessToken: string;
      scopes: readonly string[];
    };
    expect(payload.scopes).toEqual(["health:read"]);

    await expect(
      verifyFitnessJwt(payload.accessToken, {
        audience: "fitness-mcp",
        issuer: "https://mcp.fitness.local",
        jwks: buildFitnessJwks([keyPair.publicJwk]),
        now: nowSeconds,
      }),
    ).resolves.toMatchObject({
      scope: "health:read",
    });
  });
});
