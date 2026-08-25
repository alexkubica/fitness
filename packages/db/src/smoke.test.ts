import { describe, expect, it } from "vitest";
import { runDatabaseSmokeChecks, type SmokeSqlExecutor } from "./smoke.js";

describe("Neon database smoke checks", () => {
  it("verifies required tables and first-slice metric definitions", async () => {
    const sql = createFakeSmokeSql([
      [
        { table_name: "users" },
        { table_name: "health_profiles" },
        { table_name: "profile_access" },
        { table_name: "profile_permission_overrides" },
        { table_name: "health_metric_samples" },
        { table_name: "health_sync_batches" },
        { table_name: "oauth_authorization_codes" },
        { table_name: "oauth_refresh_tokens" },
        { table_name: "telegram_accounts" },
        { table_name: "telegram_link_tokens" },
        { table_name: "telegram_processed_updates" },
        { table_name: "telegram_reminder_preferences" },
        { table_name: "meals" },
        { table_name: "daily_meal_plans" },
        { table_name: "planned_meals" },
        { table_name: "planned_meal_ingredients" },
        { table_name: "meal_log_snapshots" },
        { table_name: "coach_profiles" },
        { table_name: "target_plans" },
        { table_name: "target_plan_events" },
        { table_name: "check_ins" },
        { table_name: "audit_events" },
      ],
      [
        { metric_name: "weight", unit: "kg" },
        { metric_name: "steps", unit: "count" },
        { metric_name: "active_energy", unit: "kcal" },
        { metric_name: "resting_energy", unit: "kcal" },
        { metric_name: "sleep", unit: "minute" },
        { metric_name: "heart_rate", unit: "bpm" },
        { metric_name: "resting_heart_rate", unit: "bpm" },
        { metric_name: "walking_heart_rate", unit: "bpm" },
        { metric_name: "dietary_energy", unit: "kcal" },
        { metric_name: "protein", unit: "g" },
        { metric_name: "carbs", unit: "g" },
        { metric_name: "fat", unit: "g" },
        { metric_name: "fiber", unit: "g" },
      ],
    ]);

    const result = await runDatabaseSmokeChecks(sql);

    expect(result).toEqual({
      metricDefinitions: 13,
      tables: 22,
    });
    expect(sql.calls[0]?.query).toContain("information_schema.tables");
    expect(sql.calls[1]?.query).toContain("health_metric_definitions");
  });

  it("fails when a required table is missing", async () => {
    const sql = createFakeSmokeSql([
      [{ table_name: "users" }],
      [
        { metric_name: "weight", unit: "kg" },
        { metric_name: "steps", unit: "count" },
      ],
    ]);

    await expect(runDatabaseSmokeChecks(sql)).rejects.toThrow(
      /missing required tables/i,
    );
  });
});

function createFakeSmokeSql(
  rowsByCall: readonly (readonly Record<string, unknown>[])[],
): SmokeSqlExecutor & {
  calls: { query: string; params: readonly unknown[] }[];
} {
  const calls: { query: string; params: readonly unknown[] }[] = [];

  return {
    calls,
    async query(query, params = []) {
      calls.push({
        query: normalizeQuery(query),
        params,
      });

      return rowsByCall[calls.length - 1] ?? [];
    },
  };
}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/gu, " ").trim();
}
