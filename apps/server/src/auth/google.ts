import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type {
  OAuthAuthorizeInput,
  OAuthRouteConfig,
} from "../oauth/service.js";

export type GoogleAuthFlow =
  | "oauth-authorize"
  | "telegram-link"
  | "web-dashboard";

export type GoogleAuthConfig = Readonly<{
  userId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedEmails: readonly string[];
  stateSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  stateTtlSeconds: number;
  now?: number | Date | undefined;
  exchangeCodeForIdToken?:
    | ((input: GoogleTokenExchangeInput) => Promise<string>)
    | undefined;
  verifyIdToken?:
    | ((input: GoogleIdTokenVerificationInput) => Promise<GoogleIdentity>)
    | undefined;
}>;

export type GoogleAuthEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type GoogleOAuthAuthorizeState = Readonly<
  Omit<OAuthAuthorizeInput, "authenticatedUserId" | "loginCode">
>;

export type GoogleAuthState = Readonly<{
  v: 1;
  flow: GoogleAuthFlow;
  csrf: string;
  nonce: string;
  createdAt: number;
  oauth?: GoogleOAuthAuthorizeState | undefined;
  returnTo?: string | undefined;
}>;

export type GoogleAuthorizationStart = Readonly<{
  authorizationUrl: string;
  state: string;
}>;

export type GoogleAuthenticatedCallback = Readonly<{
  identity: GoogleIdentity;
  state: GoogleAuthState;
}>;

export type GoogleIdentity = Readonly<{
  userId: string;
  googleSubject: string;
  email: string;
  emailVerified: boolean;
  name?: string | undefined;
  picture?: string | undefined;
}>;

export type GoogleTokenExchangeInput = Readonly<{
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEndpoint: string;
}>;

export type GoogleIdTokenVerificationInput = Readonly<{
  idToken: string;
  clientId: string;
  nonce: string;
  jwksUri: string;
  userId: string;
}>;

export type GoogleAuthErrorCode =
  | "configuration"
  | "forbidden_email"
  | "invalid_callback"
  | "invalid_state"
  | "token_exchange_failed"
  | "token_verification_failed";

export class GoogleAuthError extends Error {
  readonly code: GoogleAuthErrorCode;

  constructor(code: GoogleAuthErrorCode, message: string) {
    super(message);
    this.name = "GoogleAuthError";
    this.code = code;
  }
}

const DEFAULT_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DEFAULT_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const DEFAULT_STATE_TTL_SECONDS = 5 * 60;
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export function resolveGoogleAuthConfig(
  config: Partial<GoogleAuthConfig> = {},
  oauthConfig: OAuthRouteConfig,
  env: GoogleAuthEnvironment = envRecord(),
): GoogleAuthConfig | undefined {
  const clientId = config.clientId ?? envString(env, "GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret =
    config.clientSecret ?? envString(env, "GOOGLE_OAUTH_CLIENT_SECRET");
  const stateSecret =
    config.stateSecret ??
    envString(env, "GOOGLE_AUTH_STATE_SECRET") ??
    envString(env, "AUTH_SESSION_SECRET");
  const allowedEmails =
    config.allowedEmails ??
    csvEnv(envString(env, "GOOGLE_AUTH_ALLOWED_EMAILS")) ??
    csvEnv(envString(env, "GOOGLE_ALLOWED_EMAILS"));

  if (
    clientId === undefined &&
    clientSecret === undefined &&
    stateSecret === undefined &&
    allowedEmails === undefined &&
    config.exchangeCodeForIdToken === undefined &&
    config.verifyIdToken === undefined
  ) {
    return undefined;
  }

  if (clientId === undefined || clientId.length === 0) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID is required when Google auth is enabled.",
    );
  }

  if (clientSecret === undefined || clientSecret.length === 0) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_SECRET is required when Google auth is enabled.",
    );
  }

  if (stateSecret === undefined || stateSecret.length < 32) {
    throw new Error(
      "AUTH_SESSION_SECRET or GOOGLE_AUTH_STATE_SECRET must be at least 32 characters when Google auth is enabled.",
    );
  }

  if (allowedEmails === undefined || allowedEmails.length === 0) {
    throw new Error(
      "GOOGLE_AUTH_ALLOWED_EMAILS must list the allowed Google account email address.",
    );
  }

  return {
    userId: config.userId ?? oauthConfig.userId,
    clientId,
    clientSecret,
    redirectUri:
      config.redirectUri ??
      envString(env, "GOOGLE_OAUTH_REDIRECT_URI") ??
      callbackUrlFor(oauthConfig.issuer),
    allowedEmails: allowedEmails.map((email) => email.toLowerCase()),
    stateSecret,
    authorizationEndpoint:
      config.authorizationEndpoint ?? DEFAULT_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: config.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT,
    jwksUri: config.jwksUri ?? DEFAULT_JWKS_URI,
    stateTtlSeconds: config.stateTtlSeconds ?? DEFAULT_STATE_TTL_SECONDS,
    now: config.now ?? oauthConfig.now,
    ...(config.exchangeCodeForIdToken === undefined
      ? {}
      : { exchangeCodeForIdToken: config.exchangeCodeForIdToken }),
    ...(config.verifyIdToken === undefined
      ? {}
      : { verifyIdToken: config.verifyIdToken }),
  };
}

export function createGoogleAuthorizationStart(
  config: GoogleAuthConfig,
  input: Readonly<{
    flow: GoogleAuthFlow;
    oauth?: GoogleOAuthAuthorizeState | undefined;
    returnTo?: string | undefined;
  }>,
): GoogleAuthorizationStart {
  const statePayload: GoogleAuthState = {
    v: 1,
    flow: input.flow,
    csrf: randomToken(),
    nonce: randomToken(),
    createdAt: unixSeconds(config.now),
    ...(input.oauth === undefined ? {} : { oauth: input.oauth }),
    ...(input.returnTo === undefined ? {} : { returnTo: input.returnTo }),
  };
  const state = signState(statePayload, config.stateSecret);
  const authorizationUrl = new URL(config.authorizationEndpoint);

  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("nonce", statePayload.nonce);
  authorizationUrl.searchParams.set("prompt", "select_account");

  return {
    authorizationUrl: authorizationUrl.toString(),
    state,
  };
}

export async function authenticateGoogleCallback(
  config: GoogleAuthConfig,
  input: Readonly<{
    code: string | undefined;
    state: string | undefined;
    expectedState: string | undefined;
  }>,
): Promise<GoogleAuthenticatedCallback> {
  if (
    input.code === undefined ||
    input.state === undefined ||
    input.expectedState === undefined ||
    !constantTimeStringEquals(input.state, input.expectedState)
  ) {
    throw new GoogleAuthError(
      "invalid_callback",
      "Google callback is incomplete.",
    );
  }

  const state = verifyState(input.state, config);
  const idToken = await exchangeCodeForIdToken(config, input.code);
  const identity = await verifyIdToken(config, {
    idToken,
    nonce: state.nonce,
  });

  if (!config.allowedEmails.includes(identity.email.toLowerCase())) {
    throw new GoogleAuthError(
      "forbidden_email",
      "Google account is not allowed for this private app.",
    );
  }

  return {
    identity,
    state,
  };
}

function verifyState(token: string, config: GoogleAuthConfig): GoogleAuthState {
  const [encodedPayload, actualSignature] = token.split(".");

  if (encodedPayload === undefined || actualSignature === undefined) {
    throw new GoogleAuthError("invalid_state", "Google state is malformed.");
  }

  const expectedSignature = stateSignature(encodedPayload, config.stateSecret);

  if (!constantTimeStringEquals(actualSignature, expectedSignature)) {
    throw new GoogleAuthError(
      "invalid_state",
      "Google state signature is invalid.",
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
  } catch {
    throw new GoogleAuthError(
      "invalid_state",
      "Google state payload is invalid.",
    );
  }

  if (!isGoogleAuthState(parsed)) {
    throw new GoogleAuthError(
      "invalid_state",
      "Google state payload is invalid.",
    );
  }

  if (parsed.createdAt + config.stateTtlSeconds < unixSeconds(config.now)) {
    throw new GoogleAuthError("invalid_state", "Google state expired.");
  }

  return parsed;
}

async function exchangeCodeForIdToken(
  config: GoogleAuthConfig,
  code: string,
): Promise<string> {
  if (config.exchangeCodeForIdToken !== undefined) {
    return config.exchangeCodeForIdToken({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      tokenEndpoint: config.tokenEndpoint,
    });
  }

  const response = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    throw new GoogleAuthError(
      "token_exchange_failed",
      "Google token exchange failed.",
    );
  }

  const body = (await response.json()) as unknown;

  if (!isRecord(body) || typeof body.id_token !== "string") {
    throw new GoogleAuthError(
      "token_exchange_failed",
      "Google token response did not include an ID token.",
    );
  }

  return body.id_token;
}

async function verifyIdToken(
  config: GoogleAuthConfig,
  input: Readonly<{ idToken: string; nonce: string }>,
): Promise<GoogleIdentity> {
  if (config.verifyIdToken !== undefined) {
    return config.verifyIdToken({
      idToken: input.idToken,
      clientId: config.clientId,
      nonce: input.nonce,
      jwksUri: config.jwksUri,
      userId: config.userId,
    });
  }

  let payload: JWTPayload;

  try {
    const verified = await jwtVerify(
      input.idToken,
      createRemoteJWKSet(new URL(config.jwksUri)),
      {
        audience: config.clientId,
        issuer: GOOGLE_ISSUERS,
      },
    );

    payload = verified.payload;
  } catch (error) {
    throw new GoogleAuthError(
      "token_verification_failed",
      error instanceof Error
        ? error.message
        : "Google ID token verification failed.",
    );
  }

  if (payload.nonce !== input.nonce) {
    throw new GoogleAuthError(
      "token_verification_failed",
      "Google ID token nonce did not match state.",
    );
  }

  if (
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    payload.email_verified !== true
  ) {
    throw new GoogleAuthError(
      "token_verification_failed",
      "Google ID token did not include a verified email.",
    );
  }

  return {
    userId: config.userId,
    googleSubject: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: true,
    ...(typeof payload.name === "string" ? { name: payload.name } : {}),
    ...(typeof payload.picture === "string"
      ? { picture: payload.picture }
      : {}),
  };
}

function signState(payload: GoogleAuthState, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );

  return `${encodedPayload}.${stateSignature(encodedPayload, secret)}`;
}

function stateSignature(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

function constantTimeStringEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.byteLength === expectedBuffer.byteLength &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function unixSeconds(now: number | Date | undefined): number {
  if (typeof now === "number") {
    return now;
  }

  if (now instanceof Date) {
    return Math.floor(now.getTime() / 1_000);
  }

  return Math.floor(Date.now() / 1_000);
}

function callbackUrlFor(issuer: string): string {
  return new URL("/auth/google/callback", issuer).toString();
}

function csvEnv(value: string | undefined): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function envString(
  env: GoogleAuthEnvironment,
  name: string,
): string | undefined {
  const value = env[name];

  return value === undefined || value.length === 0 ? undefined : value;
}

function envRecord(): GoogleAuthEnvironment {
  const globalWithProcess = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return globalWithProcess.process?.env ?? {};
}

function isGoogleAuthState(value: unknown): value is GoogleAuthState {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.v !== 1 ||
    (value.flow !== "oauth-authorize" &&
      value.flow !== "telegram-link" &&
      value.flow !== "web-dashboard") ||
    typeof value.csrf !== "string" ||
    typeof value.nonce !== "string" ||
    typeof value.createdAt !== "number"
  ) {
    return false;
  }

  return (
    (value.oauth === undefined || isGoogleOAuthAuthorizeState(value.oauth)) &&
    (value.returnTo === undefined || typeof value.returnTo === "string")
  );
}

function isGoogleOAuthAuthorizeState(
  value: unknown,
): value is GoogleOAuthAuthorizeState {
  if (!isRecord(value)) {
    return false;
  }

  return [
    "responseType",
    "clientId",
    "redirectUri",
    "resource",
    "scope",
    "state",
    "codeChallenge",
    "codeChallengeMethod",
  ].every((key) => value[key] === undefined || typeof value[key] === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
