import type { SqlQueryExecutor } from "./health-samples.js";

export type { SqlQueryExecutor } from "./health-samples.js";

export type HealthProfileType = "self" | "managed";

export type ProfileAccessStatus =
  | "active"
  | "expired"
  | "inactive"
  | "pending"
  | "revoked";

export type ProfilePermissionOverrideEffect = "allow" | "deny";

export type ProfilePermissionOverride = Readonly<{
  permissionId: string;
  effect: ProfilePermissionOverrideEffect;
}>;

export type HealthProfile = Readonly<{
  id: string;
  displayName: string;
  avatarUrl?: string | undefined;
  linkedUserId?: string | undefined;
  ownerUserId: string;
  profileType: HealthProfileType;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}>;

export type ProfileAccess = Readonly<{
  id: string;
  userId: string;
  profileId: string;
  relationship: string;
  roleIdentifier: string;
  status: ProfileAccessStatus;
  expiresAt?: string | undefined;
  accessVersion?: number | undefined;
  permissionOverrides?: readonly ProfilePermissionOverride[] | undefined;
  createdAt: string;
  updatedAt: string;
}>;

export type ProfileWithAccess = Readonly<{
  profile: HealthProfile;
  access: ProfileAccess;
}>;

export type EnsureSelfProfileInput = Readonly<{
  userId: string;
  displayName?: string | undefined;
  avatarUrl?: string | undefined;
  timezone?: string | undefined;
}>;

export type CreateManagedProfileInput = Readonly<{
  ownerUserId: string;
  displayName: string;
  avatarUrl?: string | undefined;
  timezone: string;
  relationship?: string | undefined;
  roleIdentifier?: string | undefined;
}>;

export type ProfileAccessLookup = Readonly<{
  userId: string;
  profileId: string;
}>;

export type ProfilePermissionOverrideMutation = ProfileAccessLookup &
  Readonly<{
    permissionId: string;
    effect: ProfilePermissionOverrideEffect;
  }>;

export type ProfilePermissionOverrideRemoval = ProfileAccessLookup &
  Readonly<{
    permissionId: string;
  }>;

export type NeonProfileRepository = Readonly<{
  ensureSelfProfile(input: EnsureSelfProfileInput): Promise<ProfileWithAccess>;
  createManagedProfile(
    input: CreateManagedProfileInput,
  ): Promise<ProfileWithAccess>;
  getProfileAccess(
    input: ProfileAccessLookup,
  ): Promise<ProfileWithAccess | undefined>;
  listProfileAccess(userId: string): Promise<readonly ProfileWithAccess[]>;
  setPermissionOverride(
    input: ProfilePermissionOverrideMutation,
  ): Promise<number | undefined>;
  removePermissionOverride(
    input: ProfilePermissionOverrideRemoval,
  ): Promise<number | undefined>;
}>;

export function createNeonProfileRepository(
  sql: SqlQueryExecutor,
): NeonProfileRepository {
  return {
    async ensureSelfProfile(input) {
      const rows = await sql`
        with ensure_user as (
          insert into users (id, name, timezone)
          values (
            ${input.userId}::text,
            ${input.displayName ?? null}::text,
            ${input.timezone ?? null}::text
          )
          on conflict (id) do update set
            name = coalesce(users.name, excluded.name),
            timezone = coalesce(users.timezone, excluded.timezone)
          returning id, email, name, timezone, created_at
        ),
        upserted_profile as (
          insert into health_profiles (
            display_name,
            avatar_url,
            linked_user_id,
            owner_user_id,
            profile_type,
            timezone,
            created_at
          )
          select
            coalesce(
              ${input.displayName ?? null}::text,
              nullif(selected_user.name, ''),
              nullif(selected_user.email, ''),
              selected_user.id
            ),
            ${input.avatarUrl ?? null}::text,
            selected_user.id,
            selected_user.id,
            'self',
            coalesce(
              ${input.timezone ?? null}::text,
              nullif(selected_user.timezone, ''),
              'UTC'
            ),
            selected_user.created_at
          from ensure_user selected_user
          on conflict (linked_user_id) where linked_user_id is not null
          do update set
            owner_user_id = excluded.owner_user_id,
            profile_type = 'self',
            avatar_url = coalesce(excluded.avatar_url, health_profiles.avatar_url),
            timezone = coalesce(nullif(health_profiles.timezone, ''), excluded.timezone)
          returning *
        ),
        inserted_access as (
          insert into profile_access (
            user_id,
            profile_id,
            relationship,
            role_identifier,
            status,
            created_at
          )
          select
            upserted_profile.linked_user_id,
            upserted_profile.id,
            'self',
            'owner',
            'active',
            upserted_profile.created_at
          from upserted_profile
          where upserted_profile.linked_user_id is not null
          on conflict (user_id, profile_id) do nothing
          returning *
        )
        select
          profile.id::text as profile_id,
          profile.display_name,
          profile.avatar_url,
          profile.linked_user_id,
          profile.owner_user_id,
          profile.profile_type,
          profile.timezone,
          profile.created_at as profile_created_at,
          profile.updated_at as profile_updated_at,
          access.id::text as access_id,
          access.user_id as access_user_id,
          access.profile_id::text as access_profile_id,
          access.relationship,
          access.role_identifier,
          access.status,
          access.expires_at,
          access.access_version,
          coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'permissionId', permission_override.permission_id,
                'effect', permission_override.effect
              ) order by permission_override.permission_id
            )
            from profile_permission_overrides permission_override
            where permission_override.profile_access_id = access.id
          ), '[]'::jsonb) as permission_overrides,
          access.created_at as access_created_at,
          access.updated_at as access_updated_at
        from upserted_profile profile
        join profile_access access
          on access.user_id = profile.linked_user_id
         and access.profile_id = profile.id
        limit 1
      `;

      return rowToProfileWithAccess(rows[0]);
    },
    async createManagedProfile(input) {
      const rows = await sql`
        with ensure_user as (
          insert into users (id)
          values (${input.ownerUserId}::text)
          on conflict (id) do update set id = excluded.id
          returning id
        ),
        inserted_profile as (
          insert into health_profiles (
            display_name,
            avatar_url,
            linked_user_id,
            owner_user_id,
            profile_type,
            timezone
          )
          select
            ${input.displayName}::text,
            ${input.avatarUrl ?? null}::text,
            null,
            ensure_user.id,
            'managed',
            ${input.timezone}::text
          from ensure_user
          returning *
        ),
        inserted_access as (
          insert into profile_access (
            user_id,
            profile_id,
            relationship,
            role_identifier,
            status
          )
          select
            ${input.ownerUserId}::text,
            inserted_profile.id,
            ${input.relationship ?? "owner"}::text,
            ${input.roleIdentifier ?? "owner"}::text,
            'active'
          from inserted_profile
          returning *
        )
        select
          profile.id::text as profile_id,
          profile.display_name,
          profile.avatar_url,
          profile.linked_user_id,
          profile.owner_user_id,
          profile.profile_type,
          profile.timezone,
          profile.created_at as profile_created_at,
          profile.updated_at as profile_updated_at,
          access.id::text as access_id,
          access.user_id as access_user_id,
          access.profile_id::text as access_profile_id,
          access.relationship,
          access.role_identifier,
          access.status,
          access.expires_at,
          access.access_version,
          coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'permissionId', permission_override.permission_id,
                'effect', permission_override.effect
              ) order by permission_override.permission_id
            )
            from profile_permission_overrides permission_override
            where permission_override.profile_access_id = access.id
          ), '[]'::jsonb) as permission_overrides,
          access.created_at as access_created_at,
          access.updated_at as access_updated_at
        from inserted_profile profile
        join inserted_access access
          on access.profile_id = profile.id
        limit 1
      `;

      return rowToProfileWithAccess(rows[0]);
    },
    async getProfileAccess(input) {
      const rows = await sql`
        select
          profile.id::text as profile_id,
          profile.display_name,
          profile.avatar_url,
          profile.linked_user_id,
          profile.owner_user_id,
          profile.profile_type,
          profile.timezone,
          profile.created_at as profile_created_at,
          profile.updated_at as profile_updated_at,
          access.id::text as access_id,
          access.user_id as access_user_id,
          access.profile_id::text as access_profile_id,
          access.relationship,
          access.role_identifier,
          access.status,
          access.expires_at,
          access.access_version,
          coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'permissionId', permission_override.permission_id,
                'effect', permission_override.effect
              ) order by permission_override.permission_id
            )
            from profile_permission_overrides permission_override
            where permission_override.profile_access_id = access.id
          ), '[]'::jsonb) as permission_overrides,
          access.created_at as access_created_at,
          access.updated_at as access_updated_at
        from profile_access access
        join health_profiles profile
          on profile.id = access.profile_id
        where access.user_id = ${input.userId}::text
          and access.profile_id::text = ${input.profileId}::text
        limit 1
      `;

      return rows[0] === undefined
        ? undefined
        : rowToProfileWithAccess(rows[0]);
    },
    async listProfileAccess(userId) {
      const rows = await sql`
        select
          profile.id::text as profile_id,
          profile.display_name,
          profile.avatar_url,
          profile.linked_user_id,
          profile.owner_user_id,
          profile.profile_type,
          profile.timezone,
          profile.created_at as profile_created_at,
          profile.updated_at as profile_updated_at,
          access.id::text as access_id,
          access.user_id as access_user_id,
          access.profile_id::text as access_profile_id,
          access.relationship,
          access.role_identifier,
          access.status,
          access.expires_at,
          access.access_version,
          coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'permissionId', permission_override.permission_id,
                'effect', permission_override.effect
              ) order by permission_override.permission_id
            )
            from profile_permission_overrides permission_override
            where permission_override.profile_access_id = access.id
          ), '[]'::jsonb) as permission_overrides,
          access.created_at as access_created_at,
          access.updated_at as access_updated_at
        from profile_access access
        join health_profiles profile
          on profile.id = access.profile_id
        where access.user_id = ${userId}::text
        order by
          case when profile.linked_user_id = ${userId}::text then 0 else 1 end,
          profile.created_at asc,
          profile.id asc
      `;

      return rows.map(rowToProfileWithAccess);
    },
    async setPermissionOverride(input) {
      const rows = await sql`
        with selected_access as (
          select id
          from profile_access
          where user_id = ${input.userId}::text
            and profile_id::text = ${input.profileId}::text
        ),
        changed_override as (
          insert into profile_permission_overrides (
            profile_access_id,
            permission_id,
            effect
          )
          select
            selected_access.id,
            ${input.permissionId}::text,
            ${input.effect}::text
          from selected_access
          on conflict (profile_access_id, permission_id) do update set
            effect = excluded.effect
          returning profile_access_id
        )
        select profile_access_id::text
        from changed_override
      `;

      return readChangedAccessVersion(sql, rows[0]);
    },
    async removePermissionOverride(input) {
      const rows = await sql`
        with deleted_override as (
          delete from profile_permission_overrides permission_override
          using profile_access access
          where permission_override.profile_access_id = access.id
            and access.user_id = ${input.userId}::text
            and access.profile_id::text = ${input.profileId}::text
            and permission_override.permission_id = ${input.permissionId}::text
          returning permission_override.profile_access_id
        )
        select profile_access_id::text
        from deleted_override
      `;

      return readChangedAccessVersion(sql, rows[0]);
    },
  };
}

async function readChangedAccessVersion(
  sql: SqlQueryExecutor,
  row: Record<string, unknown> | undefined,
): Promise<number | undefined> {
  if (row === undefined) return undefined;

  const profileAccessId = stringColumn(row, "profile_access_id");
  const versionRows = await sql`
    select access_version
    from profile_access
    where id::text = ${profileAccessId}::text
  `;

  return versionRows[0] === undefined
    ? undefined
    : positiveIntegerColumn(versionRows[0], "access_version");
}

function rowToProfileWithAccess(
  row: Record<string, unknown> | undefined,
): ProfileWithAccess {
  if (row === undefined) {
    throw new Error("Profile repository did not return a profile row.");
  }

  return {
    profile: {
      id: stringColumn(row, "profile_id"),
      displayName: stringColumn(row, "display_name"),
      avatarUrl: optionalStringColumn(row, "avatar_url"),
      linkedUserId: optionalStringColumn(row, "linked_user_id"),
      ownerUserId: stringColumn(row, "owner_user_id"),
      profileType: profileTypeColumn(row, "profile_type"),
      timezone: stringColumn(row, "timezone"),
      createdAt: timestampColumn(row, "profile_created_at"),
      updatedAt: timestampColumn(row, "profile_updated_at"),
    },
    access: {
      id: stringColumn(row, "access_id"),
      userId: stringColumn(row, "access_user_id"),
      profileId: stringColumn(row, "access_profile_id"),
      relationship: stringColumn(row, "relationship"),
      roleIdentifier: stringColumn(row, "role_identifier"),
      status: profileAccessStatusColumn(row, "status"),
      expiresAt: optionalTimestampColumn(row, "expires_at"),
      accessVersion: positiveIntegerColumn(row, "access_version"),
      permissionOverrides: permissionOverridesColumn(
        row,
        "permission_overrides",
      ),
      createdAt: timestampColumn(row, "access_created_at"),
      updatedAt: timestampColumn(row, "access_updated_at"),
    },
  };
}

function positiveIntegerColumn(
  row: Record<string, unknown>,
  column: string,
): number {
  const value = row[column];
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : value;

  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1
  ) {
    throw new Error(`Expected ${column} to be a positive integer.`);
  }

  return parsed;
}

function permissionOverridesColumn(
  row: Record<string, unknown>,
  column: string,
): readonly ProfilePermissionOverride[] {
  const raw = row[column];
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;

  if (!Array.isArray(value)) {
    throw new Error(`Expected ${column} to be an array.`);
  }

  return value.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`Expected ${column} entries to be objects.`);
    }

    const permissionId = Reflect.get(item, "permissionId");
    const effect = Reflect.get(item, "effect");

    if (
      typeof permissionId !== "string" ||
      (effect !== "allow" && effect !== "deny")
    ) {
      throw new Error(`Expected ${column} entries to be permission overrides.`);
    }

    return { permissionId, effect };
  });
}

function profileTypeColumn(
  row: Record<string, unknown>,
  column: string,
): HealthProfileType {
  const value = stringColumn(row, column);

  if (value === "self" || value === "managed") {
    return value;
  }

  throw new Error(`Unexpected health profile type "${value}".`);
}

function profileAccessStatusColumn(
  row: Record<string, unknown>,
  column: string,
): ProfileAccessStatus {
  const value = stringColumn(row, column);

  if (
    value === "active" ||
    value === "expired" ||
    value === "inactive" ||
    value === "pending" ||
    value === "revoked"
  ) {
    return value;
  }

  throw new Error(`Unexpected profile access status "${value}".`);
}

function stringColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];

  if (typeof value !== "string") {
    throw new Error(`Expected ${column} to be a string.`);
  }

  return value;
}

function optionalStringColumn(
  row: Record<string, unknown>,
  column: string,
): string | undefined {
  const value = row[column];

  if (value === null || value === undefined) {
    return undefined;
  }

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

function optionalTimestampColumn(
  row: Record<string, unknown>,
  column: string,
): string | undefined {
  const value = row[column];

  if (value === null || value === undefined) {
    return undefined;
  }

  return timestampColumn(row, column);
}
