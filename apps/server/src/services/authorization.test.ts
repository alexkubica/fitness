import type { ProfileWithAccess } from "@fitness/db";
import { describe, expect, it } from "vitest";
import {
  AuthorizationError,
  createAuthorizationService,
} from "./authorization.js";

describe("profile authorization service", () => {
  it("evaluates different role permissions for the same actor across profiles", async () => {
    const rows = new Map([
      [
        "profile_coach",
        profileRow({ profileId: "profile_coach", role: "coach" }),
      ],
      [
        "profile_trainer",
        profileRow({ profileId: "profile_trainer", role: "trainer" }),
      ],
    ]);
    const authorization = serviceFor(rows);

    await expect(
      authorization.hasPermission("user_actor", "profile_coach", "meal.read"),
    ).resolves.toBe(true);
    await expect(
      authorization.hasPermission("user_actor", "profile_trainer", "meal.read"),
    ).resolves.toBe(false);
  });

  it("applies explicit allow and deny with deny taking precedence", async () => {
    const rows = new Map([
      [
        "profile_coach",
        profileRow({
          profileId: "profile_coach",
          role: "coach",
          overrides: [
            { permissionId: "health.detailed.read", effect: "allow" },
            { permissionId: "meal.read", effect: "deny" },
          ],
        }),
      ],
    ]);
    const authorization = serviceFor(rows);

    await expect(
      authorization.hasPermission(
        "user_actor",
        "profile_coach",
        "health.detailed.read",
      ),
    ).resolves.toBe(true);
    await expect(
      authorization.hasPermission("user_actor", "profile_coach", "meal.read"),
    ).resolves.toBe(false);
  });

  it("fails closed for missing, inactive, pending, expired, and revoked access", async () => {
    const rows = new Map<string, ProfileWithAccess>([
      ["inactive", profileRow({ profileId: "inactive", status: "inactive" })],
      ["pending", profileRow({ profileId: "pending", status: "pending" })],
      [
        "expired",
        profileRow({
          profileId: "expired",
          expiresAt: "2026-07-14T00:00:00.000Z",
        }),
      ],
      ["revoked", profileRow({ profileId: "revoked", status: "revoked" })],
    ]);
    const authorization = serviceFor(rows);

    await expect(
      authorization.getEffectivePermissions("user_actor", "missing"),
    ).rejects.toMatchObject({ code: "PROFILE_NOT_ACCESSIBLE" });
    await expect(
      authorization.getEffectivePermissions("user_actor", "pending"),
    ).rejects.toMatchObject({ code: "PROFILE_NOT_ACCESSIBLE" });
    await expect(
      authorization.getEffectivePermissions("user_actor", "inactive"),
    ).rejects.toMatchObject({ code: "PROFILE_NOT_ACCESSIBLE" });
    await expect(
      authorization.getEffectivePermissions("user_actor", "expired"),
    ).rejects.toMatchObject({ code: "ACCESS_EXPIRED" });
    await expect(
      authorization.getEffectivePermissions("user_actor", "revoked"),
    ).rejects.toMatchObject({ code: "ACCESS_REVOKED" });
  });

  it("returns stable denial details without disclosing inaccessible profiles", async () => {
    const authorization = serviceFor(
      new Map([
        ["profile_viewer", profileRow({ profileId: "profile_viewer" })],
      ]),
    );

    await expect(
      authorization.requirePermission(
        "user_actor",
        "profile_viewer",
        "meal.write",
        { requestedAction: "meal.update", requestId: "request_123" },
      ),
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      requiredPermission: "meal.write",
      requestedAction: "meal.update",
      requestId: "request_123",
    });

    try {
      await authorization.requirePermission(
        "user_actor",
        "unknown",
        "profile.read",
      );
    } catch (error) {
      expect(error).toBeInstanceOf(AuthorizationError);
      expect(error).toMatchObject({
        code: "PROFILE_NOT_ACCESSIBLE",
        requiredPermission: undefined,
      });
    }
  });

  it("requires every delegated permission to be held by a membership manager", async () => {
    const rows = new Map([
      [
        "owned",
        profileRow({
          profileId: "owned",
          ownerUserId: "user_actor",
          role: "family_viewer",
        }),
      ],
      ["coach", profileRow({ profileId: "coach", role: "coach" })],
    ]);
    const authorization = serviceFor(rows);

    await expect(
      authorization.canDelegatePermission(
        "user_actor",
        "owned",
        "health.sensitive.read",
      ),
    ).resolves.toBe(true);
    await expect(
      authorization.canDelegatePermission("user_actor", "coach", "meal.read"),
    ).resolves.toBe(false);
  });

  it("supports any-of and all-of service-layer permission checks", async () => {
    const authorization = serviceFor(
      new Map([
        [
          "profile_coach",
          profileRow({ profileId: "profile_coach", role: "coach" }),
        ],
      ]),
    );

    await expect(
      authorization.requireAnyPermission("user_actor", "profile_coach", [
        "target.write",
        "target.propose",
      ]),
    ).resolves.toBeUndefined();
    await expect(
      authorization.requireAllPermissions("user_actor", "profile_coach", [
        "target.read",
        "target.propose",
      ]),
    ).resolves.toBeUndefined();
    await expect(
      authorization.requireAllPermissions("user_actor", "profile_coach", [
        "target.read",
        "target.write",
      ]),
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      requiredPermission: "target.write",
    });
  });

  it("invalidates cached permissions when access version changes or explicitly invalidated", async () => {
    const row = profileRow({ profileId: "profile_coach", role: "coach" });
    const rows = new Map([["profile_coach", row]]);
    const authorization = createAuthorizationService(
      {
        async findProfileAccess(_actorUserId, profileId) {
          return rows.get(profileId);
        },
      },
      { now: () => new Date("2026-07-15T00:00:00.000Z") },
    );

    await authorization.getEffectivePermissions("user_actor", "profile_coach");
    await authorization.getEffectivePermissions("user_actor", "profile_coach");

    rows.set(
      "profile_coach",
      profileRow({
        profileId: "profile_coach",
        role: "coach",
        accessVersion: 2,
        overrides: [{ permissionId: "meal.read", effect: "deny" }],
      }),
    );
    await expect(
      authorization.hasPermission("user_actor", "profile_coach", "meal.read"),
    ).resolves.toBe(false);

    rows.set(
      "profile_coach",
      profileRow({
        profileId: "profile_coach",
        role: "coach",
        accessVersion: 2,
      }),
    );
    await expect(
      authorization.hasPermission("user_actor", "profile_coach", "meal.read"),
    ).resolves.toBe(false);

    authorization.invalidate("user_actor", "profile_coach");
    await expect(
      authorization.hasPermission("user_actor", "profile_coach", "meal.read"),
    ).resolves.toBe(true);
  });

  it("checks current status before using a cached permission set", async () => {
    const rows = new Map([
      [
        "profile_coach",
        profileRow({ profileId: "profile_coach", role: "coach" }),
      ],
    ]);
    const authorization = serviceFor(rows);

    await authorization.getEffectivePermissions("user_actor", "profile_coach");
    rows.set(
      "profile_coach",
      profileRow({
        profileId: "profile_coach",
        role: "coach",
        status: "revoked",
      }),
    );

    await expect(
      authorization.getEffectivePermissions("user_actor", "profile_coach"),
    ).rejects.toMatchObject({ code: "ACCESS_REVOKED" });
  });
});

function serviceFor(rows: Map<string, ProfileWithAccess>) {
  return createAuthorizationService(
    {
      async findProfileAccess(_actorUserId, profileId) {
        return rows.get(profileId);
      },
    },
    { now: () => new Date("2026-07-15T00:00:00.000Z") },
  );
}

function profileRow(options: {
  profileId: string;
  ownerUserId?: string;
  role?: string;
  status?: "active" | "expired" | "inactive" | "pending" | "revoked";
  expiresAt?: string;
  accessVersion?: number;
  overrides?: readonly {
    permissionId: string;
    effect: "allow" | "deny";
  }[];
}): ProfileWithAccess {
  return {
    profile: {
      id: options.profileId,
      displayName: "Profile",
      ownerUserId: options.ownerUserId ?? "user_owner",
      profileType: "managed",
      timezone: "UTC",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
    access: {
      id: `access_${options.profileId}`,
      userId: "user_actor",
      profileId: options.profileId,
      relationship: "shared",
      roleIdentifier: options.role ?? "family_viewer",
      status: options.status ?? "active",
      expiresAt: options.expiresAt,
      accessVersion: options.accessVersion ?? 1,
      permissionOverrides: options.overrides ?? [],
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
  };
}
