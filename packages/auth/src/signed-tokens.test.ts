import { describe, expect, it } from "vitest";
import {
  buildFitnessJwks,
  generateFitnessJwtKeyPair,
  signFitnessJwt,
  parseFitnessJwksJson,
  verifyFitnessJwt,
  type FitnessTokenClaims,
} from "./index.js";

const nowSeconds = 1_800_000_000;

function validClaims(
  overrides: Partial<FitnessTokenClaims> = {},
): FitnessTokenClaims {
  return {
    iss: "https://fitness-coach.example",
    aud: "fitness-api",
    resource: "https://fitness-coach.example",
    sub: "user_alex",
    exp: nowSeconds + 300,
    iat: nowSeconds - 30,
    scope: "health:write",
    jti: "signed-token-1",
    ...overrides,
  };
}

describe("signed JWT helpers", () => {
  it("signs and verifies RS256 fitness tokens with an explicit key id", async () => {
    const keyPair = await generateFitnessJwtKeyPair({ keyId: "test-key-1" });
    const token = await signFitnessJwt(validClaims(), {
      keyId: keyPair.keyId,
      privateJwk: keyPair.privateJwk,
      now: nowSeconds,
    });

    const verifiedClaims = await verifyFitnessJwt(token, {
      jwks: buildFitnessJwks([keyPair.publicJwk]),
      issuer: "https://fitness-coach.example",
      audience: "fitness-api",
      now: nowSeconds,
    });

    expect(verifiedClaims).toEqual(validClaims());
  });

  it("rejects tokens signed by an untrusted key", async () => {
    const trustedKeyPair = await generateFitnessJwtKeyPair({
      keyId: "trusted-key",
    });
    const untrustedKeyPair = await generateFitnessJwtKeyPair({
      keyId: "untrusted-key",
    });
    const token = await signFitnessJwt(validClaims(), {
      keyId: untrustedKeyPair.keyId,
      privateJwk: untrustedKeyPair.privateJwk,
      now: nowSeconds,
    });

    await expect(
      verifyFitnessJwt(token, {
        jwks: buildFitnessJwks([trustedKeyPair.publicJwk]),
        issuer: "https://fitness-coach.example",
        audience: "fitness-api",
        now: nowSeconds,
      }),
    ).rejects.toThrow(/signature|key|verify/i);
  });

  it("rejects malformed signed token input", async () => {
    const keyPair = await generateFitnessJwtKeyPair({ keyId: "test-key-1" });

    await expect(
      verifyFitnessJwt("not-a-jwt", {
        jwks: buildFitnessJwks([keyPair.publicJwk]),
        issuer: "https://fitness-coach.example",
        audience: "fitness-api",
        now: nowSeconds,
      }),
    ).rejects.toThrow(/malformed|jwt/i);
  });

  it("parses JWKS JSON for environment-backed verifier configuration", async () => {
    const keyPair = await generateFitnessJwtKeyPair({ keyId: "env-key-1" });
    const jwks = buildFitnessJwks([keyPair.publicJwk]);

    expect(parseFitnessJwksJson(JSON.stringify(jwks))).toEqual(jwks);
    expect(() => parseFitnessJwksJson("{")).toThrow(/jwks/i);
    expect(() => parseFitnessJwksJson('{"keys":"wrong"}')).toThrow(/jwks/i);
  });
});
