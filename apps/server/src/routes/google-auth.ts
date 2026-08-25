import type { Context, Hono } from "hono";
import {
  issueFitnessWebSession,
  serializeFitnessWebSessionCookie,
} from "@fitness/auth";
import type {
  GoogleAuthConfig,
  GoogleOAuthAuthorizeState,
} from "../auth/google.js";
import {
  authenticateGoogleCallback,
  createGoogleAuthorizationStart,
  GoogleAuthError,
} from "../auth/google.js";
import type { ServerEnv } from "../auth.js";
import { createOAuthService, type OAuthRouteConfig } from "../oauth/service.js";
import type { OAuthStore } from "../oauth/store.js";
import type { AuditPort } from "../services/audit.js";
import type { AsyncTelegramLinkingService } from "../telegram/linking.js";

export type GoogleAuthRouteServices = Readonly<{
  audit: AuditPort;
  telegramBotUsername?: string | undefined;
  telegramLinking: AsyncTelegramLinkingService;
}>;

const GOOGLE_STATE_COOKIE = "fitness_google_state";

export function registerGoogleAuthRoutes(
  app: Hono<ServerEnv>,
  services: GoogleAuthRouteServices,
  oauthStore: OAuthStore,
  oauthConfig: OAuthRouteConfig,
  googleConfig: GoogleAuthConfig | undefined,
): void {
  const oauthService = createOAuthService(
    oauthStore,
    oauthConfig,
    services.audit,
  );

  app.get("/telegram/link", (context) => {
    if (googleConfig === undefined) {
      return context.html(renderGoogleUnavailable(), 503);
    }

    return context.redirect("/auth/google/start?flow=telegram-link", 302);
  });

  app.get("/auth/google/start", (context) => {
    if (googleConfig === undefined) {
      return context.html(renderGoogleUnavailable(), 503);
    }

    const params = new URL(context.req.url).searchParams;
    const flow = params.get("flow");

    if (
      flow !== "telegram-link" &&
      flow !== "oauth-authorize" &&
      flow !== "web-dashboard"
    ) {
      return context.html(renderAuthError("Unknown authentication flow."), 400);
    }

    const start = createGoogleAuthorizationStart(googleConfig, {
      flow,
      ...(flow === "oauth-authorize"
        ? { oauth: oauthAuthorizeState(params) }
        : {}),
      ...(flow === "web-dashboard"
        ? { returnTo: safeReturnPath(params.get("return_to")) }
        : {}),
    });

    context.header(
      "set-cookie",
      stateCookie(start.state, googleConfig, context),
    );

    return context.redirect(start.authorizationUrl, 302);
  });

  app.get("/auth/google/callback", async (context) => {
    if (googleConfig === undefined) {
      return context.html(renderGoogleUnavailable(), 503);
    }

    const params = new URL(context.req.url).searchParams;
    const result = await googleCallbackResult({
      audit: services.audit,
      context,
      googleConfig,
      oauthConfig,
      oauthService,
      params,
      telegramBotUsername: services.telegramBotUsername,
      telegramLinking: services.telegramLinking,
    });

    result.headers.append(
      "set-cookie",
      clearStateCookie(googleConfig, context),
    );

    return result;
  });
}

export function googleAuthorizeStartUrl(params: URLSearchParams): string {
  const startUrl = new URL("https://fitness.local/auth/google/start");

  startUrl.searchParams.set("flow", "oauth-authorize");

  for (const name of [
    "response_type",
    "client_id",
    "redirect_uri",
    "resource",
    "scope",
    "state",
    "code_challenge",
    "code_challenge_method",
  ]) {
    const value = params.get(name);

    if (value !== null) {
      startUrl.searchParams.set(name, value);
    }
  }

  return startUrl.pathname + startUrl.search;
}

async function googleCallbackResult(input: {
  audit: AuditPort;
  context: Context<ServerEnv>;
  googleConfig: GoogleAuthConfig;
  oauthConfig: OAuthRouteConfig;
  oauthService: ReturnType<typeof createOAuthService>;
  params: URLSearchParams;
  telegramBotUsername?: string | undefined;
  telegramLinking: AsyncTelegramLinkingService;
}): Promise<Response> {
  let callback;

  try {
    callback = await authenticateGoogleCallback(input.googleConfig, {
      code: optionalParam(input.params, "code"),
      state: optionalParam(input.params, "state"),
      expectedState: cookieValue(
        input.context.req.header("cookie"),
        GOOGLE_STATE_COOKIE,
      ),
    });
  } catch (error) {
    const status = error instanceof GoogleAuthError ? statusFor(error) : 401;

    return input.context.html(
      renderAuthError("Google sign-in was not accepted."),
      status,
    );
  }

  await input.audit.create({
    action: "auth.google.login",
    actor: {
      type: "user",
      id: callback.identity.userId,
    },
    target: {
      type: "google_account",
      id: callback.identity.googleSubject,
    },
    userId: callback.identity.userId,
    metadata: {
      email: callback.identity.email,
    },
  });

  if (callback.identity.userId !== input.oauthConfig.userId) {
    return input.context.html(
      renderAuthError("Account is not authorized."),
      403,
    );
  }

  if (callback.state.flow === "telegram-link") {
    const linkToken = await input.telegramLinking.createLinkToken({
      userId: callback.identity.userId,
      state: callback.state.csrf,
      nonce: callback.state.nonce,
    });

    await input.audit.create({
      action: "telegram.link_token.create",
      actor: {
        type: "user",
        id: callback.identity.userId,
      },
      target: {
        type: "telegram_link_token",
        id: callback.state.csrf,
      },
      userId: callback.identity.userId,
      metadata: {
        expiresAt: linkToken.expiresAt,
      },
    });

    return input.context.html(
      renderTelegramLinkCommand({
        command: `/link ${linkToken.token}`,
        expiresAt: linkToken.expiresAt,
        startUrl: telegramStartUrl(
          input.context.req.url,
          input.context.req.header("x-forwarded-proto"),
          input.context.req.header("host"),
          input.telegramBotUsername,
          linkToken.token,
        ),
      }),
    );
  }

  if (callback.state.flow === "web-dashboard") {
    const session = issueFitnessWebSession({
      userId: callback.identity.userId,
      email: callback.identity.email,
      secret: input.googleConfig.stateSecret,
      ttlSeconds: webSessionTtlSeconds(),
    });

    const response = input.context.redirect(
      callback.state.returnTo ?? "/",
      302,
    );

    response.headers.append(
      "set-cookie",
      serializeFitnessWebSessionCookie({
        token: session.token,
        maxAgeSeconds: session.maxAgeSeconds,
        secure: shouldUseSecureCookie(input.googleConfig, input.context),
      }),
    );

    await input.audit.create({
      action: "auth.web_session.create",
      actor: {
        type: "user",
        id: callback.identity.userId,
      },
      target: {
        type: "web_session",
        id: callback.state.csrf,
      },
      userId: callback.identity.userId,
      metadata: {
        expiresAt: new Date(session.session.expiresAt * 1_000).toISOString(),
      },
    });

    return response;
  }

  if (callback.state.oauth === undefined) {
    return input.context.html(
      renderAuthError("Missing OAuth request state."),
      400,
    );
  }

  const authorization = await input.oauthService.authorize({
    ...callback.state.oauth,
    loginCode: undefined,
    authenticatedUserId: callback.identity.userId,
  });

  if (authorization.ok === false) {
    const error = authorization;

    if (error.error.error === "invalid_client") {
      return input.context.html(
        renderAuthError(
          'Unknown MCP OAuth client. In ChatGPT connector settings, use client ID "fitness-chatgpt". Do not use the Google OAuth client ID.',
        ),
        error.status,
      );
    }

    if (
      error.error.error === "invalid_request" &&
      error.error.error_description?.includes("redirect_uri") === true
    ) {
      return input.context.html(
        renderAuthError(
          "This ChatGPT connector callback is not registered for Fitness Coach yet. Copy the callback URL from ChatGPT and add it to the Fitness Coach OAuth client registry.",
        ),
        error.status,
      );
    }

    return input.context.json(error.error, error.status);
  }

  return input.context.redirect(authorization.redirectTo, 302);
}

function safeReturnPath(value: string | null): string {
  if (value === null || value.length === 0) {
    return "/";
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}

function webSessionTtlSeconds(): number {
  const rawValue = process.env.WEB_SESSION_TTL_SECONDS;
  const parsed =
    rawValue === undefined || rawValue.length === 0
      ? Number.NaN
      : Number(rawValue);

  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : 30 * 24 * 60 * 60;
}

function oauthAuthorizeState(
  params: URLSearchParams,
): GoogleOAuthAuthorizeState {
  return {
    responseType: optionalParam(params, "response_type"),
    clientId: optionalParam(params, "client_id"),
    redirectUri: optionalParam(params, "redirect_uri"),
    resource: optionalParam(params, "resource"),
    scope: optionalParam(params, "scope"),
    state: optionalParam(params, "state"),
    codeChallenge: optionalParam(params, "code_challenge"),
    codeChallengeMethod: optionalParam(params, "code_challenge_method"),
  };
}

function optionalParam(
  params: URLSearchParams,
  name: string,
): string | undefined {
  const value = params.get(name);

  return value === null || value.length === 0 ? undefined : value;
}

function stateCookie(
  state: string,
  config: GoogleAuthConfig,
  context: Context<ServerEnv>,
): string {
  return serializeCookie({
    name: GOOGLE_STATE_COOKIE,
    value: state,
    maxAge: config.stateTtlSeconds,
    secure: shouldUseSecureCookie(config, context),
  });
}

function clearStateCookie(
  config: GoogleAuthConfig,
  context: Context<ServerEnv>,
): string {
  return serializeCookie({
    name: GOOGLE_STATE_COOKIE,
    value: "",
    maxAge: 0,
    secure: shouldUseSecureCookie(config, context),
  });
}

function serializeCookie(input: {
  name: string;
  value: string;
  maxAge: number;
  secure: boolean;
}): string {
  return [
    `${input.name}=${encodeURIComponent(input.value)}`,
    "Path=/auth/google/callback",
    `Max-Age=${input.maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(input.secure ? ["Secure"] : []),
  ].join("; ");
}

function shouldUseSecureCookie(
  config: GoogleAuthConfig,
  context: Context<ServerEnv>,
): boolean {
  return (
    config.redirectUri.startsWith("https://") ||
    context.req.header("x-forwarded-proto") === "https"
  );
}

function cookieValue(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (cookieHeader === undefined) {
    return undefined;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = part.trim().split("=");

    if (rawName === name) {
      const rawValue = rawValueParts.join("=");

      try {
        return decodeURIComponent(rawValue);
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

function statusFor(error: GoogleAuthError): 400 | 401 | 403 {
  switch (error.code) {
    case "forbidden_email":
      return 403;
    case "invalid_callback":
    case "invalid_state":
      return 400;
    default:
      return 401;
  }
}

function renderGoogleUnavailable(): string {
  return page(
    "Google Login Not Configured",
    "<p>Google login is not configured for this deployment yet.</p>",
  );
}

function renderAuthError(message: string): string {
  return page("Fitness Coach Login", `<p>${escapeHtml(message)}</p>`);
}

function renderTelegramLinkCommand(input: {
  command: string;
  expiresAt: string;
  startUrl?: string | undefined;
}): string {
  const deepLink =
    input.startUrl === undefined
      ? ""
      : `<p><a href="${escapeHtml(input.startUrl)}">Open Telegram</a></p>`;
  const fallback =
    input.startUrl === undefined
      ? `<p>Send this exact command to the Fitness Coach bot in Telegram.</p>`
      : `<p>If Telegram does not open, send this fallback command to the bot.</p>`;

  return page(
    "Link Telegram",
    `${deepLink}
     ${fallback}
     <textarea readonly rows="4" cols="56">${escapeHtml(input.command)}</textarea>
     <p>This link expires at ${escapeHtml(input.expiresAt)}.</p>`,
  );
}

function telegramStartUrl(
  requestUrl: string,
  forwardedProto: string | undefined,
  host: string | undefined,
  username: string | undefined,
  token: string,
): string | undefined {
  const normalizedUsername = normalizeTelegramBotUsername(username);

  if (normalizedUsername === undefined || !isTelegramStartPayload(token)) {
    return undefined;
  }

  if (!isHttpsRequest(requestUrl, forwardedProto, host)) {
    return undefined;
  }

  const url = new URL(`https://t.me/${normalizedUsername}`);
  url.searchParams.set("start", token);

  return url.toString();
}

function normalizeTelegramBotUsername(
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.startsWith("@") ? value.slice(1) : value;

  return /^[A-Za-z0-9_]{5,32}$/u.test(normalized) ? normalized : undefined;
}

function isTelegramStartPayload(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/u.test(value);
}

function isHttpsRequest(
  requestUrl: string,
  forwardedProto: string | undefined,
  host: string | undefined,
): boolean {
  if (forwardedProto === "https") {
    return true;
  }

  if (host !== undefined) {
    return new URL(requestUrl).protocol === "https:";
  }

  return false;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      ${body}
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
