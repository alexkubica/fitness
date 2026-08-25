import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildFitnessJwks,
  generateFitnessJwtKeyPair,
  verifyFitnessJwt,
} from "@fitness/auth";
import { createApp } from "../app.js";
import { createAuditService } from "../services/audit.js";
import type { OAuthTokenResponse } from "./service.js";

const nowSeconds = 1_800_000_000;
const issuer = "https://fitness.example.test";
const resource = "https://fitness.example.test/mcp";
const audience = "fitness-mcp";
const healthAudience = "fitness-api";
const clientId = "fitness-chatgpt";
const healthClientId = "fitness-ios-bootstrap";
const redirectUri = "https://chatgpt.example.test/oauth/callback";
const healthRedirectUri = "fitnesscoach://oauth/callback";
const scope = "health:read coach:read report:read meal:write coach:write";
const healthScope = "health:sync";
const healthSyncMealCoachScope = "health:sync meal:write coach:write";
const codeVerifier = "fitness-code-verifier-1234567890";

function authorizationParams(
  overrides: Record<string, string> = {},
): URLSearchParams {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    resource,
    scope,
    state: "state-1",
    code_challenge: pkceChallenge(codeVerifier),
    code_challenge_method: "S256",
    ...overrides,
  });
}

async function appWithOAuth() {
  const keyPair = await generateFitnessJwtKeyPair({ keyId: "oauth-key-1" });
  const audit = createAuditService();
  const app = createApp({
    mcp: {
      issuer,
      resource,
      audience,
      trustedJwks: buildFitnessJwks([keyPair.publicJwk]),
      now: nowSeconds,
    },
    oauth: {
      issuer,
      audience,
      privateJwk: keyPair.privateJwk,
      privateLoginCode: "private-login-code",
      now: nowSeconds,
      clients: [
        {
          id: "fitness-local-smoke",
          redirectUris: ["http://127.0.0.1:53682/oauth/callback"],
        },
        {
          id: clientId,
          redirectUris: [redirectUri],
        },
        {
          id: healthClientId,
          redirectUris: [healthRedirectUri],
        },
      ],
    },
    auth: {
      expectedAudience: healthAudience,
      expectedIssuer: issuer,
      expectedResource: issuer,
      now: nowSeconds,
    },
    services: {
      audit,
    },
  });

  return { app, audit, jwks: buildFitnessJwks([keyPair.publicJwk]) };
}

describe("OAuth authorization-code flow", () => {
  it("exchanges a private-login authorization code for a signed MCP access token", async () => {
    const { app, audit, jwks } = await appWithOAuth();
    const authorizeBody = authorizationParams();
    authorizeBody.set("login_code", "private-login-code");

    const authorizeResponse = await app.request("/oauth2/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: authorizeBody.toString(),
    });

    expect(authorizeResponse.status).toBe(302);
    const redirectLocation = authorizeResponse.headers.get("location");
    expect(redirectLocation).toMatch(/^https:/u);
    const callbackUrl = new URL(redirectLocation ?? "");
    const code = callbackUrl.searchParams.get("code");

    expect(callbackUrl.origin + callbackUrl.pathname).toBe(redirectUri);
    expect(callbackUrl.searchParams.get("state")).toBe("state-1");
    expect(code).toMatch(/^[A-Za-z0-9_-]{43,}$/u);

    const tokenResponse = await app.request("/oauth2/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code: code ?? "",
        code_verifier: codeVerifier,
      }).toString(),
    });

    expect(tokenResponse.status).toBe(200);
    const tokenBody = (await tokenResponse.json()) as OAuthTokenResponse;

    expect(tokenBody).toMatchObject({
      token_type: "Bearer",
      expires_in: 300,
      scope,
    });
    expect(tokenBody.access_token).toEqual(expect.any(String));
    expect(tokenBody.refresh_token).toEqual(expect.any(String));

    await expect(
      verifyFitnessJwt(tokenBody.access_token as string, {
        issuer,
        audience,
        jwks,
        now: nowSeconds,
      }),
    ).resolves.toMatchObject({
      iss: issuer,
      aud: audience,
      resource,
      sub: "user_alex",
      scope,
    });

    expect(audit.list().map((event) => event.action)).toEqual([
      "oauth.authorization_code.create",
      "oauth.token.issue",
    ]);
  });

  it("accepts public Basic auth client id during authorization-code exchange", async () => {
    const { app } = await appWithOAuth();
    const authorizeBody = authorizationParams();
    authorizeBody.set("login_code", "private-login-code");

    const authorizeResponse = await app.request("/oauth2/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: authorizeBody.toString(),
    });
    const code =
      new URL(authorizeResponse.headers.get("location") ?? "").searchParams.get(
        "code",
      ) ?? "";

    const tokenResponse = await app.request("/oauth2/token", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
        code_verifier: codeVerifier,
      }).toString(),
    });

    expect(tokenResponse.status).toBe(200);
    await expect(tokenResponse.json()).resolves.toMatchObject({
      token_type: "Bearer",
      scope,
    });
  });

  it("shows a connector setup error before login when the client id is unknown", async () => {
    const { app } = await appWithOAuth();
    const response = await app.request(
      `/oauth2/authorize?${authorizationParams({
        client_id:
          "760047293814-7cdlh837t377uaj38suoa9f16151oo59.apps.googleusercontent.com",
      }).toString()}`,
    );
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain("Unknown OAuth Client");
    expect(body).toContain("fitness-chatgpt");
    expect(body).toContain("Do not paste the Google OAuth client ID");
    expect(body).not.toContain("Continue with Google");
  });

  it("shows a connector setup error before login when the callback is unregistered", async () => {
    const { app } = await appWithOAuth();
    const response = await app.request(
      `/oauth2/authorize?${authorizationParams({
        redirect_uri: "https://chatgpt.com/connector/oauth/new-callback",
      }).toString()}`,
    );
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain("Unregistered Connector Callback");
    expect(body).toContain("OAUTH_CLIENTS_JSON");
    expect(body).not.toContain("Continue with Google");
  });

  it("rejects conflicting public Basic and form client ids", async () => {
    const { app } = await appWithOAuth();

    const response = await app.request("/oauth2/token", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${healthClientId}:`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
      }).toString(),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_client",
    });
  });

  it("rejects authorization-code replay and bad PKCE verifiers", async () => {
    const { app } = await appWithOAuth();
    const authorizeBody = authorizationParams();
    authorizeBody.set("login_code", "private-login-code");
    const authorizeResponse = await app.request("/oauth2/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: authorizeBody.toString(),
    });
    const code =
      new URL(authorizeResponse.headers.get("location") ?? "").searchParams.get(
        "code",
      ) ?? "";

    const badPkceResponse = await app.request("/oauth2/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code,
        code_verifier: "wrong-verifier",
      }).toString(),
    });

    expect(badPkceResponse.status).toBe(400);
    await expect(badPkceResponse.json()).resolves.toMatchObject({
      error: "invalid_grant",
    });

    const replayResponse = await app.request("/oauth2/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code,
        code_verifier: codeVerifier,
      }).toString(),
    });

    expect(replayResponse.status).toBe(400);
    await expect(replayResponse.json()).resolves.toMatchObject({
      error: "invalid_grant",
    });
  });

  it("rotates refresh tokens and rejects reuse", async () => {
    const { app, audit } = await appWithOAuth();
    const authorizeBody = authorizationParams();
    authorizeBody.set("login_code", "private-login-code");
    const authorizeResponse = await app.request("/oauth2/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: authorizeBody.toString(),
    });
    const code =
      new URL(authorizeResponse.headers.get("location") ?? "").searchParams.get(
        "code",
      ) ?? "";
    const tokenResponse = await app.request("/oauth2/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code,
        code_verifier: codeVerifier,
      }).toString(),
    });
    const tokenBody = (await tokenResponse.json()) as OAuthTokenResponse;

    const refreshResponse = await app.request("/oauth2/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: tokenBody.refresh_token as string,
      }).toString(),
    });

    expect(refreshResponse.status).toBe(200);
    const refreshBody = (await refreshResponse.json()) as OAuthTokenResponse;

    expect(refreshBody.refresh_token).toEqual(expect.any(String));
    expect(refreshBody.refresh_token).not.toBe(tokenBody.refresh_token);
    expect(audit.list().map((event) => event.action)).toEqual([
      "oauth.authorization_code.create",
      "oauth.token.issue",
      "oauth.refresh.rotate",
    ]);

    const reuseResponse = await app.request("/oauth2/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: tokenBody.refresh_token as string,
      }).toString(),
    });

    expect(reuseResponse.status).toBe(400);
    await expect(reuseResponse.json()).resolves.toMatchObject({
      error: "invalid_grant",
    });
  });

  it("rejects deferred MCP write scopes at authorization time", async () => {
    const { app } = await appWithOAuth();
    const authorizeBody = authorizationParams({
      scope: "health:read writeback:prepare",
    });
    authorizeBody.set("login_code", "private-login-code");

    const response = await app.request("/oauth2/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: authorizeBody.toString(),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_scope",
    });
  }, 10_000);

  it("issues HealthKit sync tokens for the iOS bootstrap client", async () => {
    const { app, jwks } = await appWithOAuth();
    const authorizeBody = authorizationParams({
      client_id: healthClientId,
      redirect_uri: healthRedirectUri,
      resource: issuer,
      scope: healthScope,
    });
    authorizeBody.set("login_code", "private-login-code");

    const authorizeResponse = await app.request("/oauth2/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: authorizeBody.toString(),
    });
    const code =
      new URL(authorizeResponse.headers.get("location") ?? "").searchParams.get(
        "code",
      ) ?? "";

    const tokenResponse = await app.request("/oauth2/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: healthClientId,
        redirect_uri: healthRedirectUri,
        code,
        code_verifier: codeVerifier,
      }).toString(),
    });

    expect(tokenResponse.status).toBe(200);
    const tokenBody = (await tokenResponse.json()) as OAuthTokenResponse;

    expect(tokenBody).toMatchObject({
      token_type: "Bearer",
      expires_in: 300,
      scope: healthScope,
    });

    await expect(
      verifyFitnessJwt(tokenBody.access_token, {
        issuer,
        audience: healthAudience,
        jwks,
        now: nowSeconds,
      }),
    ).resolves.toMatchObject({
      iss: issuer,
      aud: healthAudience,
      resource: issuer,
      sub: "user_alex",
      scope: healthScope,
    });
  });

  it("issues combined HealthKit, meal-write, and coach-write tokens for the iOS app", async () => {
    const { app, jwks } = await appWithOAuth();
    const authorizeBody = authorizationParams({
      client_id: healthClientId,
      redirect_uri: healthRedirectUri,
      resource: issuer,
      scope: healthSyncMealCoachScope,
    });
    authorizeBody.set("login_code", "private-login-code");

    const authorizeResponse = await app.request("/oauth2/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: authorizeBody.toString(),
    });
    const code =
      new URL(authorizeResponse.headers.get("location") ?? "").searchParams.get(
        "code",
      ) ?? "";

    const tokenResponse = await app.request("/oauth2/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: healthClientId,
        redirect_uri: healthRedirectUri,
        code,
        code_verifier: codeVerifier,
      }).toString(),
    });

    expect(tokenResponse.status).toBe(200);
    const tokenBody = (await tokenResponse.json()) as OAuthTokenResponse;

    expect(tokenBody).toMatchObject({
      token_type: "Bearer",
      expires_in: 300,
      scope: healthSyncMealCoachScope,
    });

    await expect(
      verifyFitnessJwt(tokenBody.access_token, {
        issuer,
        audience: healthAudience,
        jwks,
        now: nowSeconds,
      }),
    ).resolves.toMatchObject({
      iss: issuer,
      aud: healthAudience,
      resource: issuer,
      sub: "user_alex",
      scope: healthSyncMealCoachScope,
    });
  });

  it("rejects MCP read scopes for the HealthKit sync resource", async () => {
    const { app } = await appWithOAuth();
    const authorizeBody = authorizationParams({
      client_id: healthClientId,
      redirect_uri: healthRedirectUri,
      resource: issuer,
      scope,
    });
    authorizeBody.set("login_code", "private-login-code");

    const response = await app.request("/oauth2/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: authorizeBody.toString(),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_scope",
    });
  });
});

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
