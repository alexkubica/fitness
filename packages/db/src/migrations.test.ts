import { describe, expect, it } from "vitest";
import { runMigrations, type MigrationSqlExecutor } from "./migrations.js";

describe("Neon SQL migration runner", () => {
  it("applies pending migrations in filename order and records them", async () => {
    const sql = createFakeMigrationSql([
      [],
      [{ filename: "001_initial_schema.sql" }],
      [],
      [],
    ]);

    const result = await runMigrations({
      migrations: [
        {
          filename: "002_seed_health_metric_definitions.sql",
          sql: "insert seed metrics;",
        },
        {
          filename: "001_initial_schema.sql",
          sql: "create initial schema;",
        },
        {
          filename: "003_future.sql",
          sql: "alter table future;",
        },
      ],
      sql,
    });

    expect(result).toEqual({
      applied: ["002_seed_health_metric_definitions.sql", "003_future.sql"],
      skipped: ["001_initial_schema.sql"],
    });
    expect(sql.calls).toEqual([
      {
        query: expect.stringContaining(
          "create table if not exists schema_migrations",
        ),
        params: [],
      },
      {
        query: expect.stringContaining("select filename"),
        params: [],
      },
      {
        query: "begin",
        params: [],
      },
      {
        query: "insert seed metrics",
        params: [],
      },
      {
        query: expect.stringContaining("insert into schema_migrations"),
        params: ["002_seed_health_metric_definitions.sql"],
      },
      {
        query: "commit",
        params: [],
      },
      {
        query: "begin",
        params: [],
      },
      {
        query: "alter table future",
        params: [],
      },
      {
        query: expect.stringContaining("insert into schema_migrations"),
        params: ["003_future.sql"],
      },
      {
        query: "commit",
        params: [],
      },
    ]);
  });

  it("executes multi-statement migrations without splitting dollar-quoted blocks", async () => {
    const sql = createFakeMigrationSql([[], [], [], [], [], [], []]);

    await runMigrations({
      migrations: [
        {
          filename: "001_initial_schema.sql",
          sql: `
            create extension if not exists pgcrypto;

            do $$
            begin
              perform 1;
              perform 2;
            end $$;

            create table if not exists users (id text primary key);
          `,
        },
      ],
      sql,
    });

    expect(sql.calls.map((call) => call.query)).toEqual([
      expect.stringContaining("create table if not exists schema_migrations"),
      expect.stringContaining("select filename"),
      "begin",
      "create extension if not exists pgcrypto",
      "do $$ begin perform 1; perform 2; end $$",
      "create table if not exists users (id text primary key)",
      expect.stringContaining("insert into schema_migrations"),
      "commit",
    ]);
  });
});

function createFakeMigrationSql(
  rowsByCall: readonly (readonly Record<string, unknown>[])[],
): MigrationSqlExecutor & {
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
