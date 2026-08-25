import { IOS_APP_SCOPES, MCP_CONNECTOR_SCOPES } from "./scopes.js";
import { signFitnessJwt, type FitnessJwtPrivateJwk } from "./signed-tokens.js";
import type { AuthScope } from "./scopes.js";
import type { FitnessTokenClaims } from "./token-claims.js";

export type FitnessTokenProfile = "mcp" | "healthkit";

export type IssueFitnessProfileTokenOptions = Readonly<{
  profile: FitnessTokenProfile;
  privateJwk: FitnessJwtPrivateJwk;
  keyId?: string;
  issuer?: string;
  audience?: string;
  resource?: string;
  subject?: string;
  scopes?: readonly AuthScope[];
  ttlSeconds?: number;
  tokenId?: string;
  now?: number | Date;
}>;

export type IssuedFitnessProfileToken = Readonly<{
  token: string;
  claims: FitnessTokenClaims;
}>;

const DEFAULT_MCP_TOKEN_PROFILE = {
  issuer: "https://mcp.fitness.local",
  audience: "fitness-mcp",
  resource: "https://mcp.fitness.local/mcp",
  subject: "user_alex",
  scopes: MCP_CONNECTOR_SCOPES,
  allowedScopes: MCP_CONNECTOR_SCOPES,
} as const;

const DEFAULT_HEALTHKIT_TOKEN_PROFILE = {
  issuer: "https://auth.fitness.local",
  audience: "fitness-api",
  resource: "https://api.fitness.local",
  subject: "user_alex",
  scopes: ["health:write"] as const satisfies readonly AuthScope[],
  allowedScopes: IOS_APP_SCOPES,
} as const;

const DEFAULT_TOKEN_TTL_SECONDS = 300;
const MAX_SHORT_LIVED_TOKEN_TTL_SECONDS = 3_600;

export async function issueFitnessProfileToken(
  options: IssueFitnessProfileTokenOptions,
): Promise<IssuedFitnessProfileToken> {
  const profileDefaults = defaultsForProfile(options.profile);
  const now = unixSeconds(options.now);
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS;
  assertValidTtlSeconds(ttlSeconds);
  const scopes = options.scopes ?? profileDefaults.scopes;
  assertProfileScopes(scopes, profileDefaults.allowedScopes);
  const claims: FitnessTokenClaims = {
    iss: options.issuer ?? profileDefaults.issuer,
    aud: options.audience ?? profileDefaults.audience,
    resource: options.resource ?? profileDefaults.resource,
    sub: options.subject ?? profileDefaults.subject,
    iat: now,
    exp: now + ttlSeconds,
    scope: scopes.join(" "),
    ...(options.tokenId === undefined ? {} : { jti: options.tokenId }),
  };

  return {
    token: await signFitnessJwt(claims, {
      keyId: options.keyId ?? options.privateJwk.kid,
      privateJwk: options.privateJwk,
    }),
    claims,
  };
}

function assertValidTtlSeconds(ttlSeconds: number): void {
  if (
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds <= 0 ||
    ttlSeconds > MAX_SHORT_LIVED_TOKEN_TTL_SECONDS
  ) {
    throw new Error(
      `Token ttlSeconds must be a positive integer no greater than ${MAX_SHORT_LIVED_TOKEN_TTL_SECONDS}.`,
    );
  }
}

function defaultsForProfile(profile: FitnessTokenProfile): Readonly<{
  issuer: string;
  audience: string;
  resource: string;
  subject: string;
  scopes: readonly AuthScope[];
  allowedScopes: readonly AuthScope[];
}> {
  switch (profile) {
    case "mcp":
      return DEFAULT_MCP_TOKEN_PROFILE;
    case "healthkit":
      return DEFAULT_HEALTHKIT_TOKEN_PROFILE;
  }
}

function assertProfileScopes(
  scopes: readonly AuthScope[],
  allowedScopes: readonly AuthScope[],
): void {
  if (scopes.length === 0) {
    throw new Error("Token scopes must include at least one approved scope.");
  }

  const allowedScopeSet = new Set<AuthScope>(allowedScopes);
  const unapprovedScope = scopes.find((scope) => !allowedScopeSet.has(scope));

  if (unapprovedScope !== undefined) {
    throw new Error(`Scope "${unapprovedScope}" is not approved for profile.`);
  }
}

function unixSeconds(now: number | Date | undefined): number {
  if (now instanceof Date) {
    return Math.floor(now.getTime() / 1000);
  }

  return now ?? Math.floor(Date.now() / 1000);
}
