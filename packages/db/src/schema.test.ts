import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createNeonClient, getDatabaseUrl } from "./client.js";

const initialSchema = readSql("../sql/001_initial_schema.sql");
const metricSeed = readSql("../sql/002_seed_health_metric_definitions.sql");
const reminderPreferencesMigration = readSql(
  "../sql/003_telegram_reminder_preferences.sql",
);
const oauthAuthorizationMigration = readSql(
  "../sql/004_oauth_authorization.sql",
);
const nutritionMetricDefinitionsMigration = readSql(
  "../sql/005_nutrition_metric_definitions.sql",
);
const coachProfilePlansMigration = readSql(
  "../sql/007_coach_profile_plans.sql",
);
const coachActivityEnergyMigration = readSql(
  "../sql/008_coach_activity_energy.sql",
);
const mealLogSnapshotsMigration = readSql("../sql/009_meal_log_snapshots.sql");
const multiProfileMigration = readSql(
  "../sql/010_multi_profile_foundation.sql",
);
const automaticSelfProfileMigration = readSql(
  "../sql/011_auto_create_self_profiles.sql",
);
const profilePermissionsMigration = readSql(
  "../sql/012_profile_permissions.sql",
);
const targetPlansMigration = readSql("../sql/014_target_plans.sql");
const dailyMealPlansMigration = readSql("../sql/013_daily_meal_plans.sql");

describe("Neon database client", () => {
  it("uses DATABASE_URL when provided and refuses implicit production URLs", () => {
    expect(
      getDatabaseUrl({
        DATABASE_URL: "postgresql://user:pass@example.neon.tech/db",
        NODE_ENV: "production",
      }),
    ).toBe("postgresql://user:pass@example.neon.tech/db");

    expect(() =>
      getDatabaseUrl({
        NODE_ENV: "production",
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it("creates a Neon tagged-template query function", () => {
    expect(
      typeof createNeonClient("postgresql://user:pass@example.test/db"),
    ).toBe("function");
  });

  it("adds Telegram reminder preferences in a forward migration", () => {
    const normalized = normalizeSql(reminderPreferencesMigration);

    expect(normalized).toContain(
      "create table if not exists telegram_reminder_preferences",
    );
    expect(normalized).toContain(
      "user_id text primary key references users (id)",
    );
    expect(normalized).toContain("enabled boolean not null default false");
    expect(normalized).toContain("slots jsonb not null");
    expect(normalized).toContain("quiet_hours jsonb");
    expect(normalized).toContain("last_sent_at_by_slot jsonb not null");
    expect(normalized).toContain(
      "create index if not exists telegram_reminder_preferences_enabled_idx",
    );
  });

  it("adds OAuth authorization code and refresh token persistence", () => {
    const normalized = normalizeSql(oauthAuthorizationMigration);

    expect(normalized).toContain(
      "create table if not exists oauth_authorization_codes",
    );
    expect(normalized).toContain("code_hash text primary key");
    expect(normalized).toContain("consumed_at timestamptz");
    expect(normalized).toContain(
      "create table if not exists oauth_refresh_tokens",
    );
    expect(normalized).toContain("token_hash text primary key");
    expect(normalized).toContain("family_id uuid not null");
    expect(normalized).toContain("rotated_at timestamptz");
    expect(normalized).toContain("revoked_at timestamptz");
    expect(normalized).toContain("replaced_by_token_hash text");
  });

  it("adds nutrition metric definitions in a forward migration", () => {
    const normalized = normalizeSql(nutritionMetricDefinitionsMigration);

    expect(normalized).toContain("dietary_energy");
    expect(normalized).toContain("protein");
    expect(normalized).toContain("carbs");
    expect(normalized).toContain("fat");
    expect(normalized).toContain("fiber");
    expect(normalized).toContain("on conflict (metric_name, unit) do update");
  });

  it("adds coach profile and daily nutrition plan persistence", () => {
    const normalized = normalizeSql(coachProfilePlansMigration);

    expect(normalized).toContain("create table if not exists coach_profiles");
    expect(normalized).toContain("user_id text primary key references users");
    expect(normalized).toContain("goal text not null");
    expect(normalized).toContain("meal_slots jsonb not null");
    expect(normalized).toContain("targets jsonb not null");
    expect(normalized).toContain(
      "create table if not exists nutrition_daily_plans",
    );
    expect(normalized).toContain("unique (user_id, plan_date)");
    expect(normalized).toContain("status text not null default 'draft'");
  });

  it("adds optional activity energy estimates to coach profiles", () => {
    const normalized = normalizeSql(coachActivityEnergyMigration);

    expect(normalized).toContain(
      "add column if not exists estimated_active_calories_per_day",
    );
    expect(normalized).toContain(
      "add column if not exists estimated_resting_calories_per_day",
    );
    expect(normalized).toContain(
      "coach_profiles_estimated_active_calories_per_day_check",
    );
    expect(normalized).toContain(
      "coach_profiles_estimated_resting_calories_per_day_check",
    );
  });

  it("adds meal log rollback snapshots", () => {
    const normalized = normalizeSql(mealLogSnapshotsMigration);

    expect(normalized).toContain(
      "create table if not exists meal_log_snapshots",
    );
    expect(normalized).toContain("before_state jsonb not null");
    expect(normalized).toContain("after_state jsonb");
    expect(normalized).toContain("expires_at timestamptz not null");
    expect(normalized).toContain(
      "create index if not exists meal_log_snapshots_user_date_idx",
    );
  });

  it("adds versioned target plans and safely imports legacy targets", () => {
    const normalized = normalizeSql(targetPlansMigration);

    expect(normalized).toContain("create table if not exists target_plans");
    expect(normalized).toContain("unique (profile_id, version)");
    expect(normalized).toContain("where status = 'active'");
    expect(normalized).toContain(
      "create table if not exists target_plan_events",
    );
    expect(normalized).toContain("target_plan_events_idempotency_idx");
    expect(normalized).toContain("'imported_legacy'");
    expect(normalized).toContain("'migration'");
    expect(normalized).toContain("coach.targets -> 'carbsgrams'");
    expect(normalized).toContain("coach.estimated_steps_per_day");
    expect(normalized).toContain("at time zone profile.timezone");
    expect(normalized).toContain(
      "not exists ( select 1 from target_plans existing",
    );
  });

  it("adds the multi-profile foundation in a forward migration", () => {
    const normalized = normalizeSql(multiProfileMigration);

    expect(normalized).toContain("create table if not exists health_profiles");
    expect(normalized).toContain("display_name text not null");
    expect(normalized).toContain("linked_user_id text references users (id)");
    expect(normalized).toContain(
      "owner_user_id text not null references users",
    );
    expect(normalized).toContain("profile_type text not null");
    expect(normalized).toContain("create table if not exists profile_access");
    expect(normalized).toContain("relationship text not null");
    expect(normalized).toContain("role_identifier text not null");
    expect(normalized).toContain("status text not null default 'active'");
    expect(normalized).toContain("expires_at timestamptz");
    expect(normalized).toContain(
      "on conflict (linked_user_id) where linked_user_id is not null do update",
    );
    expect(normalized).toContain(
      "on conflict (user_id, profile_id) do nothing",
    );
    expect(normalized).toContain("add column if not exists profile_id uuid");
    expect(normalized).toContain(
      "create unique index if not exists health_metric_samples_profile_source_sample_metric_idx",
    );
    expect(normalized).toContain(
      "create unique index if not exists meals_profile_idempotency_key_idx",
    );
    expect(normalized).toContain(
      "create unique index if not exists coach_profiles_profile_id_unique_idx",
    );
  });

  it("backfills existing account-owned data to each user self profile", () => {
    const normalized = normalizeSql(multiProfileMigration);

    for (const tableName of [
      "health_metric_samples",
      "daily_health_aggregates",
      "health_sync_cursors",
      "health_sync_batches",
      "meals",
      "check_ins",
      "coach_memories",
      "reports",
      "write_proposals",
      "saved_meal_templates",
      "coach_profiles",
      "nutrition_daily_plans",
      "meal_log_snapshots",
      "audit_events",
    ]) {
      expect(normalized).toContain(`update ${tableName} set profile_id`);
      expect(normalized).toContain(
        `health_profiles.linked_user_id = ${tableName}.user_id`,
      );
    }
  });

  it("keeps the profile migration safely retryable during rollout", () => {
    const normalized = normalizeSql(multiProfileMigration);

    expect(normalized).toContain("create table if not exists health_profiles");
    expect(normalized).toContain("create table if not exists profile_access");
    expect(normalized).toContain("add column if not exists profile_id uuid");
    expect(normalized).toContain("drop constraint if exists");
    expect(normalized).toContain("drop index if exists");
    expect(normalized).toContain("create unique index if not exists");
    expect(normalized).toContain(
      "on conflict (linked_user_id) where linked_user_id is not null do update",
    );
    expect(normalized).toContain(
      "on conflict (user_id, profile_id) do nothing",
    );
  });

  it("automatically creates self profiles for newly inserted users", () => {
    const normalized = normalizeSql(automaticSelfProfileMigration);

    expect(normalized).toContain(
      "create or replace function ensure_user_self_profile()",
    );
    expect(normalized).toContain("insert into health_profiles");
    expect(normalized).toContain("insert into profile_access");
    expect(normalized).toContain(
      "on conflict (linked_user_id) where linked_user_id is not null do update",
    );
    expect(normalized).toContain(
      "on conflict (user_id, profile_id) do nothing",
    );
    expect(normalized).toContain(
      "create trigger users_ensure_self_profile after insert on users",
    );
  });

  it("adds versioned profile permission overrides", () => {
    const normalized = normalizeSql(profilePermissionsMigration);

    expect(normalized).toContain(
      "add column if not exists access_version bigint not null default 1",
    );
    expect(normalized).toContain(
      "status in ('active', 'inactive', 'pending', 'revoked', 'expired')",
    );
    expect(normalized).toContain(
      "create table if not exists profile_permission_overrides",
    );
    expect(normalized).toContain("effect in ('allow', 'deny')");
    expect(normalized).toContain("unique (profile_access_id, permission_id)");
    expect(normalized).toContain(
      "create trigger profile_access_increment_version",
    );
    expect(normalized).toContain(
      "create trigger profile_permission_overrides_bump_access_version",
    );
  });

  it("adds normalized profile-owned daily meal plans", () => {
    const normalized = normalizeSql(dailyMealPlansMigration);

    expect(normalized).toContain("create table if not exists daily_meal_plans");
    expect(normalized).toContain(
      "profile_id uuid not null references health_profiles",
    );
    expect(normalized).toContain("local_food_date date not null");
    expect(normalized).toContain(
      "created_by_user_id text not null references users",
    );
    expect(normalized).toContain("unique (profile_id, local_food_date)");
    expect(normalized).toContain("version integer not null default 1");
    expect(normalized).toContain("create table if not exists planned_meals");
    expect(normalized).toContain("linked_meal_log_id uuid references meals");
    expect(normalized).toContain("planned_meals_linked_log_unique_idx");
    expect(normalized).toContain(
      "create table if not exists planned_meal_ingredients",
    );
    expect(normalized).toContain("food_reference_type text");
    expect(normalized).toContain("calories numeric(10, 2) not null");
    expect(normalized).toContain(
      "create or replace view daily_meal_plan_documents",
    );

    for (const status of ["draft", "active", "completed", "archived"]) {
      expect(normalized).toContain(`'${status}'`);
    }
    for (const status of [
      "planned",
      "confirmed",
      "partially_eaten",
      "replaced",
      "skipped",
      "unconfirmed",
    ]) {
      expect(normalized).toContain(`'${status}'`);
    }
  });
});

describe("Neon SQL schema", () => {
  it("contains the first-slice tables without Prisma-specific artifacts", () => {
    for (const tableName of [
      "users",
      "health_metric_definitions",
      "health_metric_samples",
      "daily_health_aggregates",
      "health_sync_cursors",
      "health_sync_batches",
      "telegram_accounts",
      "telegram_link_tokens",
      "telegram_processed_updates",
      "meals",
      "meal_estimates",
      "meal_corrections",
      "check_ins",
      "coach_memories",
      "reports",
      "write_proposals",
      "audit_events",
    ]) {
      expect(initialSchema).toContain(
        `create table if not exists ${tableName}`,
      );
    }

    expect(initialSchema).not.toMatch(/prisma|cuid/iu);
  });

  it("preserves critical health-data constraints and indexes", () => {
    expect(normalizeSql(initialSchema)).toContain(
      "unique (user_id, source, source_sample_id, metric_name)",
    );
    expect(normalizeSql(initialSchema)).toContain(
      "foreign key (metric_name, unit) references health_metric_definitions (metric_name, unit) on delete restrict",
    );
    expect(normalizeSql(initialSchema)).toContain(
      "create index if not exists health_metric_samples_user_metric_start_idx on health_metric_samples (user_id, metric_name, start_time)",
    );
    expect(normalizeSql(initialSchema)).toContain(
      "create unique index if not exists audit_events_idempotency_key_idx on audit_events (idempotency_key) where idempotency_key is not null",
    );
    expect(normalizeSql(initialSchema)).toContain(
      "create table if not exists health_sync_batches",
    );
    expect(normalizeSql(initialSchema)).toContain(
      "unique (user_id, idempotency_key)",
    );
    expect(normalizeSql(initialSchema)).toContain(
      "create table if not exists telegram_processed_updates",
    );
    expect(normalizeSql(initialSchema)).toContain(
      "telegram_update_id bigint not null unique",
    );
  });

  it("uses text account identifiers compatible with auth subjects", () => {
    const normalized = normalizeSql(initialSchema);

    expect(normalized).toContain("id text primary key");
    expect(normalized).toContain("user_id text not null references users (id)");
    expect(normalized).not.toContain("user_id uuid");
  });

  it("seeds exactly the first-slice metric definitions", () => {
    const seededMetrics = [...metricSeed.matchAll(/\('([^']+)', '([^']+)',/gu)]
      .map((match) => `${match[1]}:${match[2]}`)
      .sort();

    expect(seededMetrics).toEqual(
      [
        "active_energy:kcal",
        "carbs:g",
        "dietary_energy:kcal",
        "fat:g",
        "fiber:g",
        "heart_rate:bpm",
        "protein:g",
        "resting_energy:kcal",
        "resting_heart_rate:bpm",
        "sleep:minute",
        "steps:count",
        "walking_heart_rate:bpm",
        "weight:kg",
      ].sort(),
    );
  });
});

function readSql(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8").toLowerCase();
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}
