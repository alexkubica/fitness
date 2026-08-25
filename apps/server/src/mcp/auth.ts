import {
  FIRST_SLICE_MCP_SCOPES,
  MCP_CONNECTOR_SCOPES,
  decodeFakeAuthToken,
  validateTokenClaims,
  verifyFitnessJwt,
  type AuthScope,
  type FitnessTokenClaims,
  type TokenValidationOptions,
  type TokenValidationReason,
} from "@fitness/auth";
import type { MiddlewareHandler } from "hono";
import type { AuthContext, ServerEnv } from "../auth.js";
import {
  DEFAULT_MCP_OAUTH_CONFIG,
  type McpOAuthConfig,
} from "./oauth-metadata.js";

type McpBearerError = "invalid_token" | "insufficient_scope";

export function requireMcpAuth(
  config: McpOAuthConfig = DEFAULT_MCP_OAUTH_CONFIG,
  requiredScopes: readonly AuthScope[] = FIRST_SLICE_MCP_SCOPES,
): MiddlewareHandler<ServerEnv> {
  return async (context, next) => {
    const token = bearerToken(context.req.header("authorization"));

    if (token === undefined) {
      context.header(
        "WWW-Authenticate",
        mcpAuthenticateChallenge(config, requiredScopes),
      );
      return context.json({ error: "unauthorized" }, 401);
    }

    const decodedClaims = await decodeMcpTokenClaims(token, config);

    if (decodedClaims.ok === false) {
      const error = decodedClaims.error;

      return rejectMcpAuth(
        context,
        config,
        requiredScopes,
        error,
        401,
        "invalid_token",
      );
    }

    const claims = decodedClaims.claims;

    const validationOptions: TokenValidationOptions = {
      expectedIssuer: config.issuer,
      expectedAudience: config.audience,
      expectedResource: config.resource,
      requiredScopes,
      allowedScopes: MCP_CONNECTOR_SCOPES,
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

      return rejectMcpAuth(
        context,
        config,
        requiredScopes,
        errorNameForValidationReason(reason),
        statusForValidationReason(reason),
        challengeErrorForValidationReason(reason),
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

async function decodeMcpTokenClaims(
  token: string,
  config: McpOAuthConfig,
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
        audience: config.audience,
        issuer: config.issuer,
        jwks: config.trustedJwks,
        ...(config.now === undefined ? {} : { now: config.now }),
      }),
    };
  } catch {
    return { ok: false, error: "malformed" };
  }
}

function mcpAuthenticateChallenge(
  config: McpOAuthConfig,
  requiredScopes: readonly AuthScope[],
  error?: McpBearerError,
): string {
  const challengeParams = [
    ...(error === undefined ? [] : [`error="${error}"`]),
    `resource_metadata="${config.metadataUrl}"`,
    `scope="${requiredScopes.join(" ")}"`,
  ];

  return `Bearer ${challengeParams.join(", ")}`;
}

function rejectMcpAuth(
  context: Parameters<MiddlewareHandler<ServerEnv>>[0],
  config: McpOAuthConfig,
  requiredScopes: readonly AuthScope[],
  error: TokenValidationReason | "unauthorized" | "missing-scope",
  status: 401 | 403,
  challengeError: McpBearerError,
): Response {
  context.header(
    "WWW-Authenticate",
    mcpAuthenticateChallenge(config, requiredScopes, challengeError),
  );
  return context.json({ error }, status);
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

function challengeErrorForValidationReason(
  reason: TokenValidationReason,
): McpBearerError {
  switch (reason) {
    case "missing-scope":
    case "overbroad-scope":
      return "insufficient_scope";
    default:
      return "invalid_token";
  }
}
