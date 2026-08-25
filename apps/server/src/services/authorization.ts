import {
  calculateEffectiveProfilePermissions,
  isProfilePermission,
  type ProfilePermission,
} from "@fitness/auth";
import type { ProfileWithAccess } from "@fitness/db";

export const AUTHORIZATION_ERROR_CODES = [
  "PERMISSION_DENIED",
  "PROFILE_NOT_ACCESSIBLE",
  "ACCESS_EXPIRED",
  "ACCESS_REVOKED",
] as const;

export type AuthorizationErrorCode = (typeof AUTHORIZATION_ERROR_CODES)[number];

export class AuthorizationError extends Error {
  constructor(
    public readonly code: AuthorizationErrorCode,
    options: {
      requiredPermission?: ProfilePermission | undefined;
      requestedAction?: string | undefined;
      requestId?: string | undefined;
    } = {},
  ) {
    super(messageForCode(code));
    this.name = "AuthorizationError";
    this.requiredPermission = options.requiredPermission;
    this.requestedAction = options.requestedAction;
    this.requestId = options.requestId;
  }

  readonly requiredPermission?: ProfilePermission | undefined;
  readonly requestedAction?: string | undefined;
  readonly requestId?: string | undefined;
}

export type AuthorizationRequestOptions = Readonly<{
  requestedAction?: string | undefined;
  requestId?: string | undefined;
}>;

export type ProfileAccessResolver = Readonly<{
  findProfileAccess(
    actorUserId: string,
    profileId: string,
  ): Promise<ProfileWithAccess | undefined>;
}>;

export type AuthorizationService = Readonly<{
  getEffectivePermissions(
    actorUserId: string,
    profileId: string,
  ): Promise<readonly ProfilePermission[]>;
  hasPermission(
    actorUserId: string,
    profileId: string,
    permission: ProfilePermission,
  ): Promise<boolean>;
  requirePermission(
    actorUserId: string,
    profileId: string,
    permission: ProfilePermission,
    options?: AuthorizationRequestOptions,
  ): Promise<void>;
  requireAnyPermission(
    actorUserId: string,
    profileId: string,
    permissions: readonly ProfilePermission[],
    options?: AuthorizationRequestOptions,
  ): Promise<void>;
  requireAllPermissions(
    actorUserId: string,
    profileId: string,
    permissions: readonly ProfilePermission[],
    options?: AuthorizationRequestOptions,
  ): Promise<void>;
  canDelegatePermission(
    actorUserId: string,
    profileId: string,
    permission: ProfilePermission,
  ): Promise<boolean>;
  invalidate(actorUserId: string, profileId: string): void;
}>;

type CacheEntry = Readonly<{
  expiresAt: number;
  permissions: readonly ProfilePermission[];
}>;

export function createAuthorizationService(
  resolver: ProfileAccessResolver,
  options: {
    cacheTtlMs?: number | undefined;
    now?: () => Date;
  } = {},
): AuthorizationService {
  const cache = new Map<string, CacheEntry>();
  const cacheTtlMs = options.cacheTtlMs ?? 5_000;
  const now = options.now ?? (() => new Date());

  async function resolve(
    actorUserId: string,
    profileId: string,
  ): Promise<readonly ProfilePermission[]> {
    const row = await resolver.findProfileAccess(actorUserId, profileId);

    assertUsableAccess(row, now());

    const key = cacheKey(actorUserId, profileId, row.access.accessVersion ?? 1);
    const currentTime = now().getTime();
    const cached = cache.get(key);

    if (cached !== undefined && cached.expiresAt > currentTime) {
      return cached.permissions;
    }

    const permissions = calculateEffectiveProfilePermissions({
      roleIdentifier: row.access.roleIdentifier,
      isOwner: row.profile.ownerUserId === actorUserId,
      overrides: (row.access.permissionOverrides ?? []).flatMap((override) =>
        isProfilePermission(override.permissionId)
          ? [{ permission: override.permissionId, effect: override.effect }]
          : [],
      ),
    });

    cache.set(key, {
      expiresAt: currentTime + cacheTtlMs,
      permissions,
    });

    return permissions;
  }

  const service: AuthorizationService = {
    getEffectivePermissions: resolve,
    async hasPermission(actorUserId, profileId, permission) {
      try {
        return (await resolve(actorUserId, profileId)).includes(permission);
      } catch (error) {
        if (error instanceof AuthorizationError) return false;
        throw error;
      }
    },
    async requirePermission(
      actorUserId,
      profileId,
      permission,
      requestOptions = {},
    ) {
      if (!(await resolve(actorUserId, profileId)).includes(permission)) {
        throw denied(permission, requestOptions);
      }
    },
    async requireAnyPermission(
      actorUserId,
      profileId,
      permissions,
      requestOptions = {},
    ) {
      const effective = await resolve(actorUserId, profileId);

      if (!permissions.some((permission) => effective.includes(permission))) {
        throw denied(permissions[0], requestOptions);
      }
    },
    async requireAllPermissions(
      actorUserId,
      profileId,
      permissions,
      requestOptions = {},
    ) {
      const effective = await resolve(actorUserId, profileId);
      const missing = permissions.find(
        (permission) => !effective.includes(permission),
      );

      if (missing !== undefined) throw denied(missing, requestOptions);
    },
    async canDelegatePermission(actorUserId, profileId, permission) {
      const effective = await resolve(actorUserId, profileId);

      return (
        effective.includes("profile_members.manage") &&
        effective.includes(permission)
      );
    },
    invalidate(actorUserId, profileId) {
      const prefix = `${actorUserId}\u0000${profileId}\u0000`;

      for (const key of cache.keys()) {
        if (key.startsWith(prefix)) cache.delete(key);
      }
    },
  };

  return service;
}

function assertUsableAccess(
  row: ProfileWithAccess | undefined,
  now: Date,
): asserts row is ProfileWithAccess {
  if (row === undefined || row.access.status === "pending") {
    throw new AuthorizationError("PROFILE_NOT_ACCESSIBLE");
  }

  if (row.access.status === "revoked") {
    throw new AuthorizationError("ACCESS_REVOKED");
  }

  if (
    row.access.status === "expired" ||
    (row.access.expiresAt !== undefined &&
      Date.parse(row.access.expiresAt) <= now.getTime())
  ) {
    throw new AuthorizationError("ACCESS_EXPIRED");
  }

  if (row.access.status !== "active") {
    throw new AuthorizationError("PROFILE_NOT_ACCESSIBLE");
  }
}

function denied(
  permission: ProfilePermission | undefined,
  options: AuthorizationRequestOptions,
): AuthorizationError {
  return new AuthorizationError("PERMISSION_DENIED", {
    requiredPermission: permission,
    requestedAction: options.requestedAction,
    requestId: options.requestId,
  });
}

function cacheKey(
  actorUserId: string,
  profileId: string,
  accessVersion: number,
): string {
  return `${actorUserId}\u0000${profileId}\u0000${accessVersion}`;
}

function messageForCode(code: AuthorizationErrorCode): string {
  switch (code) {
    case "PERMISSION_DENIED":
      return "Permission denied for this profile action.";
    case "ACCESS_EXPIRED":
      return "Profile access has expired.";
    case "ACCESS_REVOKED":
      return "Profile access has been revoked.";
    case "PROFILE_NOT_ACCESSIBLE":
      return "Profile is not accessible.";
  }
}
