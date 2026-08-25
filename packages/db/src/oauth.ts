import { createHash } from "node:crypto";
import type { SqlQueryExecutor } from "./health-samples.js";

export type { SqlQueryExecutor } from "./health-samples.js";

export type OAuthAuthorizationCodeRecord = Readonly<{
  userId: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  expiresAt: string;
}>;

export type OAuthRefreshTokenRecord = Readonly<{
  familyId: string;
  userId: string;
  clientId: string;
  resource: string;
  scope: string;
  expiresAt: string;
}>;

export type OAuthAuthorizationCodeCreateInput = OAuthAuthorizationCodeRecord &
  Readonly<{
    code: string;
  }>;

export type OAuthAuthorizationCodeConsumeInput = Readonly<{
  code: string;
  clientId: string;
  redirectUri: string;
  now: string;
}>;

export type OAuthAuthorizationCodeConsumeResult =
  | Readonly<{ ok: true; record: OAuthAuthorizationCodeRecord }>
  | Readonly<{
      ok: false;
      error: "expired" | "not-found" | "used";
    }>;

export type OAuthRefreshTokenCreateInput = OAuthRefreshTokenRecord &
  Readonly<{
    token: string;
  }>;

export type OAuthRefreshTokenRotateInput = Readonly<{
  token: string;
  clientId: string;
  replacementToken: string;
  now: string;
  expiresAt: string;
}>;

export type OAuthRefreshTokenRotateResult =
  | Readonly<{ ok: true; record: OAuthRefreshTokenRecord }>
  | Readonly<{
      ok: false;
      error: "expired" | "not-found" | "revoked" | "used";
    }>;

export type NeonOAuthRepository = Readonly<{
  createAuthorizationCode(
    input: OAuthAuthorizationCodeCreateInput,
  ): Promise<void>;
  consumeAuthorizationCode(
    input: OAuthAuthorizationCodeConsumeInput,
  ): Promise<OAuthAuthorizationCodeConsumeResult>;
  createRefreshToken(input: OAuthRefreshTokenCreateInput): Promise<void>;
  rotateRefreshToken(
    input: OAuthRefreshTokenRotateInput,
  ): Promise<OAuthRefreshTokenRotateResult>;
}>;

export type NeonOAuthRepositoryOptions = Readonly<{
  hashSecret?: (secret: string) => string;
}>;

export function createNeonOAuthRepository(
  sql: SqlQueryExecutor,
  options: NeonOAuthRepositoryOptions = {},
): NeonOAuthRepository {
  const hashSecret = options.hashSecret ?? sha256SecretHash;

  return {
    async createAuthorizationCode(input) {
      const codeHash = hashSecret(input.code);

      await sql`
        with ensure_user as (
          insert into users (id)
          values (${input.userId})
          on conflict (id) do nothing
        )
        insert into oauth_authorization_codes (
          code_hash,
          user_id,
          client_id,
          redirect_uri,
          resource,
          scope,
          code_challenge,
          code_challenge_method,
          expires_at
        )
        values (
          ${codeHash},
          ${input.userId},
          ${input.clientId},
          ${input.redirectUri},
          ${input.resource},
          ${input.scope},
          ${input.codeChallenge},
          ${input.codeChallengeMethod},
          ${input.expiresAt}
        )
      `;
    },
    async consumeAuthorizationCode(input) {
      const codeHash = hashSecret(input.code);
      const rows = await sql`
        with target_code as (
          select *
          from oauth_authorization_codes
          where code_hash = ${codeHash}
            and client_id = ${input.clientId}
            and redirect_uri = ${input.redirectUri}
        ),
        consumed_code as (
          update oauth_authorization_codes
          set consumed_at = ${input.now}::timestamptz
          where code_hash = ${codeHash}
            and client_id = ${input.clientId}
            and redirect_uri = ${input.redirectUri}
            and consumed_at is null
            and expires_at > ${input.now}::timestamptz
          returning *
        )
        select
          case
            when exists (select 1 from consumed_code) then 'consumed'
            when not exists (select 1 from target_code) then 'not-found'
            when exists (
              select 1 from target_code where consumed_at is not null
            ) then 'used'
            else 'expired'
          end as result,
          consumed_code.user_id,
          consumed_code.client_id,
          consumed_code.redirect_uri,
          consumed_code.resource,
          consumed_code.scope,
          consumed_code.code_challenge,
          consumed_code.code_challenge_method,
          consumed_code.expires_at
        from consumed_code
        union all
        select
          case
            when not exists (select 1 from target_code) then 'not-found'
            when exists (
              select 1 from target_code where consumed_at is not null
            ) then 'used'
            else 'expired'
          end as result,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null
        where not exists (select 1 from consumed_code)
        limit 1
      `;

      return parseAuthorizationCodeConsumeResult(rows[0]);
    },
    async createRefreshToken(input) {
      const tokenHash = hashSecret(input.token);

      await sql`
        with ensure_user as (
          insert into users (id)
          values (${input.userId})
          on conflict (id) do nothing
        )
        insert into oauth_refresh_tokens (
          token_hash,
          family_id,
          user_id,
          client_id,
          resource,
          scope,
          expires_at
        )
        values (
          ${tokenHash},
          ${input.familyId},
          ${input.userId},
          ${input.clientId},
          ${input.resource},
          ${input.scope},
          ${input.expiresAt}
        )
      `;
    },
    async rotateRefreshToken(input) {
      const tokenHash = hashSecret(input.token);
      const replacementTokenHash = hashSecret(input.replacementToken);
      const rows = await sql`
        with target_token as (
          select *
          from oauth_refresh_tokens
          where token_hash = ${tokenHash}
            and client_id = ${input.clientId}
        ),
        rotated_token as (
          update oauth_refresh_tokens
          set
            rotated_at = ${input.now}::timestamptz,
            replaced_by_token_hash = ${replacementTokenHash}
          where token_hash = ${tokenHash}
            and client_id = ${input.clientId}
            and rotated_at is null
            and revoked_at is null
            and expires_at > ${input.now}::timestamptz
          returning *
        ),
        inserted_replacement as (
          insert into oauth_refresh_tokens (
            token_hash,
            family_id,
            user_id,
            client_id,
            resource,
            scope,
            expires_at
          )
          select
            ${replacementTokenHash},
            family_id,
            user_id,
            client_id,
            resource,
            scope,
            ${input.expiresAt}::timestamptz
          from rotated_token
          on conflict (token_hash) do nothing
        )
        select
          case
            when exists (select 1 from rotated_token) then 'rotated'
            when not exists (select 1 from target_token) then 'not-found'
            when exists (
              select 1 from target_token where revoked_at is not null
            ) then 'revoked'
            when exists (
              select 1 from target_token where rotated_at is not null
            ) then 'used'
            else 'expired'
          end as result,
          rotated_token.family_id,
          rotated_token.user_id,
          rotated_token.client_id,
          rotated_token.resource,
          rotated_token.scope,
          ${input.expiresAt}::timestamptz as expires_at
        from rotated_token
        union all
        select
          case
            when not exists (select 1 from target_token) then 'not-found'
            when exists (
              select 1 from target_token where revoked_at is not null
            ) then 'revoked'
            when exists (
              select 1 from target_token where rotated_at is not null
            ) then 'used'
            else 'expired'
          end as result,
          null,
          null,
          null,
          null,
          null,
          null
        where not exists (select 1 from rotated_token)
        limit 1
      `;

      return parseRefreshTokenRotateResult(rows[0]);
    },
  };
}

function parseAuthorizationCodeConsumeResult(
  row: Record<string, unknown> | undefined,
): OAuthAuthorizationCodeConsumeResult {
  if (row === undefined) {
    return { ok: false, error: "not-found" };
  }

  const result = stringColumn(row, "result");

  if (result !== "consumed") {
    return { ok: false, error: consumeError(result) };
  }

  return {
    ok: true,
    record: {
      userId: stringColumn(row, "user_id"),
      clientId: stringColumn(row, "client_id"),
      redirectUri: stringColumn(row, "redirect_uri"),
      resource: stringColumn(row, "resource"),
      scope: stringColumn(row, "scope"),
      codeChallenge: stringColumn(row, "code_challenge"),
      codeChallengeMethod: stringColumn(row, "code_challenge_method"),
      expiresAt: timestampColumn(row, "expires_at"),
    },
  };
}

function parseRefreshTokenRotateResult(
  row: Record<string, unknown> | undefined,
): OAuthRefreshTokenRotateResult {
  if (row === undefined) {
    return { ok: false, error: "not-found" };
  }

  const result = stringColumn(row, "result");

  if (result !== "rotated") {
    return { ok: false, error: refreshError(result) };
  }

  return {
    ok: true,
    record: {
      familyId: stringColumn(row, "family_id"),
      userId: stringColumn(row, "user_id"),
      clientId: stringColumn(row, "client_id"),
      resource: stringColumn(row, "resource"),
      scope: stringColumn(row, "scope"),
      expiresAt: timestampColumn(row, "expires_at"),
    },
  };
}

function consumeError(result: string): "expired" | "not-found" | "used" {
  if (result === "expired" || result === "not-found" || result === "used") {
    return result;
  }

  throw new Error(`Unexpected OAuth authorization code result: ${result}.`);
}

function refreshError(
  result: string,
): "expired" | "not-found" | "revoked" | "used" {
  if (
    result === "expired" ||
    result === "not-found" ||
    result === "revoked" ||
    result === "used"
  ) {
    return result;
  }

  throw new Error(`Unexpected OAuth refresh token result: ${result}.`);
}

function sha256SecretHash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function stringColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];

  if (typeof value !== "string") {
    throw new Error(`Expected ${column} to be a string.`);
  }

  return value;
}

function timestampColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }

  throw new Error(`Expected ${column} to be a timestamp.`);
}
