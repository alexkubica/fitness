import { createNeonClient, getDatabaseUrl } from "./client.js";
import { runDatabaseSmokeChecks, type SmokeSqlExecutor } from "./smoke.js";

async function main(): Promise<void> {
  const neonSql = createNeonClient(getDatabaseUrl());
  const result = await runDatabaseSmokeChecks({
    async query(query, params) {
      return neonSql.query(
        query,
        params === undefined ? undefined : [...params],
      ) as Promise<readonly Record<string, unknown>[]>;
    },
  } satisfies SmokeSqlExecutor);

  console.log(JSON.stringify(result, null, 2));
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
