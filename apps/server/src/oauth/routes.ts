import type { Context, Hono } from "hono";
import type { GoogleAuthConfig } from "../auth/google.js";
import type { ServerEnv } from "../auth.js";
import { googleAuthorizeStartUrl } from "../routes/google-auth.js";
import type { AuditPort } from "../services/audit.js";
import type { OAuthStore } from "./store.js";
import {
  createOAuthService,
  type OAuthAuthorizeInput,
  type OAuthRouteConfig,
  type OAuthTokenInput,
} from "./service.js";

export function registerOAuthRoutes(
  app: Hono<ServerEnv>,
  store: OAuthStore,
  config: OAuthRouteConfig,
  audit: AuditPort,
  googleConfig?: GoogleAuthConfig | undefined,
): void {
  const service = createOAuthService(store, config, audit);

  app.get("/oauth2/authorize", (context) => {
    const params = new URL(context.req.url).searchParams;
    const setupProblem = authorizationSetupProblem(config, params);

    if (setupProblem !== undefined) {
      return context.html(renderAuthorizationSetupProblem(setupProblem), 400);
    }

    return context.html(renderAuthorizationForm(config, params, googleConfig));
  });

  app.post("/oauth2/authorize", async (context) => {
    const params = await formParams(context);
    const result = await service.authorize(authorizeInput(params));

    if (result.ok === false) {
      const error = result;

      return context.json(error.error, error.status);
    }

    return context.redirect(result.redirectTo, 302);
  });

  app.post("/oauth2/token", async (context) => {
    const params = await formParams(context);
    const result = await service.token(
      tokenInput(params, context.req.header("authorization")),
    );

    if (result.ok === false) {
      const error = result;

      return context.json(error.error, error.status);
    }

    return context.json(result.body);
  });
}

async function formParams(
  context: Context<ServerEnv>,
): Promise<URLSearchParams> {
  return new URLSearchParams(await context.req.text());
}

function authorizeInput(params: URLSearchParams): OAuthAuthorizeInput {
  return {
    responseType: param(params, "response_type"),
    clientId: param(params, "client_id"),
    redirectUri: param(params, "redirect_uri"),
    resource: param(params, "resource"),
    scope: param(params, "scope"),
    state: param(params, "state"),
    codeChallenge: param(params, "code_challenge"),
    codeChallengeMethod: param(params, "code_challenge_method"),
    loginCode: param(params, "login_code"),
  };
}

function tokenInput(
  params: URLSearchParams,
  authorizationHeader: string | undefined,
): OAuthTokenInput {
  return {
    grantType: param(params, "grant_type"),
    clientId: clientIdForTokenRequest(params, authorizationHeader),
    redirectUri: param(params, "redirect_uri"),
    code: param(params, "code"),
    codeVerifier: param(params, "code_verifier"),
    refreshToken: param(params, "refresh_token"),
  };
}

function clientIdForTokenRequest(
  params: URLSearchParams,
  authorizationHeader: string | undefined,
): string | undefined {
  const formClientId = param(params, "client_id");
  const basicClientId = publicBasicClientId(authorizationHeader);

  if (
    formClientId !== undefined &&
    basicClientId !== undefined &&
    formClientId !== basicClientId
  ) {
    return undefined;
  }

  return formClientId ?? basicClientId;
}

function publicBasicClientId(
  authorizationHeader: string | undefined,
): string | undefined {
  if (authorizationHeader === undefined) {
    return undefined;
  }

  const match = /^Basic\s+(.+)$/iu.exec(authorizationHeader);

  if (match === null) {
    return undefined;
  }

  const encodedCredentials = match[1];

  if (encodedCredentials === undefined) {
    return undefined;
  }

  let decoded: string;

  try {
    decoded = Buffer.from(encodedCredentials, "base64").toString("utf8");
  } catch {
    return undefined;
  }

  const separatorIndex = decoded.indexOf(":");

  if (separatorIndex < 0) {
    return undefined;
  }

  const rawClientId = decoded.slice(0, separatorIndex);
  const rawSecret = decoded.slice(separatorIndex + 1);

  if (rawClientId.length === 0 || rawSecret.length > 0) {
    return undefined;
  }

  try {
    return decodeURIComponent(rawClientId);
  } catch {
    return undefined;
  }
}

function param(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name);

  return value === null || value.length === 0 ? undefined : value;
}

type AuthorizationSetupProblem = Readonly<{
  title: string;
  message: string;
  details?: readonly string[] | undefined;
}>;

function authorizationSetupProblem(
  config: OAuthRouteConfig,
  params: URLSearchParams,
): AuthorizationSetupProblem | undefined {
  const clientId = params.get("client_id");

  if (
    clientId !== null &&
    !config.clients.some((client) => client.id === clientId)
  ) {
    return {
      title: "Unknown OAuth Client",
      message:
        "This connector is using an OAuth client ID that Fitness Coach does not recognize.",
      details: [
        `Use the Fitness Coach MCP client ID "${suggestedMcpClientId(config)}".`,
        "Do not paste the Google OAuth client ID into ChatGPT's connector client ID field.",
      ],
    };
  }

  const redirectUri = params.get("redirect_uri");
  const client = config.clients.find((candidate) => candidate.id === clientId);

  if (
    client !== undefined &&
    redirectUri !== null &&
    !client.redirectUris.includes(redirectUri)
  ) {
    return {
      title: "Unregistered Connector Callback",
      message:
        "This connector callback URL is not registered for the Fitness Coach MCP client.",
      details: [
        "Copy the callback URL from ChatGPT and add it to OAUTH_CLIENTS_JSON for the configured MCP client.",
      ],
    };
  }

  return undefined;
}

function suggestedMcpClientId(config: OAuthRouteConfig): string {
  return (
    config.clients.find((client) => client.id === "fitness-chatgpt")?.id ??
    config.clients.find((client) => client.id.includes("chatgpt"))?.id ??
    config.clients[0]?.id ??
    "fitness-chatgpt"
  );
}

function renderAuthorizationForm(
  config: OAuthRouteConfig,
  params: URLSearchParams,
  googleConfig: GoogleAuthConfig | undefined,
): string {
  const clientId = params.get("client_id") ?? config.clients[0]?.id ?? "";
  const clientName = clientId === "fitness-chatgpt" ? "ChatGPT" : clientId;
  const googleUrl =
    googleConfig === undefined ? undefined : googleAuthorizeStartUrl(params);
  const action = googleUrl
    ? renderGoogleAuthorizationAction(googleUrl)
    : renderPrivateCodeFallback(clientId, params);
  const fallbackNotice =
    googleUrl === undefined
      ? `<p class="notice">Google sign-in is not configured for this environment.</p>`
      : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Connect Fitness Coach</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0f1115;
        --panel: #171a20;
        --panel-strong: #1f242d;
        --text: #f5f7f2;
        --muted: #b7bdad;
        --line: #303744;
        --lime: #c5f623;
        --lime-dark: #9dcc12;
        --danger: #ffb86b;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(197, 246, 35, 0.10), transparent 34rem),
          var(--bg);
        color: var(--text);
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      main {
        display: grid;
        min-height: 100vh;
        place-items: center;
        padding: 28px 16px;
      }

      .shell {
        width: min(100%, 480px);
        border: 1px solid var(--line);
        border-radius: 8px;
        background: color-mix(in srgb, var(--panel) 94%, black);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.36);
      }

      .header,
      .content {
        padding: 24px;
      }

      .header {
        display: flex;
        gap: 14px;
        align-items: center;
        border-bottom: 1px solid var(--line);
      }

      .mark {
        display: grid;
        width: 44px;
        height: 44px;
        flex: 0 0 auto;
        place-items: center;
        border-radius: 8px;
        background: rgba(197, 246, 35, 0.13);
        color: var(--lime);
        font-size: 24px;
        font-weight: 800;
      }

      .eyebrow {
        margin: 0 0 4px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
      }

      h1,
      h2,
      p {
        margin: 0;
      }

      h1 {
        font-size: 24px;
        line-height: 1.16;
      }

      .lede {
        margin-top: 10px;
        color: var(--muted);
        font-size: 15px;
        line-height: 1.45;
      }

      .scopes {
        margin-top: 22px;
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel-strong);
      }

      h2 {
        font-size: 13px;
        text-transform: uppercase;
        color: var(--muted);
      }

      ul {
        display: grid;
        gap: 10px;
        margin: 14px 0 0;
        padding: 0;
        list-style: none;
      }

      li {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        min-width: 0;
      }

      .check {
        width: 20px;
        height: 20px;
        flex: 0 0 auto;
        border-radius: 999px;
        background: rgba(197, 246, 35, 0.15);
        color: var(--lime);
        text-align: center;
        font-size: 13px;
        font-weight: 900;
        line-height: 20px;
      }

      .scope-title {
        display: block;
        font-size: 14px;
        font-weight: 700;
      }

      .scope-detail {
        display: block;
        margin-top: 2px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.35;
      }

      .action {
        margin-top: 22px;
      }

      .google-button,
      button {
        display: inline-flex;
        width: 100%;
        min-height: 48px;
        align-items: center;
        justify-content: center;
        gap: 10px;
        border: 0;
        border-radius: 8px;
        background: var(--lime);
        color: #11140f;
        font: inherit;
        font-size: 15px;
        font-weight: 800;
        text-decoration: none;
        cursor: pointer;
      }

      .google-button:hover,
      button:hover {
        background: var(--lime-dark);
      }

      .google-button:focus-visible,
      button:focus-visible,
      input:focus-visible {
        outline: 3px solid rgba(197, 246, 35, 0.42);
        outline-offset: 3px;
      }

      .google-g {
        display: grid;
        width: 22px;
        height: 22px;
        place-items: center;
        border-radius: 999px;
        background: #fff;
        color: #1f1f1f;
        font-weight: 900;
      }

      form {
        display: grid;
        gap: 14px;
        margin-top: 18px;
      }

      label {
        display: grid;
        gap: 8px;
        color: var(--muted);
        font-size: 13px;
        font-weight: 700;
      }

      input {
        width: 100%;
        min-height: 46px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #0d0f13;
        color: var(--text);
        font: inherit;
        padding: 10px 12px;
      }

      .footnote,
      .notice {
        margin-top: 16px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.45;
      }

      .notice {
        color: var(--danger);
      }
    </style>
  </head>
  <body>
    <main>
      <section class="shell" aria-labelledby="connect-title">
        <div class="header">
          <div class="mark" aria-hidden="true">F</div>
          <div>
            <p class="eyebrow">Fitness Coach</p>
            <h1 id="connect-title">Connect Fitness Coach</h1>
          </div>
        </div>
        <div class="content">
          <p class="lede">${escapeHtml(clientName)} is requesting scoped access to your private fitness coach data.</p>
          ${renderScopeList(params.get("scope") ?? "")}
          ${fallbackNotice}
          <div class="action">${action}</div>
          <p class="footnote">Google verifies the account. ChatGPT receives a scoped Fitness Coach token, not a Google token.</p>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function renderGoogleAuthorizationAction(googleUrl: string): string {
  return `<a class="google-button" href="${escapeHtml(googleUrl)}"><span class="google-g" aria-hidden="true">G</span>Continue with Google</a>`;
}

function renderPrivateCodeFallback(
  clientId: string,
  params: URLSearchParams,
): string {
  const hiddenFields = [
    "response_type",
    "client_id",
    "redirect_uri",
    "resource",
    "scope",
    "state",
    "code_challenge",
    "code_challenge_method",
  ]
    .map((name) => {
      const value = name === "client_id" ? clientId : (params.get(name) ?? "");

      return `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
    })
    .join("");

  return `<form method="post" action="/oauth2/authorize">
    ${hiddenFields}
    <label>
      Private login code
      <input name="login_code" type="password" autocomplete="one-time-code" required>
    </label>
    <button type="submit">Authorize</button>
  </form>`;
}

function renderScopeList(scopeText: string): string {
  const scopes = scopeText
    .split(/\s+/u)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);

  if (scopes.length === 0) {
    return "";
  }

  return `<section class="scopes" aria-labelledby="scopes-title">
    <h2 id="scopes-title">Requested access</h2>
    <ul>
      ${scopes.map(renderScopeItem).join("")}
    </ul>
  </section>`;
}

function renderScopeItem(scope: string): string {
  const copy = scopeCopy(scope);

  return `<li>
    <span class="check" aria-hidden="true">&#10003;</span>
    <span>
      <span class="scope-title">${escapeHtml(copy.title)}</span>
      <span class="scope-detail">${escapeHtml(copy.detail)}</span>
    </span>
  </li>`;
}

function scopeCopy(scope: string): Readonly<{ title: string; detail: string }> {
  switch (scope) {
    case "coach:read":
      return {
        title: "Coach profile",
        detail: "Read goals, preferences, and coaching context.",
      };
    case "coach:write":
      return {
        title: "Coach updates",
        detail: "Save approved coach notes and preferences.",
      };
    case "health:read":
      return {
        title: "Health summaries",
        detail: "Read synced Apple Health metrics from Fitness Coach.",
      };
    case "meal:write":
      return {
        title: "Meal logging",
        detail: "Add or correct meals and macro estimates.",
      };
    case "report:read":
      return {
        title: "Reports",
        detail: "Read generated fitness and nutrition reports.",
      };
    default:
      return {
        title: scope,
        detail: "Use this OAuth scope for the connector session.",
      };
  }
}

function renderAuthorizationSetupProblem(
  problem: AuthorizationSetupProblem,
): string {
  const details =
    problem.details === undefined
      ? ""
      : `<ul>${problem.details
          .map((detail) => `<li>${escapeHtml(detail)}</li>`)
          .join("")}</ul>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(problem.title)}</title>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(problem.title)}</h1>
      <p>${escapeHtml(problem.message)}</p>
      ${details}
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
