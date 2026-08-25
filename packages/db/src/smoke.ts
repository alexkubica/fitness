import { HEALTH_METRICS } from "@fitness/domain";

export type SmokeSqlExecutor = Readonly<{
  query(
    query: string,
    params?: readonly unknown[],
  ): Promise<readonly Record<string, unknown>[]>;
}>;

export type SmokeCheckResult = Readonly<{
  tables: number;
  metricDefinitions: number;
}>;

const REQUIRED_TABLES = [
  "users",
  "health_profiles",
  "profile_access",
  "profile_permission_overrides",
  "health_metric_samples",
  "health_sync_batches",
  "oauth_authorization_codes",
  "oauth_refresh_tokens",
  "telegram_accounts",
  "telegram_link_tokens",
  "telegram_processed_updates",
  "telegram_reminder_preferences",
  "meals",
  "daily_meal_plans",
  "planned_meals",
  "planned_meal_ingredients",
  "meal_log_snapshots",
  "coach_profiles",
  "target_plans",
  "target_plan_events",
  "check_ins",
  "audit_events",
] as const;

export async function runDatabaseSmokeChecks(
  sql: SmokeSqlExecutor,
): Promise<SmokeCheckResult> {
  const tableRows = await sql.query(
    `
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name = any($1)
      order by table_name
    `,
    [[...REQUIRED_TABLES]],
  );
  const presentTables = new Set(
    tableRows.map((row) => stringColumn(row, "table_name")),
  );
  const missingTables = REQUIRED_TABLES.filter(
    (tableName) => !presentTables.has(tableName),
  );

  if (missingTables.length > 0) {
    throw new Error(`Missing required tables: ${missingTables.join(", ")}`);
  }

  const metricRows = await sql.query(`
    select metric_name, unit
    from health_metric_definitions
    order by metric_name
  `);
  const presentMetrics = new Set(
    metricRows.map(
      (row) =>
        `${stringColumn(row, "metric_name")}:${stringColumn(row, "unit")}`,
    ),
  );
  const missingMetrics = HEALTH_METRICS.map(
    (metric) => `${metric.name}:${metric.unit}`,
  ).filter((metric) => !presentMetrics.has(metric));

  if (missingMetrics.length > 0) {
    throw new Error(
      `Missing first-slice metric definitions: ${missingMetrics.join(", ")}`,
    );
  }

  return {
    tables: REQUIRED_TABLES.length,
    metricDefinitions: HEALTH_METRICS.length,
  };
}

function stringColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];

  if (typeof value !== "string") {
    throw new Error(`Expected ${column} to be a string.`);
  }

  return value;
}
