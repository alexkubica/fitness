import { createNeonClient, getDatabaseUrl } from "./client.js";
import {
  readMigrationsFromDirectory,
  runMigrations,
  type MigrationSqlExecutor,
} from "./migrations.js";

async function main(): Promise<void> {
  const neonSql = createNeonClient(getDatabaseUrl());
  const result = await runMigrations({
    migrations: await readMigrationsFromDirectory(),
    sql: {
      async query(query, params) {
        return neonSql.query(
          query,
          params === undefined ? undefined : [...params],
        ) as Promise<readonly Record<string, unknown>[]>;
      },
    } satisfies MigrationSqlExecutor,
  });

  console.log(
    JSON.stringify(
      {
        applied: result.applied,
        skipped: result.skipped,
      },
      null,
      2,
    ),
  );
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

function isMainModule(): boolean {
  return import.meta.url === new URL(process.argv[1] ?? "", "file:").href;
}
