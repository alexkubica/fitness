import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FITNESS_WEB_SESSION_COOKIE,
  buildFitnessJwks,
  generateFitnessJwtKeyPair,
  verifyFitnessWebSession,
  verifyFitnessJwt,
} from "@fitness/auth";
import { createApp } from "../app.js";
import { createAuditService } from "../services/audit.js";
import {
  createTelegramLinkingService,
  type TelegramLinkingService,
} from "../telegram/linking.js";
import type {
  GoogleIdentity,
  GoogleTokenExchangeInput,
} from "../auth/google.js";
import type { OAuthTokenResponse } from "../oauth/service.js";

const nowSeconds = 1_800_000_000;
const issuer = "https://fitness.example.test";
const resource = "https://fitness.example.test/mcp";
const audience = "fitness-mcp";
const clientId = "fitness-chatgpt";
const redirectUri = "https://chatgpt.example.test/oauth/callback";
const scope = "health:read coach:read report:read";
const codeVerifier = "fitness-code-verifier-1234567890";
const googleAuthEndpoint = "https://accounts.example.test/o/oauth2/v2/auth";
const stateSecret = "test-google-state-secret-012345678901234567890123456789";

async function appWithGoogle(identity: Partial<GoogleIdentity> = {}): Promise<{
  app: ReturnType<typeof createApp>;
  audit: ReturnType<typeof createAuditService>;
  jwks: ReturnType<typeof buildFitnessJwks>;
  linking: TelegramLinkingService;
}> {
  const keyPair = await generateFitnessJwtKeyPair({ keyId: "google-oauth-1" });
  const audit = createAuditService({
    now: () => new Date(nowSeconds * 1_000),
  });
  const linking = createTelegramLinkingService({
    now: () => new Date(nowSeconds * 1_000),
    randomToken: () => "link-token-1",
  });
  const app = createApp({
    googleAuth: {
      allowedEmails: ["owner@example.com"],
      authorizationEndpoint: googleAuthEndpoint,
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
      exchangeCodeForIdToken(input: GoogleTokenExchangeInput) {
        expect(input.code).toBe("google-code");
        return Promise.resolve("google-id-token");
      },
      now: nowSeconds,
      redirectUri: `${issuer}/auth/google/callback`,
      stateSecret,
      tokenEndpoint: "https://oauth2.example.test/token",
      verifyIdToken() {
        return Promise.resolve({
          userId: "user_alex",
          googleSubject: "google-subject-1",
          email: "owner@example.com",
          emailVerified: true,
          ...identity,
        });
      },
    },
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
      now: nowSeconds,
      clients: [
        {
          id: clientId,
          redirectUris: [redirectUri],
        },
      ],
    },
    services: {
      audit,
      telegramLinking: linking,
    },
    telegram: {
      botUsername: "fitness_coach_bot",
    },
  });

  return { app, audit, jwks: buildFitnessJwks([keyPair.publicJwk]), linking };
}

describe("Google-authenticated account linking", () => {
  it("creates a short-lived Telegram link command after allowed Google sign-in", async () => {
    const harness = await appWithGoogle();

    const start = await harness.app.request("/telegram/link");

    expect(start.status).toBe(302);
    expect(start.headers.get("location")).toBe(
      "/auth/google/start?flow=telegram-link",
    );

    const googleStart = await harness.app.request(
      "/auth/google/start?flow=telegram-link",
    );
    const googleUrl = new URL(googleStart.headers.get("location") ?? "");
    const state = googleUrl.searchParams.get("state") ?? "";
    const cookie = cookieForRequest(googleStart.headers.get("set-cookie"));

    expect(googleStart.status).toBe(302);
    expect(googleUrl.origin + googleUrl.pathname).toBe(googleAuthEndpoint);
    expect(googleUrl.searchParams.get("client_id")).toBe("google-client-id");
    expect(googleUrl.searchParams.get("scope")).toBe("openid email profile");
    expect(cookie).toContain("fitness_google_state=");

    const callback = await harness.app.request(
      `/auth/google/callback?code=google-code&state=${encodeURIComponent(state)}`,
      {
        headers: {
          cookie,
          "x-forwarded-proto": "https",
        },
      },
    );
    const body = await callback.text();
    const command = commandFromBody(body);
    const startUrl = telegramStartUrlFromBody(body);

    expect(callback.status).toBe(200);
    expect(command).toBe("/link link-token-1");
    expect(startUrl).toBe("https://t.me/fitness_coach_bot?start=link-token-1");
    expect(body).not.toContain("google-id-token");
    expect(
      harness.linking.consumeOpaqueLinkToken({
        token: tokenFromTelegramStartUrl(startUrl),
        telegramUserId: 12_345,
      }),
    ).toMatchObject({
      ok: true,
      account: {
        userId: "user_alex",
        telegramUserId: 12_345,
      },
    });
    expect(harness.audit.list().map((event) => event.action)).toEqual([
      "auth.google.login",
      "telegram.link_token.create",
    ]);
  });

  it("rejects tampered callback state before creating a link token", async () => {
    const { app, audit } = await appWithGoogle();
    const googleStart = await app.request(
      "/auth/google/start?flow=telegram-link",
    );
    const googleUrl = new URL(googleStart.headers.get("location") ?? "");
    const cookie = cookieForRequest(googleStart.headers.get("set-cookie"));

    const callback = await app.request(
      `/auth/google/callback?code=google-code&state=${encodeURIComponent(`${googleUrl.searchParams.get("state") ?? ""}.tampered`)}`,
      {
        headers: {
          cookie,
        },
      },
    );

    expect(callback.status).toBe(400);
    expect(audit.list()).toEqual([]);
  });

  it("rejects Google accounts outside the allowed email list", async () => {
    const { app, audit } = await appWithGoogle({
      email: "someone@example.com",
    });
    const googleStart = await app.request(
      "/auth/google/start?flow=telegram-link",
    );
    const googleUrl = new URL(googleStart.headers.get("location") ?? "");
    const cookie = cookieForRequest(googleStart.headers.get("set-cookie"));

    const callback = await app.request(
      `/auth/google/callback?code=google-code&state=${encodeURIComponent(googleUrl.searchParams.get("state") ?? "")}`,
      {
        headers: {
          cookie,
        },
      },
    );

    expect(callback.status).toBe(403);
    expect(audit.list()).toEqual([]);
  });
});

describe("Google-authenticated web dashboard sessions", () => {
  it("creates a signed web session and clears the temporary Google state cookie", async () => {
    const harness = await appWithGoogle();
    const googleStart = await harness.app.request(
      "/auth/google/start?flow=web-dashboard&return_to=/mcp-setup",
    );
    const googleUrl = new URL(googleStart.headers.get("location") ?? "");
    const state = googleUrl.searchParams.get("state") ?? "";
    const cookie = cookieForRequest(googleStart.headers.get("set-cookie"));

    const callback = await harness.app.request(
      `/auth/google/callback?code=google-code&state=${encodeURIComponent(state)}`,
      {
        headers: {
          cookie,
          "x-forwarded-proto": "https",
        },
      },
    );
    const setCookies = setCookieHeaders(callback.headers);
    const setCookie = setCookies.join("\n");
    const webSessionToken = cookieValueFromSetCookie(
      setCookie,
      FITNESS_WEB_SESSION_COOKIE,
    );

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/mcp-setup");
    expect(
      setCookies.some((cookie) =>
        cookie.includes(`${FITNESS_WEB_SESSION_COOKIE}=`),
      ),
    ).toBe(true);
    expect(
      setCookies.some((cookie) => cookie.includes("fitness_google_state=")),
    ).toBe(true);
    expect(setCookie).toContain("Secure");
    expect(
      verifyFitnessWebSession({
        token: webSessionToken,
        secret: stateSecret,
      }),
    ).toMatchObject({
      email: "owner@example.com",
      userId: "user_alex",
    });
    expect(harness.audit.list().map((event) => event.action)).toEqual([
      "auth.google.login",
      "auth.web_session.create",
    ]);
  });
});

describe("Google-authenticated MCP OAuth approval", () => {
  it("creates an OAuth authorization code without the private login code", async () => {
    const harness = await appWithGoogle();
    const googleStart = await harness.app.request(
      `/auth/google/start?${oauthStartParams().toString()}`,
    );
    const googleUrl = new URL(googleStart.headers.get("location") ?? "");
    const state = googleUrl.searchParams.get("state") ?? "";
    const cookie = cookieForRequest(googleStart.headers.get("set-cookie"));

    const callback = await harness.app.request(
      `/auth/google/callback?code=google-code&state=${encodeURIComponent(state)}`,
      {
        headers: {
          cookie,
        },
      },
    );
    const callbackUrl = new URL(callback.headers.get("location") ?? "");
    const code = callbackUrl.searchParams.get("code") ?? "";

    expect(callback.status).toBe(302);
    expect(callbackUrl.origin + callbackUrl.pathname).toBe(redirectUri);
    expect(callbackUrl.searchParams.get("state")).toBe("connector-state-1");
    expect(code).toMatch(/^[A-Za-z0-9_-]{43,}$/u);

    const tokenResponse = await harness.app.request("/oauth2/token", {
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
      }),
    });
    const tokenBody = (await tokenResponse.json()) as OAuthTokenResponse;

    expect(tokenResponse.status).toBe(200);
    await expect(
      verifyFitnessJwt(tokenBody.access_token, {
        issuer,
        audience,
        jwks: harness.jwks,
        now: nowSeconds,
      }),
    ).resolves.toMatchObject({
      sub: "user_alex",
      resource,
      scope,
    });
    expect(harness.audit.list().map((event) => event.action)).toEqual([
      "auth.google.login",
      "oauth.authorization_code.create",
      "oauth.token.issue",
    ]);
  });

  it("shows an actionable error when Google succeeds but the MCP client id is wrong", async () => {
    const harness = await appWithGoogle();
    const params = oauthStartParams();
    params.set(
      "client_id",
      "760047293814-7cdlh837t377uaj38suoa9f16151oo59.apps.googleusercontent.com",
    );
    const googleStart = await harness.app.request(
      `/auth/google/start?${params.toString()}`,
    );
    const googleUrl = new URL(googleStart.headers.get("location") ?? "");
    const state = googleUrl.searchParams.get("state") ?? "";
    const cookie = cookieForRequest(googleStart.headers.get("set-cookie"));

    const callback = await harness.app.request(
      `/auth/google/callback?code=google-code&state=${encodeURIComponent(state)}`,
      {
        headers: {
          cookie,
        },
      },
    );
    const body = await callback.text();

    expect(callback.status).toBe(400);
    expect(body).toContain("Unknown MCP OAuth client");
    expect(body).toContain("fitness-chatgpt");
    expect(body).toContain("Do not use the Google OAuth client ID");
  });

  it("shows a Google authorization option on the MCP authorization page", async () => {
    const { app } = await appWithGoogle();
    const response = await app.request(
      `/oauth2/authorize?${authorizationParams().toString()}`,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Connect Fitness Coach");
    expect(body).toContain("Continue with Google");
    expect(body).toContain("/auth/google/start?flow=oauth-authorize");
    expect(body).toContain("Health summaries");
    expect(body).not.toContain("Private login code");
    expect(body).not.toContain('name="login_code"');
  });
});

function oauthStartParams(): URLSearchParams {
  const params = authorizationParams();
  params.set("flow", "oauth-authorize");

  return params;
}

function authorizationParams(): URLSearchParams {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    resource,
    scope,
    state: "connector-state-1",
    code_challenge: pkceChallenge(codeVerifier),
    code_challenge_method: "S256",
  });
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function cookieForRequest(setCookie: string | null): string {
  return setCookie?.split(";")[0] ?? "";
}

function commandFromBody(body: string): string {
  const match = /\/link\s+[A-Za-z0-9_-]+/u.exec(body);

  if (match === null) {
    throw new Error("link command was not rendered");
  }

  return match[0];
}

function telegramStartUrlFromBody(body: string): string {
  const match =
    /https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\?start=[A-Za-z0-9_-]+/u.exec(body);

  if (match === null) {
    throw new Error("Telegram start URL was not rendered");
  }

  return match[0];
}

function tokenFromTelegramStartUrl(value: string): string {
  return new URL(value).searchParams.get("start") ?? "";
}

function cookieValueFromSetCookie(setCookie: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`${escapedName}=([^;,]+)`, "u").exec(setCookie);

  if (match?.[1] === undefined) {
    throw new Error(`Cookie ${name} was not set.`);
  }

  return decodeURIComponent(match[1]);
}

function setCookieHeaders(headers: Headers): readonly string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] })
    .getSetCookie;

  if (getSetCookie !== undefined) {
    return getSetCookie.call(headers);
  }

  const value = headers.get("set-cookie");

  return value === null ? [] : [value];
}
