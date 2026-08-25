import {
  FIRST_SLICE_MCP_SCOPES,
  hasRequiredScopes,
  isAuthScope,
  type AuthScope,
} from "./scopes.js";

export type FitnessTokenClaims = Readonly<{
  iss: string;
  aud: string | readonly string[];
  sub: string;
  exp: number;
  iat: number;
  scope: string;
  resource?: string | readonly string[];
  jti?: string;
}>;

export type TokenValidationReason =
  | "malformed"
  | "expired"
  | "revoked"
  | "wrong-user"
  | "wrong-audience"
  | "wrong-resource"
  | "wrong-issuer"
  | "missing-scope"
  | "overbroad-scope";

export type TokenValidationOptions = Readonly<{
  expectedIssuer: string;
  expectedAudience: string | readonly string[];
  expectedResource?: string;
  expectedSubject?: string;
  requiredScopes: readonly AuthScope[];
  allowedScopes?: readonly AuthScope[];
  revokedTokenIds?: ReadonlySet<string> | readonly string[];
  now?: number | Date;
  clockToleranceSeconds?: number;
}>;

export type TokenValidationResult =
  | Readonly<{
      ok: true;
      claims: FitnessTokenClaims;
      scopes: readonly AuthScope[];
    }>
  | Readonly<{
      ok: false;
      reason: TokenValidationReason;
      message: string;
    }>;

type ParsedClaimsResult =
  | Readonly<{ ok: true; claims: FitnessTokenClaims }>
  | Readonly<{ ok: false; reason: "malformed" | "missing-scope" }>;

export function isFitnessTokenClaims(
  value: unknown,
): value is FitnessTokenClaims {
  return parseFitnessTokenClaims(value).ok;
}

export function validateTokenClaims(
  value: unknown,
  options: TokenValidationOptions,
): TokenValidationResult {
  const parsedClaims = parseFitnessTokenClaims(value);

  if (!parsedClaims.ok) {
    return invalid(
      parsedClaims.reason,
      parsedClaims.reason === "missing-scope"
        ? "Token claims do not include a usable scope string."
        : "Token claims are malformed.",
    );
  }

  const claims = parsedClaims.claims;

  if (claims.iss !== options.expectedIssuer) {
    return invalid("wrong-issuer", "Token issuer does not match.");
  }

  if (!containsExpectedValue(claims.aud, options.expectedAudience)) {
    return invalid("wrong-audience", "Token audience does not match.");
  }

  if (
    options.expectedResource !== undefined &&
    (claims.resource === undefined ||
      !containsExpectedValue(claims.resource, options.expectedResource))
  ) {
    return invalid("wrong-resource", "Token resource does not match.");
  }

  if (
    options.expectedSubject !== undefined &&
    claims.sub !== options.expectedSubject
  ) {
    return invalid("wrong-user", "Token subject does not match the user.");
  }

  const now = unixSeconds(options.now);
  const clockToleranceSeconds = options.clockToleranceSeconds ?? 0;

  if (claims.exp <= now - clockToleranceSeconds) {
    return invalid("expired", "Token has expired.");
  }

  if (isRevoked(claims.jti, options.revokedTokenIds)) {
    return invalid("revoked", "Token identifier has been revoked.");
  }

  const scopeValues = parseScopeString(claims.scope);

  if (scopeValues.length === 0) {
    return invalid("missing-scope", "Token claims do not include scopes.");
  }

  const allowedScopes = new Set(
    options.allowedScopes ?? FIRST_SLICE_MCP_SCOPES,
  );
  const scopes: AuthScope[] = [];

  for (const scope of scopeValues) {
    if (!isAuthScope(scope) || !allowedScopes.has(scope)) {
      return invalid(
        "overbroad-scope",
        `Token includes unapproved scope "${scope}".`,
      );
    }

    scopes.push(scope);
  }

  if (!hasRequiredScopes(scopes, options.requiredScopes)) {
    return invalid("missing-scope", "Token is missing a required scope.");
  }

  return {
    ok: true,
    claims,
    scopes,
  };
}

function parseFitnessTokenClaims(value: unknown): ParsedClaimsResult {
  if (!isRecord(value)) {
    return { ok: false, reason: "malformed" };
  }

  if (
    typeof value.iss !== "string" ||
    !isStringOrStringArray(value.aud) ||
    typeof value.sub !== "string" ||
    !isFiniteNumber(value.exp) ||
    !isFiniteNumber(value.iat)
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (typeof value.scope !== "string" || value.scope.trim().length === 0) {
    return { ok: false, reason: "missing-scope" };
  }

  if (value.resource !== undefined && !isStringOrStringArray(value.resource)) {
    return { ok: false, reason: "malformed" };
  }

  if (value.jti !== undefined && typeof value.jti !== "string") {
    return { ok: false, reason: "malformed" };
  }

  return { ok: true, claims: value as FitnessTokenClaims };
}

function invalid(
  reason: TokenValidationReason,
  message: string,
): TokenValidationResult {
  return {
    ok: false,
    reason,
    message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isStringOrStringArray(
  value: unknown,
): value is string | readonly string[] {
  return typeof value === "string" || isStringArray(value);
}

function toValues(value: string | readonly string[]): readonly string[] {
  return typeof value === "string" ? [value] : value;
}

function containsExpectedValue(
  actual: string | readonly string[],
  expected: string | readonly string[],
): boolean {
  const actualValues = toValues(actual);
  return toValues(expected).some((expectedValue) =>
    actualValues.includes(expectedValue),
  );
}

function unixSeconds(now: number | Date | undefined): number {
  if (now instanceof Date) {
    return Math.floor(now.getTime() / 1000);
  }

  return now ?? Math.floor(Date.now() / 1000);
}

function isRevoked(
  tokenId: string | undefined,
  revokedTokenIds: ReadonlySet<string> | readonly string[] | undefined,
): boolean {
  if (tokenId === undefined || revokedTokenIds === undefined) {
    return false;
  }

  return Array.from(revokedTokenIds).includes(tokenId);
}

function parseScopeString(scope: string): readonly string[] {
  return scope.split(/\s+/u).filter((scopeValue) => scopeValue.length > 0);
}
