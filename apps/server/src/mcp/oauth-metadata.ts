import { MCP_CONNECTOR_SCOPES } from "@fitness/auth";
import { parseFitnessJwksJson, type FitnessJwks } from "@fitness/auth";
import type { Hono } from "hono";
import type { ServerEnv } from "../auth.js";

export const MCP_PROTECTED_RESOURCE_METADATA_PATH =
  "/.well-known/oauth-protected-resource";
export const AUTHORIZATION_SERVER_METADATA_PATH =
  "/.well-known/oauth-authorization-server";
export const OIDC_CONFIGURATION_PATH = "/.well-known/openid-configuration";
export const JWKS_PATH = "/.well-known/jwks.json";

export type McpOAuthConfig = Readonly<{
  resource: string;
  issuer: string;
  audience: string;
  metadataUrl: string;
  expectedSubject?: string | undefined;
  trustedJwks?: FitnessJwks | undefined;
  revokedTokenIds?: ReadonlySet<string> | readonly string[] | undefined;
  now?: number | Date | undefined;
  clockToleranceSeconds?: number | undefined;
}>;

export type McpOAuthEnvironment = Readonly<Record<string, string | undefined>>;

export type ProtectedResourceMetadata = Readonly<{
  resource: string;
  authorization_servers: readonly string[];
  scopes_supported: readonly string[];
  bearer_methods_supported: readonly ["header"];
}>;

export type AuthorizationServerMetadata = Readonly<{
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  response_types_supported: readonly ["code"];
  grant_types_supported: readonly ["authorization_code", "refresh_token"];
  token_endpoint_auth_methods_supported: readonly ["none"];
  code_challenge_methods_supported: readonly ["S256"];
  scopes_supported: readonly string[];
  client_registration_strategy: "predefined";
  dynamic_client_registration_supported: false;
}>;

export type OpenIdConfigurationMetadata = AuthorizationServerMetadata &
  Readonly<{
    subject_types_supported: readonly ["public"];
    id_token_signing_alg_values_supported: readonly ["RS256"];
  }>;

export const DEFAULT_MCP_OAUTH_CONFIG: McpOAuthConfig = {
  resource: "https://mcp.fitness.local/mcp",
  issuer: "https://mcp.fitness.local",
  audience: "fitness-mcp",
  metadataUrl: "https://mcp.fitness.local/.well-known/oauth-protected-resource",
  expectedSubject: "user_alex",
};

export function resolveMcpOAuthConfig(
  config: Partial<McpOAuthConfig> = {},
  env: McpOAuthEnvironment = envRecord(),
): McpOAuthConfig {
  const externalOrigin = externalOriginFromEnv(env);
  const resource =
    config.resource ??
    envString(env, "MCP_RESOURCE_URL") ??
    mcpResourceForExternalOrigin(externalOrigin) ??
    DEFAULT_MCP_OAUTH_CONFIG.resource;
  const issuer =
    config.issuer ?? envString(env, "MCP_ISSUER_URL") ?? originForUrl(resource);

  return {
    resource,
    issuer,
    audience:
      config.audience ??
      envString(env, "MCP_AUDIENCE") ??
      DEFAULT_MCP_OAUTH_CONFIG.audience,
    metadataUrl:
      config.metadataUrl ??
      envString(env, "MCP_METADATA_URL") ??
      metadataUrlForResource(resource),
    expectedSubject:
      config.expectedSubject ??
      envString(env, "MCP_EXPECTED_SUBJECT") ??
      DEFAULT_MCP_OAUTH_CONFIG.expectedSubject,
    trustedJwks:
      config.trustedJwks ??
      trustedJwksFromEnv(envString(env, "AUTH_JWKS_JSON")),
    revokedTokenIds: config.revokedTokenIds,
    now: config.now,
    clockToleranceSeconds: config.clockToleranceSeconds,
  };
}

export function buildProtectedResourceMetadata(
  config: McpOAuthConfig,
): ProtectedResourceMetadata {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: MCP_CONNECTOR_SCOPES,
    bearer_methods_supported: ["header"],
  };
}

export function buildAuthorizationServerMetadata(
  config: McpOAuthConfig,
): AuthorizationServerMetadata {
  return {
    issuer: config.issuer,
    authorization_endpoint: issuerUrl(config.issuer, "/oauth2/authorize"),
    token_endpoint: issuerUrl(config.issuer, "/oauth2/token"),
    jwks_uri: issuerUrl(config.issuer, "/.well-known/jwks.json"),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: MCP_CONNECTOR_SCOPES,
    client_registration_strategy: "predefined",
    dynamic_client_registration_supported: false,
  };
}

export function buildOpenIdConfigurationMetadata(
  config: McpOAuthConfig,
): OpenIdConfigurationMetadata {
  return {
    ...buildAuthorizationServerMetadata(config),
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  };
}

export function registerMcpOAuthMetadataRoutes(
  app: Hono<ServerEnv>,
  config: McpOAuthConfig = DEFAULT_MCP_OAUTH_CONFIG,
): void {
  app.get(MCP_PROTECTED_RESOURCE_METADATA_PATH, (context) =>
    context.json(buildProtectedResourceMetadata(config)),
  );
  app.get(AUTHORIZATION_SERVER_METADATA_PATH, (context) =>
    context.json(buildAuthorizationServerMetadata(config)),
  );
  app.get(OIDC_CONFIGURATION_PATH, (context) =>
    context.json(buildOpenIdConfigurationMetadata(config)),
  );
  app.get(JWKS_PATH, (context) =>
    context.json(config.trustedJwks ?? { keys: [] }),
  );
}

function issuerUrl(issuer: string, path: `/${string}`): string {
  return `${issuer.replace(/\/+$/u, "")}${path}`;
}

function metadataUrlForResource(resource: string): string {
  return new URL(MCP_PROTECTED_RESOURCE_METADATA_PATH, resource).toString();
}

function mcpResourceForExternalOrigin(
  externalOrigin: string | undefined,
): string | undefined {
  if (externalOrigin === undefined) {
    return undefined;
  }

  try {
    return new URL("/mcp", externalOrigin).toString();
  } catch {
    return undefined;
  }
}

function originForUrl(url: string): string {
  return new URL(url).origin;
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

function envString(env: McpOAuthEnvironment, name: string): string | undefined {
  const value = env[name];

  return value === undefined || value.length === 0 ? undefined : value;
}

function externalOriginFromEnv(env: McpOAuthEnvironment): string | undefined {
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

function trustedJwksFromEnv(
  value: string | undefined,
): FitnessJwks | undefined {
  return value === undefined ? undefined : parseFitnessJwksJson(value);
}

function envRecord(): McpOAuthEnvironment {
  const globalWithProcess = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return globalWithProcess.process?.env ?? {};
}
