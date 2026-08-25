import { createHmac, timingSafeEqual } from "node:crypto";

export const FITNESS_WEB_SESSION_COOKIE = "fitness_web_session";
export const DEFAULT_WEB_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export type FitnessWebSession = Readonly<{
  userId: string;
  email: string;
  issuedAt: number;
  expiresAt: number;
}>;

export type IssueFitnessWebSessionInput = Readonly<{
  userId: string;
  email: string;
  secret: string;
  ttlSeconds?: number | undefined;
  now?: number | Date | undefined;
}>;

export type VerifyFitnessWebSessionInput = Readonly<{
  token: string | undefined;
  secret: string | undefined;
  now?: number | Date | undefined;
}>;

export type SerializeFitnessWebSessionCookieInput = Readonly<{
  token: string;
  maxAgeSeconds: number;
  secure: boolean;
}>;

export function issueFitnessWebSession(input: IssueFitnessWebSessionInput): {
  session: FitnessWebSession;
  token: string;
  maxAgeSeconds: number;
} {
  assertWebSessionSecret(input.secret);

  const issuedAt = unixSeconds(input.now);
  const maxAgeSeconds = input.ttlSeconds ?? DEFAULT_WEB_SESSION_TTL_SECONDS;
  const session: FitnessWebSession = {
    userId: input.userId,
    email: input.email.toLowerCase(),
    issuedAt,
    expiresAt: issuedAt + maxAgeSeconds,
  };

  return {
    session,
    token: signWebSession(session, input.secret),
    maxAgeSeconds,
  };
}

export function verifyFitnessWebSession(
  input: VerifyFitnessWebSessionInput,
): FitnessWebSession | undefined {
  if (
    input.token === undefined ||
    input.secret === undefined ||
    input.secret.length < 32
  ) {
    return undefined;
  }

  const [encodedPayload, actualSignature] = input.token.split(".");

  if (encodedPayload === undefined || actualSignature === undefined) {
    return undefined;
  }

  const expectedSignature = webSessionSignature(encodedPayload, input.secret);

  if (!constantTimeStringEquals(actualSignature, expectedSignature)) {
    return undefined;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
  } catch {
    return undefined;
  }

  if (!isFitnessWebSession(parsed)) {
    return undefined;
  }

  if (parsed.expiresAt <= unixSeconds(input.now)) {
    return undefined;
  }

  return parsed;
}

export function serializeFitnessWebSessionCookie(
  input: SerializeFitnessWebSessionCookieInput,
): string {
  return [
    `${FITNESS_WEB_SESSION_COOKIE}=${encodeURIComponent(input.token)}`,
    "Path=/",
    `Max-Age=${input.maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(input.secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearFitnessWebSessionCookie(secure: boolean): string {
  return [
    `${FITNESS_WEB_SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function assertWebSessionSecret(secret: string): void {
  if (secret.length < 32) {
    throw new Error("Web session secret must be at least 32 characters.");
  }
}

function signWebSession(session: FitnessWebSession, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(session)).toString(
    "base64url",
  );

  return `${encodedPayload}.${webSessionSignature(encodedPayload, secret)}`;
}

function webSessionSignature(encodedPayload: string, secret: string): string {
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

function unixSeconds(now: number | Date | undefined): number {
  if (typeof now === "number") {
    return now;
  }

  if (now instanceof Date) {
    return Math.floor(now.getTime() / 1_000);
  }

  return Math.floor(Date.now() / 1_000);
}

function isFitnessWebSession(value: unknown): value is FitnessWebSession {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.userId === "string" &&
    typeof value.email === "string" &&
    typeof value.issuedAt === "number" &&
    typeof value.expiresAt === "number" &&
    value.issuedAt < value.expiresAt
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
