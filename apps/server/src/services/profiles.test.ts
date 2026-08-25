import { describe, expect, it } from "vitest";
import { createInMemoryProfileService } from "./profiles.js";

describe("profile service", () => {
  it("creates and resolves a self profile for a new authenticated user", async () => {
    const profiles = createInMemoryProfileService({
      now: () => new Date("2026-07-15T08:00:00.000Z"),
    });

    const self = await profiles.getSelfProfile("user_alex");
    const listed = await profiles.listAccessibleProfiles("user_alex");

    expect(self).toMatchObject({
      actorUserId: "user_alex",
      profileId: "profile_self_user_alex",
      subjectUserId: "user_alex",
      profile: {
        linkedUserId: "user_alex",
        ownerUserId: "user_alex",
        profileType: "self",
      },
      access: {
        relationship: "self",
        roleIdentifier: "owner",
        status: "active",
      },
    });
    expect(listed).toMatchObject([
      {
        profileId: "profile_self_user_alex",
        ownershipStatus: "owner",
        isOwner: true,
        isManaged: false,
      },
    ]);
  });

  it("resolves omitted profile ids only to the actor self profile", async () => {
    const profiles = createInMemoryProfileService();
    const alexSelf = await profiles.getSelfProfile("user_alex");
    const bobSelf = await profiles.requireProfileContext("user_bob");

    expect(bobSelf.profileId).toBe("profile_self_user_bob");
    expect(bobSelf.profileId).not.toBe(alexSelf.profileId);
    await expect(
      profiles.getProfile("user_bob", alexSelf.profileId),
    ).rejects.toMatchObject({
      code: "profile-not-found",
    });
  });

  it("supports explicit managed profiles without linked login users", async () => {
    const profiles = createInMemoryProfileService({
      now: () => new Date("2026-07-15T08:00:00.000Z"),
    });

    const managed = await profiles.createManagedProfile("user_alex", {
      displayName: "Family member",
      timezone: "Asia/Jerusalem",
      relationship: "guardian",
      roleIdentifier: "owner",
    });
    const explicit = await profiles.requireProfileContext(
      "user_alex",
      managed.profileId,
    );

    expect(explicit).toMatchObject({
      actorUserId: "user_alex",
      profileId: managed.profileId,
      subjectUserId: "user_alex",
      profile: {
        displayName: "Family member",
        ownerUserId: "user_alex",
        profileType: "managed",
        timezone: "Asia/Jerusalem",
      },
      access: {
        relationship: "guardian",
        roleIdentifier: "owner",
      },
    });
    expect(explicit.profile.linkedUserId).toBeUndefined();
  });

  it("keeps explicit profile ids and adapter-provided permissions in listings", async () => {
    const profiles = createInMemoryProfileService({
      authorization: {
        permissionsForAccess({ profile }) {
          return profile.profileType === "managed"
            ? ["profile:read", "meal:write"]
            : ["profile:read"];
        },
      },
    });

    await profiles.getSelfProfile("user_alex");
    const managed = await profiles.createManagedProfile("user_alex", {
      displayName: "Dependent",
      timezone: "UTC",
    });
    const rows = await profiles.listAccessibleProfiles("user_alex");

    expect(rows.map((row) => row.profileId)).toEqual([
      "profile_self_user_alex",
      managed.profileId,
    ]);
    expect(rows[1]).toMatchObject({
      permissions: ["profile:read", "meal:write"],
      isManaged: true,
    });
  });

  it("does not list expired or revoked profile access rows", async () => {
    const profiles = createInMemoryProfileService({
      initialProfiles: [
        {
          profile: {
            id: "profile_expired",
            displayName: "Expired",
            ownerUserId: "user_alex",
            profileType: "managed",
            timezone: "UTC",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
          access: {
            id: "access_expired",
            userId: "user_alex",
            profileId: "profile_expired",
            relationship: "viewer",
            roleIdentifier: "viewer",
            status: "active",
            expiresAt: "2026-07-10T00:00:00.000Z",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
        },
        {
          profile: {
            id: "profile_revoked",
            displayName: "Revoked",
            ownerUserId: "user_alex",
            profileType: "managed",
            timezone: "UTC",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
          access: {
            id: "access_revoked",
            userId: "user_alex",
            profileId: "profile_revoked",
            relationship: "viewer",
            roleIdentifier: "viewer",
            status: "revoked",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
        },
      ],
      now: () => new Date("2026-07-15T08:00:00.000Z"),
    });

    await expect(
      profiles.getProfile("user_alex", "profile_expired"),
    ).rejects.toMatchObject({
      code: "profile-access-inactive",
    });
    await expect(
      profiles.getProfile("user_alex", "profile_revoked"),
    ).rejects.toMatchObject({
      code: "profile-access-inactive",
    });
    expect(
      (await profiles.listAccessibleProfiles("user_alex")).map(
        (row) => row.profileId,
      ),
    ).toEqual(["profile_self_user_alex"]);
  });
});
