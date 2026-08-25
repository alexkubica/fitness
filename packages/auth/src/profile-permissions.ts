export const PROFILE_PERMISSIONS = [
  "profile.read",
  "profile.update",
  "health.summary.read",
  "health.detailed.read",
  "health.sensitive.read",
  "health.write",
  "meal.read",
  "meal.write",
  "meal.delete",
  "meal.plan.read",
  "meal.plan.write",
  "meal.plan.delete",
  "target.read",
  "target.propose",
  "target.write",
  "target.archive",
  "checkin.read",
  "checkin.write",
  "checkin.comment",
  "coach_note.read",
  "coach_note.write",
  "coach_task.read",
  "coach_task.write",
  "report.read",
  "report.create",
  "report.share",
  "workout.read",
  "workout.write",
  "workout.plan.write",
  "workout.comment",
  "reminder.read",
  "reminder.write",
  "profile_members.read",
  "profile_members.manage",
  "audit.read",
  "data.export",
  "data.delete",
] as const;

export type ProfilePermission = (typeof PROFILE_PERMISSIONS)[number];

export type PermissionOverrideEffect = "allow" | "deny";

export type ProfilePermissionOverride = Readonly<{
  permission: ProfilePermission;
  effect: PermissionOverrideEffect;
}>;

export const PROFILE_ROLE_IDENTIFIERS = {
  owner: "owner.v1",
  coach: "coach.v1",
  trainer: "trainer.v1",
  familyViewer: "family_viewer.v1",
  familyEditor: "family_editor.v1",
  managedDependentAdministrator: "managed_dependent_administrator.v1",
} as const;

export type ProfileRoleIdentifier =
  (typeof PROFILE_ROLE_IDENTIFIERS)[keyof typeof PROFILE_ROLE_IDENTIFIERS];

export type ProfileRolePreset = Readonly<{
  id: ProfileRoleIdentifier;
  version: 1;
  permissions: readonly ProfilePermission[];
}>;

const coachPermissions = permissions(
  "profile.read",
  "health.summary.read",
  "meal.read",
  "meal.plan.read",
  "meal.plan.write",
  "target.read",
  "target.propose",
  "checkin.read",
  "checkin.comment",
  "coach_note.read",
  "coach_note.write",
  "coach_task.read",
  "coach_task.write",
  "report.read",
  "report.create",
);

const trainerPermissions = permissions(
  "profile.read",
  "health.summary.read",
  "workout.read",
  "workout.plan.write",
  "workout.comment",
);

const familyViewerPermissions = permissions("profile.read");

const familyEditorPermissions = permissions(
  "profile.read",
  "meal.read",
  "meal.write",
  "meal.plan.read",
  "meal.plan.write",
);

const managedAdministratorExcluded = new Set<ProfilePermission>([
  "health.sensitive.read",
  "audit.read",
  "data.export",
  "data.delete",
  "report.share",
]);

const managedAdministratorPermissions = PROFILE_PERMISSIONS.filter(
  (permission) => !managedAdministratorExcluded.has(permission),
);

export const PROFILE_ROLE_PRESETS: Readonly<
  Record<ProfileRoleIdentifier, ProfileRolePreset>
> = {
  [PROFILE_ROLE_IDENTIFIERS.owner]: {
    id: PROFILE_ROLE_IDENTIFIERS.owner,
    version: 1,
    permissions: PROFILE_PERMISSIONS,
  },
  [PROFILE_ROLE_IDENTIFIERS.coach]: {
    id: PROFILE_ROLE_IDENTIFIERS.coach,
    version: 1,
    permissions: coachPermissions,
  },
  [PROFILE_ROLE_IDENTIFIERS.trainer]: {
    id: PROFILE_ROLE_IDENTIFIERS.trainer,
    version: 1,
    permissions: trainerPermissions,
  },
  [PROFILE_ROLE_IDENTIFIERS.familyViewer]: {
    id: PROFILE_ROLE_IDENTIFIERS.familyViewer,
    version: 1,
    permissions: familyViewerPermissions,
  },
  [PROFILE_ROLE_IDENTIFIERS.familyEditor]: {
    id: PROFILE_ROLE_IDENTIFIERS.familyEditor,
    version: 1,
    permissions: familyEditorPermissions,
  },
  [PROFILE_ROLE_IDENTIFIERS.managedDependentAdministrator]: {
    id: PROFILE_ROLE_IDENTIFIERS.managedDependentAdministrator,
    version: 1,
    permissions: managedAdministratorPermissions,
  },
};

const legacyRoleAliases: Readonly<Record<string, ProfileRoleIdentifier>> = {
  owner: PROFILE_ROLE_IDENTIFIERS.owner,
  coach: PROFILE_ROLE_IDENTIFIERS.coach,
  trainer: PROFILE_ROLE_IDENTIFIERS.trainer,
  family_viewer: PROFILE_ROLE_IDENTIFIERS.familyViewer,
  family_editor: PROFILE_ROLE_IDENTIFIERS.familyEditor,
  managed_dependent_administrator:
    PROFILE_ROLE_IDENTIFIERS.managedDependentAdministrator,
};

const permissionSet = new Set<string>(PROFILE_PERMISSIONS);

export function isProfilePermission(
  value: unknown,
): value is ProfilePermission {
  return typeof value === "string" && permissionSet.has(value);
}

export function resolveProfileRolePreset(
  roleIdentifier: string,
): ProfileRolePreset | undefined {
  const canonical =
    roleIdentifier in PROFILE_ROLE_PRESETS
      ? (roleIdentifier as ProfileRoleIdentifier)
      : legacyRoleAliases[roleIdentifier];

  return canonical === undefined ? undefined : PROFILE_ROLE_PRESETS[canonical];
}

export function calculateEffectiveProfilePermissions(input: {
  roleIdentifier: string;
  overrides?: readonly ProfilePermissionOverride[] | undefined;
  isOwner?: boolean | undefined;
}): readonly ProfilePermission[] {
  const preset = resolveProfileRolePreset(
    input.isOwner === true
      ? PROFILE_ROLE_IDENTIFIERS.owner
      : input.roleIdentifier,
  );
  const effective = new Set<ProfilePermission>(preset?.permissions ?? []);
  const denied = new Set<ProfilePermission>();

  for (const override of input.overrides ?? []) {
    if (override.effect === "deny") {
      denied.add(override.permission);
      effective.delete(override.permission);
    }
  }

  for (const override of input.overrides ?? []) {
    if (override.effect === "allow" && !denied.has(override.permission)) {
      effective.add(override.permission);
    }
  }

  return PROFILE_PERMISSIONS.filter((permission) => effective.has(permission));
}

function permissions(
  ...values: readonly ProfilePermission[]
): readonly ProfilePermission[] {
  return values;
}
