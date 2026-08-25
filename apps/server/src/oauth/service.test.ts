import { describe, expect, it } from "vitest";
import { resolveMcpOAuthConfig } from "../mcp/oauth-metadata.js";
import { resolveOAuthRouteConfig } from "./service.js";

describe("OAuth route configuration", () => {
  it("reads bounded token lifetimes from environment variables", () => {
    const config = resolveOAuthRouteConfig(
      {},
      resolveMcpOAuthConfig(),
      undefined,
      {
        OAUTH_ACCESS_TOKEN_TTL_SECONDS: "3600",
        OAUTH_AUTHORIZATION_CODE_TTL_SECONDS: "600",
        OAUTH_REFRESH_TOKEN_TTL_SECONDS: "31536000",
      },
    );

    expect(config.accessTokenTtlSeconds).toBe(3_600);
    expect(config.authorizationCodeTtlSeconds).toBe(600);
    expect(config.refreshTokenTtlSeconds).toBe(31_536_000);
  });

  it("rejects unsafe token lifetime environment values", () => {
    expect(() =>
      resolveOAuthRouteConfig({}, resolveMcpOAuthConfig(), undefined, {
        OAUTH_ACCESS_TOKEN_TTL_SECONDS: "999999999",
      }),
    ).toThrow(
      "OAUTH_ACCESS_TOKEN_TTL_SECONDS must be a positive integer no greater than 86400.",
    );
  });

  it("derives HealthKit issuer and resource from Vercel production URL", () => {
    const config = resolveOAuthRouteConfig(
      {},
      resolveMcpOAuthConfig(),
      undefined,
      {
        VERCEL_PROJECT_PRODUCTION_URL: "fitness-coach.vercel.app",
      },
    );

    expect(config.healthIssuer).toBe("https://fitness-coach.vercel.app");
    expect(config.healthResource).toBe("https://fitness-coach.vercel.app");
  });
});
