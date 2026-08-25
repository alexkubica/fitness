import { describe, expect, it } from "vitest";
import {
  createNeonProfileRepository,
  type SqlQueryExecutor,
} from "./profiles.js";

describe("Neon profile repository", () => {
  it("ensures a self profile and owner access for an authenticated user", async () => {
    const sql = createFakeSql([[profileRow()]]);
    const repository = createNeonProfileRepository(sql);

    const row = await repository.ensureSelfProfile({
      userId: "user_alex",
      displayName: "Alex",
      timezone: "Asia/Jerusalem",
    });

    expect(row).toMatchObject({
      profile: {
        id: "11111111-1111-4111-8111-111111111111",
        displayName: "Alex",
        linkedUserId: "user_alex",
        ownerUserId: "user_alex",
        profileType: "self",
        timezone: "Asia/Jerusalem",
      },
      access: {
        userId: "user_alex",
        relationship: "self",
        roleIdentifier: "owner",
        status: "active",
        accessVersion: 1,
        permissionOverrides: [],
      },
    });
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0]?.text).toContain("insert into users");
    expect(sql.calls[0]?.text).toContain("insert into health_profiles");
    expect(sql.calls[0]?.text).toContain("insert into profile_access");
    expect(sql.calls[0]?.text).toContain("on conflict (linked_user_id)");
    expect(sql.calls[0]?.text).toContain(
      "on conflict (user_id, profile_id) do nothing",
    );
    expect(sql.calls[0]?.values).toContain("user_alex");
  });

  it("creates managed profiles without linked login users", async () => {
    const sql = createFakeSql([
      [
        profileRow({
          access_id: "44444444-4444-4444-8444-444444444444",
          access_profile_id: "33333333-3333-4333-8333-333333333333",
          display_name: "Family member",
          linked_user_id: null,
          profile_id: "33333333-3333-4333-8333-333333333333",
          profile_type: "managed",
          relationship: "guardian",
        }),
      ],
    ]);
    const repository = createNeonProfileRepository(sql);

    const row = await repository.createManagedProfile({
      ownerUserId: "user_alex",
      displayName: "Family member",
      timezone: "Asia/Jerusalem",
      relationship: "guardian",
      roleIdentifier: "owner",
    });

    expect(row).toMatchObject({
      profile: {
        displayName: "Family member",
        linkedUserId: undefined,
        ownerUserId: "user_alex",
        profileType: "managed",
      },
      access: {
        userId: "user_alex",
        relationship: "guardian",
        roleIdentifier: "owner",
      },
    });
    expect(sql.calls[0]?.text).toContain("insert into health_profiles");
    expect(sql.calls[0]?.text).toContain("null");
    expect(sql.calls[0]?.values).toContain("Family member");
  });

  it("lists active relationship rows with profile metadata", async () => {
    const sql = createFakeSql([
      [
        profileRow(),
        profileRow({
          access_id: "66666666-6666-4666-8666-666666666666",
          access_profile_id: "55555555-5555-4555-8555-555555555555",
          display_name: "Dependent",
          linked_user_id: null,
          profile_id: "55555555-5555-4555-8555-555555555555",
          profile_type: "managed",
          relationship: "guardian",
        }),
      ],
    ]);
    const repository = createNeonProfileRepository(sql);

    const rows = await repository.listProfileAccess("user_alex");

    expect(rows.map((row) => row.profile.id)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "55555555-5555-4555-8555-555555555555",
    ]);
    expect(sql.calls[0]?.text).toContain("from profile_access access");
    expect(sql.calls[0]?.text).toContain("join health_profiles profile");
    expect(sql.calls[0]?.values).toContain("user_alex");
  });

  it("treats malformed explicit profile ids as inaccessible", async () => {
    const sql = createFakeSql([[]]);
    const repository = createNeonProfileRepository(sql);

    await expect(
      repository.getProfileAccess({
        userId: "user_alex",
        profileId: "not-a-uuid",
      }),
    ).resolves.toBeUndefined();
    expect(sql.calls[0]?.text).toContain("access.profile_id::text = $2::text");
    expect(sql.calls[0]?.text).not.toContain("$2::uuid");
  });

  it("upserts permission overrides and returns the bumped access version", async () => {
    const sql = createFakeSql([
      [{ profile_access_id: "22222222-2222-4222-8222-222222222222" }],
      [{ access_version: "4" }],
    ]);
    const repository = createNeonProfileRepository(sql);

    await expect(
      repository.setPermissionOverride({
        userId: "user_coach",
        profileId: "11111111-1111-4111-8111-111111111111",
        permissionId: "health.detailed.read",
        effect: "allow",
      }),
    ).resolves.toBe(4);
    expect(sql.calls[0]?.text).toContain(
      "insert into profile_permission_overrides",
    );
    expect(sql.calls[0]?.text).toContain(
      "on conflict (profile_access_id, permission_id) do update",
    );
    expect(sql.calls[1]?.text).toContain("select access_version");
  });

  it("removes permission overrides and returns the bumped access version", async () => {
    const sql = createFakeSql([
      [{ profile_access_id: "22222222-2222-4222-8222-222222222222" }],
      [{ access_version: 5 }],
    ]);
    const repository = createNeonProfileRepository(sql);

    await expect(
      repository.removePermissionOverride({
        userId: "user_coach",
        profileId: "11111111-1111-4111-8111-111111111111",
        permissionId: "health.detailed.read",
      }),
    ).resolves.toBe(5);
    expect(sql.calls[0]?.text).toContain(
      "delete from profile_permission_overrides",
    );
  });
});

function profileRow(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    profile_id: "11111111-1111-4111-8111-111111111111",
    display_name: "Alex",
    avatar_url: null,
    linked_user_id: "user_alex",
    owner_user_id: "user_alex",
    profile_type: "self",
    timezone: "Asia/Jerusalem",
    profile_created_at: new Date("2026-07-15T08:00:00.000Z"),
    profile_updated_at: new Date("2026-07-15T08:00:00.000Z"),
    access_id: "22222222-2222-4222-8222-222222222222",
    access_user_id: "user_alex",
    access_profile_id: "11111111-1111-4111-8111-111111111111",
    relationship: "self",
    role_identifier: "owner",
    status: "active",
    expires_at: null,
    access_created_at: new Date("2026-07-15T08:00:00.000Z"),
    access_updated_at: new Date("2026-07-15T08:00:00.000Z"),
    access_version: "1",
    permission_overrides: [],
    ...overrides,
  };
}

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
