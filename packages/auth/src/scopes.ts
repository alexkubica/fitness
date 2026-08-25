const firstSliceMcpScopes = [
  "health:read",
  "coach:read",
  "report:read",
] as const;

const mcpMealWriteScopes = ["meal:write"] as const;
const coachWriteScopes = ["coach:write"] as const;

const deferredMcpWriteScopes = [
  "checkin:write",
  "writeback:prepare",
  "writeback:commit",
] as const;

const healthSyncScopes = ["health:write", "health:sync"] as const;

const iosAppScopes = [
  ...healthSyncScopes,
  "meal:write",
  ...coachWriteScopes,
] as const;

const mcpConnectorScopes = [
  ...firstSliceMcpScopes,
  ...mcpMealWriteScopes,
  ...coachWriteScopes,
] as const;

const allAuthScopes = [
  ...firstSliceMcpScopes,
  ...mcpMealWriteScopes,
  ...coachWriteScopes,
  ...deferredMcpWriteScopes,
  ...healthSyncScopes,
] as const;

export type FirstSliceMcpScope = (typeof firstSliceMcpScopes)[number];
export type McpMealWriteScope = (typeof mcpMealWriteScopes)[number];
export type CoachWriteScope = (typeof coachWriteScopes)[number];
export type McpConnectorScope = (typeof mcpConnectorScopes)[number];
export type DeferredMcpWriteScope = (typeof deferredMcpWriteScopes)[number];
export type HealthSyncScope = (typeof healthSyncScopes)[number];
export type IosAppScope = (typeof iosAppScopes)[number];
export type AuthScope = (typeof allAuthScopes)[number];

export const FIRST_SLICE_MCP_SCOPES: readonly FirstSliceMcpScope[] =
  Object.freeze([...firstSliceMcpScopes]);

export const MCP_MEAL_WRITE_SCOPES: readonly McpMealWriteScope[] =
  Object.freeze([...mcpMealWriteScopes]);

export const COACH_WRITE_SCOPES: readonly CoachWriteScope[] = Object.freeze([
  ...coachWriteScopes,
]);

export const MCP_CONNECTOR_SCOPES: readonly McpConnectorScope[] = Object.freeze(
  [...mcpConnectorScopes],
);

export const DEFERRED_MCP_WRITE_SCOPES: readonly DeferredMcpWriteScope[] =
  Object.freeze([...deferredMcpWriteScopes]);

export const HEALTH_SYNC_SCOPES: readonly HealthSyncScope[] = Object.freeze([
  ...healthSyncScopes,
]);

export const IOS_APP_SCOPES: readonly IosAppScope[] = Object.freeze([
  ...iosAppScopes,
]);

export const ALL_AUTH_SCOPES: readonly AuthScope[] = Object.freeze([
  ...allAuthScopes,
]);

export function isAuthScope(value: string): value is AuthScope {
  return (ALL_AUTH_SCOPES as readonly string[]).includes(value);
}

export function getDefaultMcpScopes(): readonly McpConnectorScope[] {
  return MCP_CONNECTOR_SCOPES;
}

export function assertNoDeferredScopes(scopes: readonly string[]): void {
  const deferredScope = scopes.find((scope) =>
    (DEFERRED_MCP_WRITE_SCOPES as readonly string[]).includes(scope),
  );

  if (deferredScope !== undefined) {
    throw new Error(
      `Deferred MCP write scope "${deferredScope}" cannot be requested by default.`,
    );
  }
}

export function hasRequiredScopes(
  grantedScopes: readonly string[],
  requiredScopes: readonly string[],
): boolean {
  const grantedScopeSet = new Set(grantedScopes);
  return requiredScopes.every((scope) => grantedScopeSet.has(scope));
}
