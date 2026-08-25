import { createHash } from "node:crypto";
import type {
  NeonOAuthRepository,
  OAuthAuthorizationCodeConsumeInput,
  OAuthAuthorizationCodeConsumeResult,
  OAuthAuthorizationCodeCreateInput,
  OAuthAuthorizationCodeRecord,
  OAuthRefreshTokenCreateInput,
  OAuthRefreshTokenRecord,
  OAuthRefreshTokenRotateInput,
  OAuthRefreshTokenRotateResult,
} from "@fitness/db";

export type OAuthStore = NeonOAuthRepository;

export type InMemoryOAuthStoreOptions = Readonly<{
  hashSecret?: (secret: string) => string;
}>;

type StoredAuthorizationCode = OAuthAuthorizationCodeRecord &
  Readonly<{
    consumedAt?: string | undefined;
  }>;

type StoredRefreshToken = OAuthRefreshTokenRecord &
  Readonly<{
    rotatedAt?: string | undefined;
    revokedAt?: string | undefined;
    replacedByTokenHash?: string | undefined;
  }>;

export function createInMemoryOAuthStore(
  options: InMemoryOAuthStoreOptions = {},
): OAuthStore {
  const hashSecret = options.hashSecret ?? sha256SecretHash;
  const authorizationCodes = new Map<string, StoredAuthorizationCode>();
  const refreshTokens = new Map<string, StoredRefreshToken>();

  return {
    async createAuthorizationCode(input) {
      authorizationCodes.set(hashSecret(input.code), {
        userId: input.userId,
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        resource: input.resource,
        scope: input.scope,
        codeChallenge: input.codeChallenge,
        codeChallengeMethod: input.codeChallengeMethod,
        expiresAt: input.expiresAt,
      });
    },
    async consumeAuthorizationCode(input) {
      const codeHash = hashSecret(input.code);
      const record = authorizationCodes.get(codeHash);

      if (
        record === undefined ||
        record.clientId !== input.clientId ||
        record.redirectUri !== input.redirectUri
      ) {
        return { ok: false, error: "not-found" };
      }

      if (record.consumedAt !== undefined) {
        return { ok: false, error: "used" };
      }

      if (Date.parse(record.expiresAt) <= Date.parse(input.now)) {
        return { ok: false, error: "expired" };
      }

      authorizationCodes.set(codeHash, {
        ...record,
        consumedAt: input.now,
      });

      return {
        ok: true,
        record: authorizationCodeRecord(record),
      };
    },
    async createRefreshToken(input) {
      refreshTokens.set(hashSecret(input.token), {
        familyId: input.familyId,
        userId: input.userId,
        clientId: input.clientId,
        resource: input.resource,
        scope: input.scope,
        expiresAt: input.expiresAt,
      });
    },
    async rotateRefreshToken(input) {
      const tokenHash = hashSecret(input.token);
      const replacementTokenHash = hashSecret(input.replacementToken);
      const record = refreshTokens.get(tokenHash);

      if (record === undefined || record.clientId !== input.clientId) {
        return { ok: false, error: "not-found" };
      }

      if (record.revokedAt !== undefined) {
        return { ok: false, error: "revoked" };
      }

      if (record.rotatedAt !== undefined) {
        return { ok: false, error: "used" };
      }

      if (Date.parse(record.expiresAt) <= Date.parse(input.now)) {
        return { ok: false, error: "expired" };
      }

      refreshTokens.set(tokenHash, {
        ...record,
        rotatedAt: input.now,
        replacedByTokenHash: replacementTokenHash,
      });
      const replacementRecord: OAuthRefreshTokenRecord = {
        familyId: record.familyId,
        userId: record.userId,
        clientId: record.clientId,
        resource: record.resource,
        scope: record.scope,
        expiresAt: input.expiresAt,
      };
      refreshTokens.set(replacementTokenHash, replacementRecord);

      return {
        ok: true,
        record: replacementRecord,
      };
    },
  };
}

function authorizationCodeRecord(
  record: StoredAuthorizationCode,
): OAuthAuthorizationCodeRecord {
  return {
    userId: record.userId,
    clientId: record.clientId,
    redirectUri: record.redirectUri,
    resource: record.resource,
    scope: record.scope,
    codeChallenge: record.codeChallenge,
    codeChallengeMethod: record.codeChallengeMethod,
    expiresAt: record.expiresAt,
  };
}

function sha256SecretHash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export type {
  OAuthAuthorizationCodeConsumeInput,
  OAuthAuthorizationCodeConsumeResult,
  OAuthAuthorizationCodeCreateInput,
  OAuthRefreshTokenCreateInput,
  OAuthRefreshTokenRotateInput,
  OAuthRefreshTokenRotateResult,
};
