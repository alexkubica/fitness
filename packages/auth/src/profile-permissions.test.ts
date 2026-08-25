import { describe, expect, it } from "vitest";
import {
  PROFILE_PERMISSIONS,
  PROFILE_ROLE_IDENTIFIERS,
  calculateEffectiveProfilePermissions,
  isProfilePermission,
  resolveProfileRolePreset,
  type ProfilePermission,
} from "./profile-permissions.js";

function effective(
  roleIdentifier: string,
  overrides: Parameters<
    typeof calculateEffectiveProfilePermissions
  >[0]["overrides"] = [],
): readonly ProfilePermission[] {
  return calculateEffectiveProfilePermissions({ roleIdentifier, overrides });
}

describe("profile permission catalogue", () => {
  it("uses stable unique permission identifiers", () => {
    expect(new Set(PROFILE_PERMISSIONS).size).toBe(PROFILE_PERMISSIONS.length);
    expect(PROFILE_PERMISSIONS).toContain("health.sensitive.read");
    expect(PROFILE_PERMISSIONS).toContain("profile_members.manage");
    expect(PROFILE_PERMISSIONS).toContain("data.delete");
    expect(PROFILE_PERMISSIONS.every(isProfilePermission)).toBe(true);
    expect(isProfilePermission("role.coach")).toBe(false);
  });

  it("gives owners full access through the versioned owner preset", () => {
    expect(effective(PROFILE_ROLE_IDENTIFIERS.owner)).toEqual(
      PROFILE_PERMISSIONS,
    );
    expect(resolveProfileRolePreset("owner")).toMatchObject({
      id: "owner.v1",
      version: 1,
    });
  });

  it("gives coaches safe defaults without detailed health or target activation", () => {
    const permissions = effective(PROFILE_ROLE_IDENTIFIERS.coach);

    expect(permissions).toEqual(
      expect.arrayContaining([
        "health.summary.read",
        "meal.read",
        "meal.plan.write",
        "target.propose",
        "checkin.comment",
        "report.create",
        "coach_task.write",
      ]),
    );
    expect(permissions).not.toContain("health.detailed.read");
    expect(permissions).not.toContain("target.write");
  });

  it("gives trainers workout access without detailed nutrition", () => {
    const permissions = effective(PROFILE_ROLE_IDENTIFIERS.trainer);

    expect(permissions).toEqual(
      expect.arrayContaining([
        "health.summary.read",
        "workout.read",
        "workout.plan.write",
        "workout.comment",
      ]),
    );
    expect(permissions).not.toContain("meal.read");
    expect(permissions).not.toContain("target.read");
  });

  it("keeps family viewer defaults limited to profile discovery", () => {
    expect(effective(PROFILE_ROLE_IDENTIFIERS.familyViewer)).toEqual([
      "profile.read",
    ]);
  });

  it("allows family editors to edit meals but not targets", () => {
    const permissions = effective(PROFILE_ROLE_IDENTIFIERS.familyEditor);

    expect(permissions).toEqual(
      expect.arrayContaining(["meal.read", "meal.write", "meal.plan.write"]),
    );
    expect(permissions).not.toContain("target.write");
    expect(permissions).not.toContain("health.detailed.read");
  });

  it("gives managed dependent administrators broad but not sensitive access", () => {
    const permissions = effective(
      PROFILE_ROLE_IDENTIFIERS.managedDependentAdministrator,
    );

    expect(permissions).toEqual(
      expect.arrayContaining([
        "profile.update",
        "health.detailed.read",
        "meal.write",
        "target.write",
        "profile_members.manage",
      ]),
    );
    expect(permissions).not.toContain("health.sensitive.read");
    expect(permissions).not.toContain("data.delete");
  });

  it("applies explicit allows for permissions omitted by a role", () => {
    expect(
      effective(PROFILE_ROLE_IDENTIFIERS.coach, [
        { permission: "health.detailed.read", effect: "allow" },
      ]),
    ).toContain("health.detailed.read");
  });

  it("applies explicit denies and lets deny override allow", () => {
    const permissions = effective(PROFILE_ROLE_IDENTIFIERS.coach, [
      { permission: "meal.read", effect: "allow" },
      { permission: "meal.read", effect: "deny" },
      { permission: "report.create", effect: "deny" },
    ]);

    expect(permissions).not.toContain("meal.read");
    expect(permissions).not.toContain("report.create");
  });

  it("uses ownership as an input to the same evaluator", () => {
    expect(
      calculateEffectiveProfilePermissions({
        roleIdentifier: PROFILE_ROLE_IDENTIFIERS.familyViewer,
        isOwner: true,
      }),
    ).toEqual(PROFILE_PERMISSIONS);
  });

  it("fails closed for unknown future role identifiers", () => {
    expect(effective("unknown-role.v99")).toEqual([]);
  });
});
