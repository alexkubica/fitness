import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { WebGoogleConfig } from "@/lib/env";

export type GoogleWebState = Readonly<{
  v: 1;
  csrf: string;
  nonce: string;
  returnTo: string;
  createdAt: number;
}>;

export type GoogleIdentity = Readonly<{
  email: string;
  subject: string;
}>;

const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const STATE_TTL_SECONDS = 5 * 60;

export function createGoogleWebAuthorization(input: {
  config: WebGoogleConfig;
  redirectUri: string;
  returnTo: string;
}): { authorizationUrl: string; state: string; maxAgeSeconds: number } {
  const statePayload: GoogleWebState = {
    v: 1,
    csrf: randomToken(),
    nonce: randomToken(),
    returnTo: safeReturnPath(input.returnTo),
    createdAt: unixSeconds(),
  };
  const state = signState(statePayload, input.config.stateSecret);
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);

  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", statePayload.nonce);
  url.searchParams.set("prompt", "select_account");

  return {
    authorizationUrl: url.toString(),
    state,
    maxAgeSeconds: STATE_TTL_SECONDS,
  };
}

export async function authenticateGoogleWebCallback(input: {
  code: string | null;
  state: string | null;
  expectedState: string | undefined;
  config: WebGoogleConfig;
  redirectUri: string;
}): Promise<{ identity: GoogleIdentity; state: GoogleWebState }> {
  if (
    input.code === null ||
    input.state === null ||
    input.expectedState === undefined ||
    !constantTimeStringEquals(input.state, input.expectedState)
  ) {
    throw new Error("Google callback is incomplete.");
  }

  const state = verifyState(input.state, input.config.stateSecret);
  const idToken = await exchangeCodeForIdToken({
    code: input.code,
    clientId: input.config.clientId,
    clientSecret: input.config.clientSecret,
    redirectUri: input.redirectUri,
  });
  const identity = await verifyIdToken({
    idToken,
    clientId: input.config.clientId,
    nonce: state.nonce,
  });

  if (!input.config.allowedEmails.includes(identity.email.toLowerCase())) {
    throw new Error("Google account is not authorized for this dashboard.");
  }

  return {
    identity,
    state,
  };
}

export function safeReturnPath(value: string | null | undefined): string {
  if (value === undefined || value === null || value.length === 0) {
    return "/";
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}

function signState(payload: GoogleWebState, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );

  return `${encodedPayload}.${signature(encodedPayload, secret)}`;
}

function verifyState(token: string, secret: string): GoogleWebState {
  const [encodedPayload, actualSignature] = token.split(".");

  if (encodedPayload === undefined || actualSignature === undefined) {
    throw new Error("Google state is malformed.");
  }

  const expectedSignature = signature(encodedPayload, secret);

  if (!constantTimeStringEquals(actualSignature, expectedSignature)) {
    throw new Error("Google state signature is invalid.");
  }

  const parsed = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8"),
  ) as unknown;

  if (!isGoogleWebState(parsed)) {
    throw new Error("Google state payload is invalid.");
  }

  if (parsed.createdAt + STATE_TTL_SECONDS < unixSeconds()) {
    throw new Error("Google state expired.");
  }

  return parsed;
}

async function exchangeCodeForIdToken(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
    }),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Google token exchange failed.");
  }

  const body = (await response.json()) as unknown;

  if (!isRecord(body) || typeof body.id_token !== "string") {
    throw new Error("Google token response did not include an ID token.");
  }

  return body.id_token;
}

async function verifyIdToken(input: {
  idToken: string;
  clientId: string;
  nonce: string;
}): Promise<GoogleIdentity> {
  const verified = await jwtVerify(
    input.idToken,
    createRemoteJWKSet(new URL(GOOGLE_JWKS_URI)),
    {
      audience: input.clientId,
      issuer: GOOGLE_ISSUERS,
    },
  );
  const payload: JWTPayload = verified.payload;

  if (payload.nonce !== input.nonce) {
    throw new Error("Google ID token nonce did not match state.");
  }

  if (
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    payload.email_verified !== true
  ) {
    throw new Error("Google ID token did not include a verified email.");
  }

  return {
    email: payload.email.toLowerCase(),
    subject: payload.sub,
  };
}

function signature(encodedPayload: string, secret: string): string {
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

function unixSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

function isGoogleWebState(value: unknown): value is GoogleWebState {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.v === 1 &&
    typeof value.csrf === "string" &&
    typeof value.nonce === "string" &&
    typeof value.returnTo === "string" &&
    typeof value.createdAt === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
