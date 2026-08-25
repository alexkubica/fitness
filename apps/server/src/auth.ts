import {
  IOS_APP_SCOPES,
  MCP_CONNECTOR_SCOPES,
  decodeFakeAuthToken,
  parseFitnessJwksJson,
  validateTokenClaims,
  verifyFitnessJwt,
  type AuthScope,
  type FitnessJwks,
  type FitnessTokenClaims,
  type TokenValidationOptions,
  type TokenValidationReason,
} from "@fitness/auth";
import type { MiddlewareHandler } from "hono";

export type AuthContext = Readonly<{
  actorUserId: string;
  userId: string;
  actor: {
    type: "user";
    id: string;
  };
  claims: FitnessTokenClaims;
  scopes: readonly AuthScope[];
}>;

export type ServerEnv = {
  Variables: {
    auth: AuthContext;
  };
};

export type ServerAuthConfig = Readonly<{
  expectedIssuer: string;
  expectedAudience: string | readonly string[];
  expectedResource: string;
  expectedSubject?: string | undefined;
  trustedJwks?: FitnessJwks | undefined;
  revokedTokenIds?: ReadonlySet<string> | readonly string[] | undefined;
  now?: number | Date | undefined;
  clockToleranceSeconds?: number | undefined;
}>;

export type ServerAuthEnvironment = Readonly<
  Record<string, string | undefined>
>;

export const DEFAULT_SERVER_AUTH_CONFIG: ServerAuthConfig = {
  expectedIssuer: "https://auth.fitness.local",
  expectedAudience: "fitness-api",
  expectedResource: "https://api.fitness.local",
  expectedSubject: "user_alex",
};

const API_ROUTE_SCOPES: readonly AuthScope[] = Object.freeze([
  ...new Set([...IOS_APP_SCOPES, ...MCP_CONNECTOR_SCOPES]),
]);

export function resolveServerAuthConfig(
  config: Partial<ServerAuthConfig> = {},
  env: ServerAuthEnvironment = envRecord(),
): ServerAuthConfig {
  const externalOrigin = externalOriginFromEnv(env);

  return {
    expectedIssuer:
      config.expectedIssuer ??
      envString(env, "HEALTH_SYNC_TOKEN_ISSUER") ??
      externalOrigin ??
      DEFAULT_SERVER_AUTH_CONFIG.expectedIssuer,
    expectedAudience:
      config.expectedAudience ??
      envString(env, "HEALTH_SYNC_TOKEN_AUDIENCE") ??
      DEFAULT_SERVER_AUTH_CONFIG.expectedAudience,
    expectedResource:
      config.expectedResource ??
      envString(env, "HEALTH_SYNC_TOKEN_RESOURCE") ??
      externalOrigin ??
      DEFAULT_SERVER_AUTH_CONFIG.expectedResource,
    expectedSubject:
      config.expectedSubject ??
      envString(env, "HEALTH_SYNC_EXPECTED_SUBJECT") ??
      DEFAULT_SERVER_AUTH_CONFIG.expectedSubject,
    trustedJwks:
      config.trustedJwks ??
      trustedJwksFromEnv(envString(env, "AUTH_JWKS_JSON")),
    revokedTokenIds: config.revokedTokenIds,
    now: config.now,
    clockToleranceSeconds: config.clockToleranceSeconds,
  };
}

export function requireHealthSyncAuth(
  config: ServerAuthConfig = DEFAULT_SERVER_AUTH_CONFIG,
): MiddlewareHandler<ServerEnv> {
  return async (context, next) => {
    const authorization = context.req.header("authorization");
    const token = bearerToken(authorization);

    if (token === undefined) {
      return context.json({ error: "unauthorized" }, 401);
    }

    const decodedClaims = await decodeHealthTokenClaims(token, config);

    if (decodedClaims.ok === false) {
      const error = decodedClaims.error;

      return context.json(
        {
          error,
        },
        401,
      );
    }

    const claims = decodedClaims.claims;

    const validationOptions: TokenValidationOptions = {
      expectedIssuer: config.expectedIssuer,
      expectedAudience: config.expectedAudience,
      expectedResource: config.expectedResource,
      requiredScopes: [],
      allowedScopes: API_ROUTE_SCOPES,
      ...(config.expectedSubject === undefined
        ? {}
        : { expectedSubject: config.expectedSubject }),
      ...(config.revokedTokenIds === undefined
        ? {}
        : { revokedTokenIds: config.revokedTokenIds }),
      ...(config.now === undefined ? {} : { now: config.now }),
      ...(config.clockToleranceSeconds === undefined
        ? {}
        : { clockToleranceSeconds: config.clockToleranceSeconds }),
    };
    const validation = validateTokenClaims(claims, validationOptions);

    if (validation.ok === false) {
      const reason = validation.reason;

      return context.json(
        {
          error: errorNameForValidationReason(reason),
        },
        statusForValidationReason(reason),
      );
    }

    const auth: AuthContext = {
      actorUserId: validation.claims.sub,
      userId: validation.claims.sub,
      actor: {
        type: "user",
        id: validation.claims.sub,
      },
      claims: validation.claims,
      scopes: validation.scopes,
    };

    context.set("auth", auth);
    await next();
  };
}

function bearerToken(authorization: string | undefined): string | undefined {
  if (authorization === undefined) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/iu.exec(authorization);

  return match?.[1];
}

type DecodedTokenClaimsResult =
  | Readonly<{ ok: true; claims: FitnessTokenClaims }>
  | Readonly<{ ok: false; error: "malformed" | "unauthorized" }>;

async function decodeHealthTokenClaims(
  token: string,
  config: ServerAuthConfig,
): Promise<DecodedTokenClaimsResult> {
  if (serverFakeAuthTokensAllowed()) {
    try {
      return { ok: true, claims: decodeFakeAuthToken(token) };
    } catch (error) {
      if (config.trustedJwks === undefined) {
        return { ok: false, error: fakeTokenDecodeError(error) };
      }
    }
  }

  if (config.trustedJwks === undefined) {
    return { ok: false, error: "unauthorized" };
  }

  try {
    return {
      ok: true,
      claims: await verifyFitnessJwt(token, {
        audience: config.expectedAudience,
        issuer: config.expectedIssuer,
        jwks: config.trustedJwks,
        ...(config.now === undefined ? {} : { now: config.now }),
      }),
    };
  } catch {
    return { ok: false, error: "malformed" };
  }
}

function serverFakeAuthTokensAllowed(): boolean {
  const nodeEnv = envValue("NODE_ENV");

  if (nodeEnv === "production") {
    return false;
  }

  return nodeEnv === "test" || envValue("ALLOW_FAKE_AUTH_TOKENS") === "1";
}

function envValue(name: string): string | undefined {
  const globalWithProcess = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return globalWithProcess.process?.env?.[name];
}

function envString(
  env: ServerAuthEnvironment,
  name: string,
): string | undefined {
  const value = env[name];

  return value === undefined || value.length === 0 ? undefined : value;
}

function externalOriginFromEnv(env: ServerAuthEnvironment): string | undefined {
  return (
    originFromUrl(envString(env, "FITNESS_EXTERNAL_URL")) ??
    originFromUrl(envString(env, "RENDER_EXTERNAL_URL")) ??
    originFromVercelDomain(envString(env, "VERCEL_PROJECT_PRODUCTION_URL")) ??
    originFromVercelDomain(envString(env, "VERCEL_BRANCH_URL")) ??
    originFromVercelDomain(envString(env, "VERCEL_URL"))
  );
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

function originFromVercelDomain(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return originFromUrl(value.includes("://") ? value : `https://${value}`);
}

function trustedJwksFromEnv(
  value: string | undefined,
): FitnessJwks | undefined {
  return value === undefined ? undefined : parseFitnessJwksJson(value);
}

function envRecord(): ServerAuthEnvironment {
  const globalWithProcess = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return globalWithProcess.process?.env ?? {};
}

function fakeTokenDecodeError(error: unknown): "malformed" | "unauthorized" {
  if (
    error instanceof Error &&
    error.message.toLowerCase().includes("disabled")
  ) {
    return "unauthorized";
  }

  return "malformed";
}

function statusForValidationReason(reason: TokenValidationReason): 401 | 403 {
  switch (reason) {
    case "missing-scope":
    case "overbroad-scope":
    case "wrong-user":
      return 403;
    default:
      return 401;
  }
}

function errorNameForValidationReason(
  reason: TokenValidationReason,
): TokenValidationReason | "missing-scope" {
  if (reason === "overbroad-scope") {
    return "missing-scope";
  }

  return reason;
}
