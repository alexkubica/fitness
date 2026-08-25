import { neon } from "@neondatabase/serverless";

const localDatabaseUrl =
  "postgresql://fitness:fitness@localhost:5432/fitness_dev";

export type DatabaseEnvironment = Readonly<Record<string, string | undefined>>;
export type FitnessSql = ReturnType<typeof neon>;

export function getDatabaseUrl(env: DatabaseEnvironment = envRecord()): string {
  if (env.DATABASE_URL !== undefined && env.DATABASE_URL.length > 0) {
    return env.DATABASE_URL;
  }

  if (env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required in production");
  }

  return localDatabaseUrl;
}

export function createNeonClient(
  connectionString = getDatabaseUrl(),
): FitnessSql {
  return neon(connectionString);
}

function envRecord(): DatabaseEnvironment {
  const globalWithProcess = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return globalWithProcess.process?.env ?? {};
}
