import {
  IOS_APP_SCOPES,
  MCP_CONNECTOR_SCOPES,
  assertNoDeferredScopes,
  issueFitnessProfileToken,
  isAuthScope,
  type AuthScope,
  type FitnessJwtPrivateJwk,
  type FitnessTokenProfile,
} from "@fitness/auth";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { McpOAuthConfig } from "../mcp/oauth-metadata.js";
import type { ServerAuthConfig } from "../auth.js";
import type { AuditPort } from "../services/audit.js";
import type { OAuthStore } from "./store.js";

export type OAuthClient = Readonly<{
  id: string;
  redirectUris: readonly string[];
}>;

export type OAuthRouteConfig = Readonly<{
  issuer: string;
  resource: string;
  audience: string;
  healthIssuer: string;
  healthResource: string;
  healthAudience: string;
  userId: string;
  clients: readonly OAuthClient[];
  privateJwk?: FitnessJwtPrivateJwk | undefined;
  privateLoginCode?: string | undefined;
  now?: number | Date | undefined;
  accessTokenTtlSeconds: number;
  authorizationCodeTtlSeconds: number;
  refreshTokenTtlSeconds: number;
}>;

export type OAuthRouteEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type OAuthAuthorizeInput = Readonly<{
  responseType: string | undefined;
  clientId: string | undefined;
  redirectUri: string | undefined;
  resource: string | undefined;
  scope: string | undefined;
  state: string | undefined;
  codeChallenge: string | undefined;
  codeChallengeMethod: string | undefined;
  loginCode: string | undefined;
  authenticatedUserId?: string | undefined;
}>;

export type OAuthTokenInput = Readonly<{
  grantType: string | undefined;
  clientId: string | undefined;
  redirectUri: string | undefined;
  code: string | undefined;
  codeVerifier: string | undefined;
  refreshToken: string | undefined;
}>;

export type OAuthAuthorizeResult =
  | Readonly<{ ok: true; redirectTo: string }>
  | Readonly<{ ok: false; status: 400 | 403 | 503; error: OAuthError }>;

export type OAuthTokenResult =
  | Readonly<{ ok: true; body: OAuthTokenResponse }>
  | Readonly<{ ok: false; status: 400 | 401 | 503; error: OAuthError }>;

export type OAuthError = Readonly<{
  error:
    | "invalid_client"
    | "invalid_grant"
    | "invalid_request"
    | "invalid_scope"
    | "server_error"
    | "unsupported_grant_type";
  error_description?: string | undefined;
}>;

export type OAuthTokenResponse = Readonly<{
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}>;

export type OAuthService = Readonly<{
  authorize(input: OAuthAuthorizeInput): Promise<OAuthAuthorizeResult>;
  token(input: OAuthTokenInput): Promise<OAuthTokenResult>;
}>;

const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 300;
const DEFAULT_AUTHORIZATION_CODE_TTL_SECONDS = 300;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24;
const MAX_AUTHORIZATION_CODE_TTL_SECONDS = 15 * 60;
const MAX_REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 365;

export function resolveOAuthRouteConfig(
  config: Partial<OAuthRouteConfig> = {},
  mcpConfig: McpOAuthConfig,
  healthConfig?: ServerAuthConfig,
  env: OAuthRouteEnvironment = envRecord(),
): OAuthRouteConfig {
  const externalOrigin = externalOriginFromEnv(env);
  const healthIssuer =
    config.healthIssuer ??
    envString(env, "HEALTH_SYNC_TOKEN_ISSUER") ??
    healthConfig?.expectedIssuer ??
    externalOrigin ??
    mcpConfig.issuer;
  const healthResource =
    config.healthResource ??
    envString(env, "HEALTH_SYNC_TOKEN_RESOURCE") ??
    healthConfig?.expectedResource ??
    externalOrigin ??
    healthIssuer;

  return {
    issuer: config.issuer ?? mcpConfig.issuer,
    resource: config.resource ?? mcpConfig.resource,
    audience: config.audience ?? mcpConfig.audience,
    healthIssuer,
    healthResource,
    healthAudience:
      config.healthAudience ??
      envString(env, "HEALTH_SYNC_TOKEN_AUDIENCE") ??
      audienceString(healthConfig?.expectedAudience) ??
      "fitness-api",
    userId:
      config.userId ??
      envString(env, "OAUTH_USER_ID") ??
      mcpConfig.expectedSubject ??
      "user_alex",
    clients:
      config.clients ?? clientsFromEnv(envString(env, "OAUTH_CLIENTS_JSON")),
    privateJwk:
      config.privateJwk ??
      privateJwkFromEnv(
        envString(env, "OAUTH_SIGNING_PRIVATE_JWK") ??
          envString(env, "AUTH_SIGNING_PRIVATE_JWK_JSON"),
      ),
    privateLoginCode:
      config.privateLoginCode ?? envString(env, "OAUTH_PRIVATE_LOGIN_CODE"),
    now: config.now ?? mcpConfig.now,
    accessTokenTtlSeconds:
      config.accessTokenTtlSeconds ??
      envPositiveInt(
        env,
        "OAUTH_ACCESS_TOKEN_TTL_SECONDS",
        MAX_ACCESS_TOKEN_TTL_SECONDS,
      ) ??
      DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
    authorizationCodeTtlSeconds:
      config.authorizationCodeTtlSeconds ??
      envPositiveInt(
        env,
        "OAUTH_AUTHORIZATION_CODE_TTL_SECONDS",
        MAX_AUTHORIZATION_CODE_TTL_SECONDS,
      ) ??
      DEFAULT_AUTHORIZATION_CODE_TTL_SECONDS,
    refreshTokenTtlSeconds:
      config.refreshTokenTtlSeconds ??
      envPositiveInt(
        env,
        "OAUTH_REFRESH_TOKEN_TTL_SECONDS",
        MAX_REFRESH_TOKEN_TTL_SECONDS,
      ) ??
      DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
  };
}

export function createOAuthService(
  store: OAuthStore,
  config: OAuthRouteConfig,
  audit: AuditPort,
): OAuthService {
  return {
    async authorize(input): Promise<OAuthAuthorizeResult> {
      if (!isConfigured(config)) {
        return serverError("OAuth login is not configured.");
      }

      const request = validateAuthorizationRequest(input, config);

      if (request.ok === false) {
        return request;
      }

      if (!isAuthorizedToCreateCode(input, config)) {
        return {
          ok: false,
          status: 403,
          error: {
            error: "invalid_grant",
            error_description: "Login authorization was not accepted.",
          },
        };
      }

      const code = secretToken();
      const expiresAt = isoSecondsFromNow(
        config.now,
        config.authorizationCodeTtlSeconds,
      );

      await store.createAuthorizationCode({
        code,
        userId: config.userId,
        clientId: request.client.id,
        redirectUri: request.redirectUri,
        resource: request.resource,
        scope: request.scope,
        codeChallenge: request.codeChallenge,
        codeChallengeMethod: "S256",
        expiresAt,
      });
      await auditOAuth(audit, {
        action: "oauth.authorization_code.create",
        userId: config.userId,
        clientId: request.client.id,
        resource: request.resource,
        scope: request.scope,
      });

      const redirectTo = new URL(request.redirectUri);
      redirectTo.searchParams.set("code", code);
      redirectTo.searchParams.set("state", request.state);

      return {
        ok: true,
        redirectTo: redirectTo.toString(),
      };
    },
    async token(input): Promise<OAuthTokenResult> {
      if (!isConfigured(config)) {
        return serverError("OAuth login is not configured.");
      }

      switch (input.grantType) {
        case "authorization_code":
          return exchangeAuthorizationCode(store, config, audit, input);
        case "refresh_token":
          return refreshAccessToken(store, config, audit, input);
        default:
          return {
            ok: false,
            status: 400,
            error: {
              error:
                input.grantType === undefined
                  ? "invalid_request"
                  : "unsupported_grant_type",
            },
          };
      }
    },
  };
}

type ValidAuthorizationRequest = Readonly<{
  ok: true;
  client: OAuthClient;
  resourceProfile: OAuthResourceProfile;
  redirectUri: string;
  resource: string;
  scope: string;
  state: string;
  codeChallenge: string;
}>;

type AuthorizationValidationResult =
  | ValidAuthorizationRequest
  | Readonly<{ ok: false; status: 400; error: OAuthError }>;

function validateAuthorizationRequest(
  input: OAuthAuthorizeInput,
  config: OAuthRouteConfig,
): AuthorizationValidationResult {
  if (input.responseType !== "code") {
    return invalidRequest("response_type must be code.");
  }

  const client = clientById(config, input.clientId);

  if (client === undefined) {
    return invalidClient();
  }

  if (
    input.redirectUri === undefined ||
    !client.redirectUris.includes(input.redirectUri)
  ) {
    return invalidRequest("redirect_uri is not registered for this client.");
  }

  const resourceProfile = resourceProfileFor(config, input.resource);

  if (resourceProfile === undefined) {
    return invalidRequest("resource is not supported.");
  }

  if (input.state === undefined || input.state.length === 0) {
    return invalidRequest("state is required.");
  }

  if (
    input.codeChallenge === undefined ||
    input.codeChallenge.length === 0 ||
    input.codeChallengeMethod !== "S256"
  ) {
    return invalidRequest("PKCE S256 code_challenge is required.");
  }

  const scopeResult = validateScope(input.scope, resourceProfile);

  if (scopeResult.ok === false) {
    const reason = scopeResult.reason;

    return {
      ok: false,
      status: 400,
      error: {
        error: "invalid_scope",
        error_description: reason,
      },
    };
  }

  return {
    ok: true,
    client,
    resourceProfile,
    redirectUri: input.redirectUri,
    resource: resourceProfile.resource,
    scope: scopeResult.scope,
    state: input.state,
    codeChallenge: input.codeChallenge,
  };
}

async function exchangeAuthorizationCode(
  store: OAuthStore,
  config: OAuthRouteConfig,
  audit: AuditPort,
  input: OAuthTokenInput,
): Promise<OAuthTokenResult> {
  const client = clientById(config, input.clientId);

  if (client === undefined) {
    return {
      ok: false,
      status: 401,
      error: {
        error: "invalid_client",
      },
    };
  }

  if (
    input.code === undefined ||
    input.redirectUri === undefined ||
    input.codeVerifier === undefined
  ) {
    return invalidTokenRequest(
      "code, redirect_uri, and code_verifier are required.",
    );
  }

  const consumed = await store.consumeAuthorizationCode({
    code: input.code,
    clientId: client.id,
    redirectUri: input.redirectUri,
    now: isoNow(config.now),
  });

  if (consumed.ok === false) {
    return invalidGrant();
  }

  if (
    consumed.record.codeChallengeMethod !== "S256" ||
    pkceChallenge(input.codeVerifier) !== consumed.record.codeChallenge
  ) {
    return invalidGrant();
  }

  return issueTokenPair(store, config, audit, {
    userId: consumed.record.userId,
    clientId: consumed.record.clientId,
    resource: consumed.record.resource,
    scope: consumed.record.scope,
    familyId: randomUUID(),
  });
}

async function refreshAccessToken(
  store: OAuthStore,
  config: OAuthRouteConfig,
  audit: AuditPort,
  input: OAuthTokenInput,
): Promise<OAuthTokenResult> {
  const client = clientById(config, input.clientId);

  if (client === undefined) {
    return {
      ok: false,
      status: 401,
      error: {
        error: "invalid_client",
      },
    };
  }

  if (input.refreshToken === undefined) {
    return invalidTokenRequest("refresh_token is required.");
  }

  const replacementToken = secretToken();
  const refreshed = await store.rotateRefreshToken({
    token: input.refreshToken,
    clientId: client.id,
    replacementToken,
    now: isoNow(config.now),
    expiresAt: isoSecondsFromNow(config.now, config.refreshTokenTtlSeconds),
  });

  if (refreshed.ok === false) {
    return invalidGrant();
  }

  const accessToken = await issueAccessToken(config, {
    userId: refreshed.record.userId,
    resource: refreshed.record.resource,
    scope: refreshed.record.scope,
  });
  await auditOAuth(audit, {
    action: "oauth.refresh.rotate",
    userId: refreshed.record.userId,
    clientId: refreshed.record.clientId,
    resource: refreshed.record.resource,
    scope: refreshed.record.scope,
  });

  return {
    ok: true,
    body: {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: config.accessTokenTtlSeconds,
      refresh_token: replacementToken,
      scope: refreshed.record.scope,
    },
  };
}

async function issueTokenPair(
  store: OAuthStore,
  config: OAuthRouteConfig,
  audit: AuditPort,
  input: Readonly<{
    userId: string;
    clientId: string;
    resource: string;
    scope: string;
    familyId: string;
  }>,
): Promise<OAuthTokenResult> {
  const refreshToken = secretToken();
  const refreshRecord = {
    familyId: input.familyId,
    userId: input.userId,
    clientId: input.clientId,
    resource: input.resource,
    scope: input.scope,
    expiresAt: isoSecondsFromNow(config.now, config.refreshTokenTtlSeconds),
  };

  await store.createRefreshToken({
    token: refreshToken,
    ...refreshRecord,
  });

  const accessToken = await issueAccessToken(config, {
    userId: input.userId,
    resource: input.resource,
    scope: input.scope,
  });
  await auditOAuth(audit, {
    action: "oauth.token.issue",
    userId: input.userId,
    clientId: input.clientId,
    resource: input.resource,
    scope: input.scope,
  });

  return {
    ok: true,
    body: {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: config.accessTokenTtlSeconds,
      refresh_token: refreshToken,
      scope: input.scope,
    },
  };
}

async function issueAccessToken(
  config: OAuthRouteConfig,
  input: Readonly<{ userId: string; resource: string; scope: string }>,
): Promise<string> {
  if (config.privateJwk === undefined) {
    throw new Error("OAuth private JWK is required.");
  }

  const resourceProfile = resourceProfileFor(config, input.resource);

  if (resourceProfile === undefined) {
    throw new Error("OAuth resource profile is required.");
  }

  const issued = await issueFitnessProfileToken({
    profile: resourceProfile.profile,
    privateJwk: config.privateJwk,
    issuer: resourceProfile.issuer,
    audience: resourceProfile.audience,
    resource: resourceProfile.resource,
    subject: input.userId,
    scopes: authScopesForToken(input.scope),
    ttlSeconds: config.accessTokenTtlSeconds,
    tokenId: randomUUID(),
    ...(config.now === undefined ? {} : { now: config.now }),
  });

  return issued.token;
}

type ScopeValidationResult =
  | Readonly<{ ok: true; scope: string }>
  | Readonly<{ ok: false; reason: string }>;

function validateScope(
  scope: string | undefined,
  resourceProfile: OAuthResourceProfile,
): ScopeValidationResult {
  if (scope === undefined || scope.trim().length === 0) {
    return {
      ok: false,
      reason: "At least one scope is required.",
    };
  }

  const scopes = scope.trim().split(/\s+/u);

  if (resourceProfile.profile === "mcp") {
    try {
      assertNoDeferredScopes(scopes);
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "Invalid scope.",
      };
    }
  }

  const allowedScopes = new Set<string>(resourceProfile.allowedScopes);
  const invalidScope = scopes.find(
    (requestedScope) =>
      !isAuthScope(requestedScope) || !allowedScopes.has(requestedScope),
  );

  if (invalidScope !== undefined) {
    return {
      ok: false,
      reason: `Scope "${invalidScope}" is not supported.`,
    };
  }

  return {
    ok: true,
    scope: scopes.join(" "),
  };
}

function authScopesForToken(scope: string): readonly AuthScope[] {
  return scope.split(/\s+/u).filter(isAuthScope);
}

type OAuthResourceProfile = Readonly<{
  issuer: string;
  resource: string;
  audience: string;
  profile: FitnessTokenProfile;
  allowedScopes: readonly AuthScope[];
}>;

function resourceProfileFor(
  config: OAuthRouteConfig,
  resource: string | undefined,
): OAuthResourceProfile | undefined {
  if (resource === config.resource) {
    return {
      issuer: config.issuer,
      resource: config.resource,
      audience: config.audience,
      profile: "mcp",
      allowedScopes: MCP_CONNECTOR_SCOPES,
    };
  }

  if (resource === config.healthResource) {
    return {
      issuer: config.healthIssuer,
      resource: config.healthResource,
      audience: config.healthAudience,
      profile: "healthkit",
      allowedScopes: IOS_APP_SCOPES,
    };
  }

  return undefined;
}

async function auditOAuth(
  audit: AuditPort,
  input: Readonly<{
    action:
      | "oauth.authorization_code.create"
      | "oauth.refresh.rotate"
      | "oauth.token.issue";
    userId: string;
    clientId: string;
    resource: string;
    scope: string;
  }>,
): Promise<void> {
  await audit.create({
    action: input.action,
    actor: {
      type: "user",
      id: input.userId,
    },
    target: {
      type: "oauth_client",
      id: input.clientId,
    },
    userId: input.userId,
    metadata: {
      resource: input.resource,
      scope: input.scope,
    },
  });
}

function clientById(
  config: OAuthRouteConfig,
  clientId: string | undefined,
): OAuthClient | undefined {
  if (clientId === undefined) {
    return undefined;
  }

  return config.clients.find((client) => client.id === clientId);
}

function isConfigured(config: OAuthRouteConfig): boolean {
  return config.privateJwk !== undefined && config.clients.length > 0;
}

function isAuthorizedToCreateCode(
  input: OAuthAuthorizeInput,
  config: OAuthRouteConfig,
): boolean {
  if (input.authenticatedUserId === config.userId) {
    return true;
  }

  return privateLoginCodeMatches(input.loginCode, config.privateLoginCode);
}

function privateLoginCodeMatches(
  candidate: string | undefined,
  expected: string | undefined,
): boolean {
  if (candidate === undefined || expected === undefined) {
    return false;
  }

  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);

  return (
    candidateBuffer.byteLength === expectedBuffer.byteLength &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  );
}

function pkceChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function secretToken(): string {
  return randomBytes(32).toString("base64url");
}

function isoNow(now: number | Date | undefined): string {
  return dateFor(now).toISOString();
}

function isoSecondsFromNow(
  now: number | Date | undefined,
  seconds: number,
): string {
  return new Date(dateFor(now).getTime() + seconds * 1000).toISOString();
}

function dateFor(now: number | Date | undefined): Date {
  if (now instanceof Date) {
    return now;
  }

  if (typeof now === "number") {
    return new Date(now * 1000);
  }

  return new Date();
}

function invalidRequest(description: string): AuthorizationValidationResult {
  return {
    ok: false,
    status: 400,
    error: {
      error: "invalid_request",
      error_description: description,
    },
  };
}

function invalidClient(): AuthorizationValidationResult {
  return {
    ok: false,
    status: 400,
    error: {
      error: "invalid_client",
    },
  };
}

function invalidTokenRequest(description: string): OAuthTokenResult {
  return {
    ok: false,
    status: 400,
    error: {
      error: "invalid_request",
      error_description: description,
    },
  };
}

function invalidGrant(): OAuthTokenResult {
  return {
    ok: false,
    status: 400,
    error: {
      error: "invalid_grant",
    },
  };
}

function serverError(
  description: string,
): Readonly<{ ok: false; status: 503; error: OAuthError }> {
  return {
    ok: false,
    status: 503,
    error: {
      error: "server_error",
      error_description: description,
    },
  };
}

function clientsFromEnv(value: string | undefined): readonly OAuthClient[] {
  if (value === undefined) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Invalid OAUTH_CLIENTS_JSON: ${error instanceof Error ? error.message : "parse failed"}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid OAUTH_CLIENTS_JSON: expected an array.");
  }

  return parsed.map(parseOAuthClient);
}

function parseOAuthClient(value: unknown): OAuthClient {
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new Error("Invalid OAUTH_CLIENTS_JSON: every client needs id.");
  }

  if (
    !Array.isArray(value.redirectUris) ||
    !value.redirectUris.every((uri) => typeof uri === "string")
  ) {
    throw new Error(
      "Invalid OAUTH_CLIENTS_JSON: every client needs redirectUris.",
    );
  }

  return {
    id: value.id,
    redirectUris: [...value.redirectUris],
  };
}

function privateJwkFromEnv(
  value: string | undefined,
): FitnessJwtPrivateJwk | undefined {
  if (value === undefined) {
    return undefined;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Invalid OAuth private JWK JSON: ${error instanceof Error ? error.message : "parse failed"}`,
    );
  }

  if (!isRecord(parsed) || typeof parsed.kid !== "string") {
    throw new Error("Invalid OAuth private JWK JSON: expected kid.");
  }

  return parsed as unknown as FitnessJwtPrivateJwk;
}

function audienceString(
  audience: string | readonly string[] | undefined,
): string | undefined {
  if (typeof audience === "string") {
    return audience;
  }

  return audience?.[0];
}

function originFromUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function externalOriginFromEnv(env: OAuthRouteEnvironment): string | undefined {
  return (
    originFromUrl(envString(env, "FITNESS_EXTERNAL_URL")) ??
    originFromUrl(envString(env, "RENDER_EXTERNAL_URL")) ??
    originFromVercelDomain(envString(env, "VERCEL_PROJECT_PRODUCTION_URL")) ??
    originFromVercelDomain(envString(env, "VERCEL_BRANCH_URL")) ??
    originFromVercelDomain(envString(env, "VERCEL_URL"))
  );
}

function originFromVercelDomain(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return originFromUrl(value.includes("://") ? value : `https://${value}`);
}

function envPositiveInt(
  env: OAuthRouteEnvironment,
  name: string,
  maxValue: number,
): number | undefined {
  const value = envString(env, name);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maxValue) {
    throw new Error(
      `${name} must be a positive integer no greater than ${maxValue}.`,
    );
  }

  return parsed;
}

function envString(
  env: OAuthRouteEnvironment,
  name: string,
): string | undefined {
  const value = env[name];

  return value === undefined || value.length === 0 ? undefined : value;
}

function envRecord(): OAuthRouteEnvironment {
  const globalWithProcess = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return globalWithProcess.process?.env ?? {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
