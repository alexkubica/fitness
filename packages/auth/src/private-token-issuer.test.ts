import { describe, expect, it } from "vitest";
import {
  MCP_CONNECTOR_SCOPES,
  buildFitnessJwks,
  generateFitnessJwtKeyPair,
  issueFitnessProfileToken,
  verifyFitnessJwt,
  type FitnessTokenClaims,
} from "./index.js";

const nowSeconds = 1_800_000_000;

describe("private token issuer", () => {
  it("issues an MCP token with connector scopes and local-safe defaults", async () => {
    const keyPair = await generateFitnessJwtKeyPair({ keyId: "test-key-1" });

    const issued = await issueFitnessProfileToken({
      profile: "mcp",
      privateJwk: keyPair.privateJwk,
      now: nowSeconds,
      ttlSeconds: 300,
      tokenId: "mcp-token-1",
    });

    const expectedClaims: FitnessTokenClaims = {
      iss: "https://mcp.fitness.local",
      aud: "fitness-mcp",
      resource: "https://mcp.fitness.local/mcp",
      sub: "user_alex",
      iat: nowSeconds,
      exp: nowSeconds + 300,
      scope: MCP_CONNECTOR_SCOPES.join(" "),
      jti: "mcp-token-1",
    };

    expect(issued.claims).toEqual(expectedClaims);
    await expect(
      verifyFitnessJwt(issued.token, {
        jwks: buildFitnessJwks([keyPair.publicJwk]),
        issuer: expectedClaims.iss,
        audience: expectedClaims.aud,
        now: nowSeconds,
      }),
    ).resolves.toEqual(expectedClaims);
  });

  it("issues a HealthKit API token with local-safe server defaults", async () => {
    const keyPair = await generateFitnessJwtKeyPair({ keyId: "test-key-1" });

    const issued = await issueFitnessProfileToken({
      profile: "healthkit",
      privateJwk: keyPair.privateJwk,
      now: nowSeconds,
      ttlSeconds: 120,
      tokenId: "healthkit-token-1",
    });

    const expectedClaims: FitnessTokenClaims = {
      iss: "https://auth.fitness.local",
      aud: "fitness-api",
      resource: "https://api.fitness.local",
      sub: "user_alex",
      iat: nowSeconds,
      exp: nowSeconds + 120,
      scope: "health:write",
      jti: "healthkit-token-1",
    };

    expect(issued.claims).toEqual(expectedClaims);
    await expect(
      verifyFitnessJwt(issued.token, {
        jwks: buildFitnessJwks([keyPair.publicJwk]),
        issuer: expectedClaims.iss,
        audience: expectedClaims.aud,
        now: nowSeconds,
      }),
    ).resolves.toEqual(expectedClaims);
  });

  it("rejects token TTLs outside short-lived bounds", async () => {
    const keyPair = await generateFitnessJwtKeyPair({ keyId: "test-key-1" });
    const baseOptions = {
      profile: "mcp" as const,
      privateJwk: keyPair.privateJwk,
      now: nowSeconds,
    };

    await expect(
      issueFitnessProfileToken({
        ...baseOptions,
        ttlSeconds: 0,
      }),
    ).rejects.toThrow(/ttl/i);
    await expect(
      issueFitnessProfileToken({
        ...baseOptions,
        ttlSeconds: 3_601,
      }),
    ).rejects.toThrow(/short-lived|ttl/i);
  });

  it("rejects scopes outside the selected token profile", async () => {
    const keyPair = await generateFitnessJwtKeyPair({ keyId: "test-key-1" });
    const baseOptions = {
      privateJwk: keyPair.privateJwk,
      now: nowSeconds,
    };

    await expect(
      issueFitnessProfileToken({
        ...baseOptions,
        profile: "mcp",
        scopes: ["health:write"],
      }),
    ).rejects.toThrow(/scope/i);
    await expect(
      issueFitnessProfileToken({
        ...baseOptions,
        profile: "healthkit",
        scopes: ["health:read"],
      }),
    ).rejects.toThrow(/scope/i);
  });

  it("allows meal-write on the MCP connector token profile", async () => {
    const keyPair = await generateFitnessJwtKeyPair({ keyId: "test-key-1" });

    const issued = await issueFitnessProfileToken({
      profile: "mcp",
      privateJwk: keyPair.privateJwk,
      scopes: ["health:read", "coach:read", "report:read", "meal:write"],
      now: nowSeconds,
    });

    expect(issued.claims.scope).toBe(
      "health:read coach:read report:read meal:write",
    );
  });

  it("allows meal-write on the iOS app token profile", async () => {
    const keyPair = await generateFitnessJwtKeyPair({ keyId: "test-key-1" });

    const issued = await issueFitnessProfileToken({
      profile: "healthkit",
      privateJwk: keyPair.privateJwk,
      scopes: ["health:sync", "meal:write"],
      now: nowSeconds,
    });

    expect(issued.claims.scope).toBe("health:sync meal:write");
  });
});
