import { describe, expect, it } from "vitest";
import {
  createNeonOAuthRepository,
  type OAuthAuthorizationCodeRecord,
  type OAuthRefreshTokenRecord,
  type SqlQueryExecutor,
} from "./oauth.js";

const authorizationCodeRecord: OAuthAuthorizationCodeRecord = {
  userId: "user_alex",
  clientId: "fitness-chatgpt",
  redirectUri: "https://chatgpt.example.test/oauth/callback",
  resource: "https://fitness.example.test/mcp",
  scope: "health:read coach:read report:read",
  codeChallenge: "code-challenge-1",
  codeChallengeMethod: "S256",
  expiresAt: "2026-06-13T12:05:00.000Z",
};

const refreshTokenRecord: OAuthRefreshTokenRecord = {
  familyId: "00000000-0000-4000-8000-000000000001",
  userId: "user_alex",
  clientId: "fitness-chatgpt",
  resource: "https://fitness.example.test/mcp",
  scope: "health:read coach:read report:read",
  expiresAt: "2026-07-13T12:00:00.000Z",
};

describe("Neon OAuth repository", () => {
  it("stores authorization codes by hash without persisting raw code material", async () => {
    const sql = createFakeSql([[]]);
    const repository = createNeonOAuthRepository(sql, {
      hashSecret: (secret) => `hash:${secret}`,
    });

    await repository.createAuthorizationCode({
      code: "raw-authorization-code",
      ...authorizationCodeRecord,
    });

    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0]?.text).toContain("oauth_authorization_codes");
    expect(sql.calls[0]?.text).toContain("code_hash");
    expect(sql.calls[0]?.values).toContain("hash:raw-authorization-code");
    expect(sql.calls[0]?.values).not.toContain("raw-authorization-code");
  });

  it("consumes one matching authorization code only once", async () => {
    const sql = createFakeSql([
      [
        {
          result: "consumed",
          user_id: "user_alex",
          client_id: "fitness-chatgpt",
          redirect_uri: "https://chatgpt.example.test/oauth/callback",
          resource: "https://fitness.example.test/mcp",
          scope: "health:read coach:read report:read",
          code_challenge: "code-challenge-1",
          code_challenge_method: "S256",
          expires_at: new Date("2026-06-13T12:05:00.000Z"),
        },
      ],
    ]);
    const repository = createNeonOAuthRepository(sql, {
      hashSecret: (secret) => `hash:${secret}`,
    });

    const result = await repository.consumeAuthorizationCode({
      code: "raw-authorization-code",
      clientId: "fitness-chatgpt",
      redirectUri: "https://chatgpt.example.test/oauth/callback",
      now: "2026-06-13T12:00:00.000Z",
    });

    expect(result).toEqual({
      ok: true,
      record: authorizationCodeRecord,
    });
    expect(sql.calls[0]?.text).toContain("consumed_at is null");
    expect(sql.calls[0]?.text).toContain("expires_at >");
    expect(sql.calls[0]?.values).toContain("hash:raw-authorization-code");
    expect(sql.calls[0]?.values).not.toContain("raw-authorization-code");
  });

  it("stores and rotates refresh tokens by hash", async () => {
    const sql = createFakeSql([
      [],
      [
        {
          result: "rotated",
          family_id: "00000000-0000-4000-8000-000000000001",
          user_id: "user_alex",
          client_id: "fitness-chatgpt",
          resource: "https://fitness.example.test/mcp",
          scope: "health:read coach:read report:read",
          expires_at: new Date("2026-07-13T12:00:00.000Z"),
        },
      ],
    ]);
    const repository = createNeonOAuthRepository(sql, {
      hashSecret: (secret) => `hash:${secret}`,
    });

    await repository.createRefreshToken({
      token: "raw-refresh-token",
      ...refreshTokenRecord,
    });
    const result = await repository.rotateRefreshToken({
      token: "raw-refresh-token",
      clientId: "fitness-chatgpt",
      replacementToken: "new-refresh-token",
      now: "2026-06-13T12:00:00.000Z",
      expiresAt: "2026-07-13T12:00:00.000Z",
    });

    expect(result).toEqual({
      ok: true,
      record: refreshTokenRecord,
    });
    expect(sql.calls[0]?.text).toContain("oauth_refresh_tokens");
    expect(sql.calls[0]?.values).toContain("hash:raw-refresh-token");
    expect(sql.calls[0]?.values).not.toContain("raw-refresh-token");
    expect(sql.calls[1]?.text).toContain("rotated_at is null");
    expect(sql.calls[1]?.text).toContain("replaced_by_token_hash");
    expect(sql.calls[1]?.values).toContain("hash:raw-refresh-token");
    expect(sql.calls[1]?.values).toContain("hash:new-refresh-token");
    expect(sql.calls[1]?.values).not.toContain("raw-refresh-token");
    expect(sql.calls[1]?.values).not.toContain("new-refresh-token");
  });
});

function createFakeSql(
  rowsByCall: readonly (readonly Record<string, unknown>[])[],
): SqlQueryExecutor & {
  calls: { text: string; values: readonly unknown[] }[];
} {
  const calls: { text: string; values: readonly unknown[] }[] = [];

  const sql = (async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<readonly Record<string, unknown>[]> => {
    calls.push({
      text: templateText(strings, values.length).toLowerCase(),
      values,
    });

    return rowsByCall[calls.length - 1] ?? [];
  }) as SqlQueryExecutor & {
    calls: { text: string; values: readonly unknown[] }[];
  };

  sql.calls = calls;

  return sql;
}

function templateText(
  strings: TemplateStringsArray,
  valueCount: number,
): string {
  return strings.reduce((text, chunk, index) => {
    const placeholder = index < valueCount ? `$${index + 1}` : "";

    return `${text}${chunk}${placeholder}`;
  }, "");
}
