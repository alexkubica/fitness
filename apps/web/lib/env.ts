export const DEFAULT_BACKEND_ORIGIN = "https://fitness-ten-fawn.vercel.app";

export type WebGoogleConfig = Readonly<{
  clientId: string;
  clientSecret: string;
  allowedEmails: readonly string[];
  stateSecret: string;
}>;

export type GoogleConfigStatus = "configured" | "invalid" | "missing";

export function backendOrigin(): string {
  return (
    trimmedEnv("NEXT_PUBLIC_FITNESS_BACKEND_URL") ?? DEFAULT_BACKEND_ORIGIN
  );
}

export function mcpEndpoint(): string {
  return new URL("/mcp", backendOrigin()).toString();
}

export function webBuildLabel(): string {
  const version = trimmedEnv("NEXT_PUBLIC_FITNESS_WEB_VERSION") ?? "0.0.0";
  const commit =
    trimmedEnv("NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA") ??
    trimmedEnv("VERCEL_GIT_COMMIT_SHA") ??
    trimmedEnv("NEXT_PUBLIC_FITNESS_WEB_BUILD");
  const build = commit === undefined ? "local" : commit.slice(0, 7);

  return `v${version} (${build})`;
}

export function webAuthUserId(): string {
  return (
    trimmedEnv("WEB_AUTH_USER_ID") ??
    trimmedEnv("OAUTH_USER_ID") ??
    trimmedEnv("MCP_EXPECTED_SUBJECT") ??
    "user_alex"
  );
}

export function webSessionSecret(): string | undefined {
  return (
    trimmedEnv("WEB_SESSION_SECRET") ??
    trimmedEnv("GOOGLE_AUTH_STATE_SECRET") ??
    trimmedEnv("AUTH_SESSION_SECRET")
  );
}

export function webSessionTtlSeconds(): number {
  const rawValue = trimmedEnv("WEB_SESSION_TTL_SECONDS");
  const parsed = rawValue === undefined ? Number.NaN : Number(rawValue);

  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : 30 * 24 * 60 * 60;
}

export function googleConfig(): WebGoogleConfig | undefined {
  const clientId = trimmedEnv("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = trimmedEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  const stateSecret = webSessionSecret();
  const allowedEmails = csvEnv(
    trimmedEnv("GOOGLE_AUTH_ALLOWED_EMAILS") ??
      trimmedEnv("GOOGLE_ALLOWED_EMAILS"),
  );

  if (
    clientId === undefined &&
    clientSecret === undefined &&
    stateSecret === undefined &&
    allowedEmails.length === 0
  ) {
    return undefined;
  }

  if (
    clientId === undefined ||
    clientSecret === undefined ||
    stateSecret === undefined ||
    stateSecret.length < 32 ||
    allowedEmails.length === 0
  ) {
    throw new Error(
      "Web Google login requires GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_AUTH_ALLOWED_EMAILS, and a 32+ char WEB_SESSION_SECRET or GOOGLE_AUTH_STATE_SECRET.",
    );
  }

  return {
    clientId,
    clientSecret,
    allowedEmails: allowedEmails.map((email) => email.toLowerCase()),
    stateSecret,
  };
}

export function googleConfigStatus(): GoogleConfigStatus {
  try {
    return googleConfig() === undefined ? "missing" : "configured";
  } catch {
    return "invalid";
  }
}

export function trimmedEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();

  return value === undefined || value.length === 0 ? undefined : value;
}

function csvEnv(value: string | undefined): readonly string[] {
  return (
    value
      ?.split(",")
      .map((part) => part.trim())
      .filter(Boolean) ?? []
  );
}
