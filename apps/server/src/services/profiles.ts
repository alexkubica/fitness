import type {
  CreateManagedProfileInput,
  HealthProfile,
  NeonProfileRepository,
  ProfileAccess,
  ProfileWithAccess,
} from "@fitness/db";
import {
  calculateEffectiveProfilePermissions,
  isProfilePermission,
} from "@fitness/auth";

export type ProfilePermission = string;

export type AccessibleProfile = Readonly<{
  profileId: string;
  displayName: string;
  avatar?: string | undefined;
  relationship: string;
  roleIdentifier: string;
  ownershipStatus: "owner" | "accessible";
  isOwner: boolean;
  isManaged: boolean;
  accessStatus: ProfileAccess["status"];
  expiresAt?: string | undefined;
  permissions: readonly ProfilePermission[];
}>;

export type ProfileContext = Readonly<{
  actorUserId: string;
  profileId: string;
  subjectUserId: string;
  profile: HealthProfile;
  access: ProfileAccess;
  permissions: readonly ProfilePermission[];
}>;

export type ProfileAuthorizationAdapter = Readonly<{
  permissionsForAccess(input: {
    actorUserId: string;
    profile: HealthProfile;
    access: ProfileAccess;
  }): readonly ProfilePermission[];
}>;

export type ProfileService = Readonly<{
  getSelfProfile(actorUserId: string): Promise<ProfileContext>;
  getProfile(actorUserId: string, profileId: string): Promise<ProfileContext>;
  getProfileAccess(
    actorUserId: string,
    profileId: string,
  ): Promise<ProfileWithAccess | undefined>;
  findProfileAccess(
    actorUserId: string,
    profileId: string,
  ): Promise<ProfileWithAccess | undefined>;
  listAccessibleProfiles(
    actorUserId: string,
  ): Promise<readonly AccessibleProfile[]>;
  requireProfileContext(
    actorUserId: string,
    profileId?: string | undefined,
  ): Promise<ProfileContext>;
  createManagedProfile(
    actorUserId: string,
    input: Omit<CreateManagedProfileInput, "ownerUserId">,
  ): Promise<ProfileContext>;
}>;

export type ProfileRepositoryPort = Pick<
  NeonProfileRepository,
  | "createManagedProfile"
  | "ensureSelfProfile"
  | "getProfileAccess"
  | "listProfileAccess"
>;

export class ProfileAccessError extends Error {
  constructor(
    public readonly code:
      | "profile-access-denied"
      | "profile-access-inactive"
      | "profile-not-found",
    message: string,
  ) {
    super(message);
  }
}

const defaultAuthorizationAdapter: ProfileAuthorizationAdapter = {
  permissionsForAccess({ actorUserId, profile, access }) {
    return calculateEffectiveProfilePermissions({
      roleIdentifier: access.roleIdentifier,
      isOwner: profile.ownerUserId === actorUserId,
      overrides: (access.permissionOverrides ?? []).flatMap((override) =>
        isProfilePermission(override.permissionId)
          ? [{ permission: override.permissionId, effect: override.effect }]
          : [],
      ),
    });
  },
};

export function createInMemoryProfileService(
  options: {
    authorization?: ProfileAuthorizationAdapter | undefined;
    initialProfiles?: readonly ProfileWithAccess[] | undefined;
    now?: () => Date;
  } = {},
): ProfileService {
  const rows = new Map<string, ProfileWithAccess>();
  const now = options.now ?? (() => new Date());
  const authorization = options.authorization ?? defaultAuthorizationAdapter;

  for (const row of options.initialProfiles ?? []) {
    rows.set(accessKey(row.access.userId, row.profile.id), copyProfileRow(row));
  }

  return profileServiceFromRepository(
    {
      async ensureSelfProfile(input) {
        const existing = findSelfProfile(rows, input.userId);

        if (existing !== undefined) {
          return copyProfileRow(existing);
        }

        const timestamp = now().toISOString();
        const profile: HealthProfile = {
          id: `profile_self_${input.userId}`,
          displayName: input.displayName ?? input.userId,
          avatarUrl: input.avatarUrl,
          linkedUserId: input.userId,
          ownerUserId: input.userId,
          profileType: "self",
          timezone: input.timezone ?? "UTC",
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const access: ProfileAccess = {
          id: `access_self_${input.userId}`,
          userId: input.userId,
          profileId: profile.id,
          relationship: "self",
          roleIdentifier: "owner",
          status: "active",
          accessVersion: 1,
          permissionOverrides: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const row = { profile, access };

        rows.set(accessKey(access.userId, profile.id), copyProfileRow(row));
        return copyProfileRow(row);
      },
      async createManagedProfile(input) {
        const timestamp = now().toISOString();
        const profile: HealthProfile = {
          id: `profile_managed_${crypto.randomUUID()}`,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
          ownerUserId: input.ownerUserId,
          profileType: "managed",
          timezone: input.timezone,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const access: ProfileAccess = {
          id: `access_managed_${crypto.randomUUID()}`,
          userId: input.ownerUserId,
          profileId: profile.id,
          relationship: input.relationship ?? "owner",
          roleIdentifier: input.roleIdentifier ?? "owner",
          status: "active",
          accessVersion: 1,
          permissionOverrides: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const row = { profile, access };

        rows.set(accessKey(access.userId, profile.id), copyProfileRow(row));
        return copyProfileRow(row);
      },
      async getProfileAccess(input) {
        const row = rows.get(accessKey(input.userId, input.profileId));

        return row === undefined ? undefined : copyProfileRow(row);
      },
      async listProfileAccess(userId) {
        return Array.from(rows.values())
          .filter((row) => row.access.userId === userId)
          .sort(compareProfileRows)
          .map(copyProfileRow);
      },
    },
    { authorization, now },
  );
}

export function createRepositoryProfileService(
  repository: ProfileRepositoryPort,
  options: {
    authorization?: ProfileAuthorizationAdapter | undefined;
    now?: () => Date;
  } = {},
): ProfileService {
  return profileServiceFromRepository(repository, options);
}

function profileServiceFromRepository(
  repository: ProfileRepositoryPort,
  options: {
    authorization?: ProfileAuthorizationAdapter | undefined;
    now?: () => Date;
  } = {},
): ProfileService {
  const now = options.now ?? (() => new Date());
  const authorization = options.authorization ?? defaultAuthorizationAdapter;

  const service: ProfileService = {
    async getSelfProfile(actorUserId) {
      return profileContextForRow({
        actorUserId,
        authorization,
        row: await repository.ensureSelfProfile({ userId: actorUserId }),
      });
    },
    async getProfile(actorUserId, profileId) {
      const row = await repository.getProfileAccess({
        userId: actorUserId,
        profileId,
      });

      if (row === undefined) {
        throw new ProfileAccessError(
          "profile-not-found",
          "Profile is not accessible for this user.",
        );
      }

      assertActiveAccess(row.access, now());

      return profileContextForRow({ actorUserId, authorization, row });
    },
    async getProfileAccess(actorUserId, profileId) {
      const row = await service.findProfileAccess(actorUserId, profileId);

      if (row !== undefined) {
        assertActiveAccess(row.access, now());
      }

      return row;
    },
    findProfileAccess(actorUserId, profileId) {
      return repository.getProfileAccess({
        userId: actorUserId,
        profileId,
      });
    },
    async listAccessibleProfiles(actorUserId) {
      await repository.ensureSelfProfile({ userId: actorUserId });

      const rows = await repository.listProfileAccess(actorUserId);

      return rows
        .filter((row) => isActiveAccess(row.access, now()))
        .map((row) =>
          accessibleProfileForRow({
            actorUserId,
            authorization,
            row,
          }),
        );
    },
    requireProfileContext(actorUserId, profileId) {
      return profileId === undefined
        ? service.getSelfProfile(actorUserId)
        : service.getProfile(actorUserId, profileId);
    },
    async createManagedProfile(actorUserId, input) {
      const row = await repository.createManagedProfile({
        ...input,
        ownerUserId: actorUserId,
      });

      return profileContextForRow({ actorUserId, authorization, row });
    },
  };

  return service;
}

function profileContextForRow(input: {
  actorUserId: string;
  authorization: ProfileAuthorizationAdapter;
  row: ProfileWithAccess;
}): ProfileContext {
  return {
    actorUserId: input.actorUserId,
    profileId: input.row.profile.id,
    subjectUserId: input.row.profile.ownerUserId,
    profile: { ...input.row.profile },
    access: { ...input.row.access },
    permissions: input.authorization.permissionsForAccess({
      actorUserId: input.actorUserId,
      profile: input.row.profile,
      access: input.row.access,
    }),
  };
}

function accessibleProfileForRow(input: {
  actorUserId: string;
  authorization: ProfileAuthorizationAdapter;
  row: ProfileWithAccess;
}): AccessibleProfile {
  const isOwner = input.row.profile.ownerUserId === input.actorUserId;

  return {
    profileId: input.row.profile.id,
    displayName: input.row.profile.displayName,
    avatar: input.row.profile.avatarUrl,
    relationship: input.row.access.relationship,
    roleIdentifier: input.row.access.roleIdentifier,
    ownershipStatus: isOwner ? "owner" : "accessible",
    isOwner,
    isManaged: input.row.profile.profileType === "managed",
    accessStatus: input.row.access.status,
    expiresAt: input.row.access.expiresAt,
    permissions: input.authorization.permissionsForAccess({
      actorUserId: input.actorUserId,
      profile: input.row.profile,
      access: input.row.access,
    }),
  };
}

function assertActiveAccess(access: ProfileAccess, now: Date): void {
  if (!isActiveAccess(access, now)) {
    throw new ProfileAccessError(
      "profile-access-inactive",
      "Profile access is not active.",
    );
  }
}

function isActiveAccess(access: ProfileAccess, now: Date): boolean {
  return (
    access.status === "active" &&
    (access.expiresAt === undefined ||
      Date.parse(access.expiresAt) > now.getTime())
  );
}

function accessKey(userId: string, profileId: string): string {
  return `${userId}\u0000${profileId}`;
}

function findSelfProfile(
  rows: Map<string, ProfileWithAccess>,
  userId: string,
): ProfileWithAccess | undefined {
  return Array.from(rows.values()).find(
    (row) =>
      row.profile.linkedUserId === userId && row.access.userId === userId,
  );
}

function compareProfileRows(
  left: ProfileWithAccess,
  right: ProfileWithAccess,
): number {
  if (left.profile.linkedUserId === left.access.userId) {
    return -1;
  }

  if (right.profile.linkedUserId === right.access.userId) {
    return 1;
  }

  return (
    Date.parse(left.profile.createdAt) - Date.parse(right.profile.createdAt)
  );
}

function copyProfileRow(row: ProfileWithAccess): ProfileWithAccess {
  return {
    profile: { ...row.profile },
    access: {
      ...row.access,
      permissionOverrides: row.access.permissionOverrides?.map((override) => ({
        ...override,
      })),
    },
  };
}
