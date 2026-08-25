import {
  isFitnessTokenClaims,
  type FitnessTokenClaims,
} from "./token-claims.js";

export const FAKE_AUTH_TOKEN_PREFIX = "fitness.fake-auth-token.v1.";

export function fakeAuthTokensAllowed(): boolean {
  return (
    envValue("NODE_ENV") === "test" ||
    envValue("ALLOW_FAKE_AUTH_TOKENS") === "1"
  );
}

export function createFakeAuthToken(claims: FitnessTokenClaims): string {
  assertFakeAuthTokensAllowed();
  return `${FAKE_AUTH_TOKEN_PREFIX}${encodeURIComponent(JSON.stringify(claims))}`;
}

export function decodeFakeAuthToken(token: string): FitnessTokenClaims {
  assertFakeAuthTokensAllowed();

  if (!token.startsWith(FAKE_AUTH_TOKEN_PREFIX)) {
    throw new Error("Malformed fake auth token.");
  }

  const encodedClaims = token.slice(FAKE_AUTH_TOKEN_PREFIX.length);

  try {
    const parsedClaims: unknown = JSON.parse(decodeURIComponent(encodedClaims));

    if (!isFitnessTokenClaims(parsedClaims)) {
      throw new Error("Malformed fake auth token claims.");
    }

    return parsedClaims;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Malformed fake auth token: ${error.message}`);
    }

    throw new Error("Malformed fake auth token.");
  }
}

function assertFakeAuthTokensAllowed(): void {
  if (!fakeAuthTokensAllowed()) {
    throw new Error(
      "Fake auth tokens are disabled outside NODE_ENV=test or ALLOW_FAKE_AUTH_TOKENS=1.",
    );
  }
}

function envValue(name: string): string | undefined {
  const globalWithProcess = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return globalWithProcess.process?.env?.[name];
}
