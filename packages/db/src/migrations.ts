import { readdir, readFile } from "node:fs/promises";

export type Migration = Readonly<{
  filename: string;
  sql: string;
}>;

export type MigrationSqlExecutor = Readonly<{
  query(
    query: string,
    params?: readonly unknown[],
  ): Promise<readonly Record<string, unknown>[]>;
}>;

export type MigrationResult = Readonly<{
  applied: readonly string[];
  skipped: readonly string[];
}>;

export async function runMigrations(input: {
  sql: MigrationSqlExecutor;
  migrations: readonly Migration[];
}): Promise<MigrationResult> {
  await input.sql.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const appliedRows = await input.sql.query(`
    select filename
    from schema_migrations
    order by filename
  `);
  const alreadyApplied = new Set(
    appliedRows.map((row) => stringColumn(row, "filename")),
  );
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of [...input.migrations].sort(compareMigrations)) {
    if (alreadyApplied.has(migration.filename)) {
      skipped.push(migration.filename);
      continue;
    }

    await input.sql.query("begin");

    try {
      for (const statement of splitSqlStatements(migration.sql)) {
        await input.sql.query(statement);
      }

      await input.sql.query(
        `
          insert into schema_migrations (filename)
          values ($1)
        `,
        [migration.filename],
      );
      await input.sql.query("commit");
    } catch (error) {
      await input.sql.query("rollback").catch(() => undefined);
      throw error;
    }

    applied.push(migration.filename);
  }

  return {
    applied,
    skipped,
  };
}

export async function readMigrationsFromDirectory(
  directory = new URL("../sql/", import.meta.url),
): Promise<readonly Migration[]> {
  const entries = await readdir(directory);
  const sqlFiles = entries
    .filter((entry) => entry.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    sqlFiles.map(async (filename) => ({
      filename,
      sql: await readFile(new URL(filename, directory), "utf8"),
    })),
  );
}

function compareMigrations(left: Migration, right: Migration): number {
  return left.filename.localeCompare(right.filename);
}

function splitSqlStatements(sql: string): readonly string[] {
  const statements: string[] = [];
  let current = "";
  let index = 0;
  let dollarQuoteTag: string | undefined;
  let inBlockComment = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inSingleQuote = false;

  while (index < sql.length) {
    const char = sql[index] ?? "";
    const next = sql[index + 1] ?? "";

    if (inLineComment) {
      current += char;
      index += 1;

      if (char === "\n") {
        inLineComment = false;
      }

      continue;
    }

    if (inBlockComment) {
      current += char;

      if (char === "*" && next === "/") {
        current += next;
        index += 2;
        inBlockComment = false;
        continue;
      }

      index += 1;
      continue;
    }

    if (dollarQuoteTag !== undefined) {
      if (sql.startsWith(dollarQuoteTag, index)) {
        current += dollarQuoteTag;
        index += dollarQuoteTag.length;
        dollarQuoteTag = undefined;
        continue;
      }

      current += char;
      index += 1;
      continue;
    }

    if (inSingleQuote) {
      current += char;

      if (char === "'" && next === "'") {
        current += next;
        index += 2;
        continue;
      }

      if (char === "'") {
        inSingleQuote = false;
      }

      index += 1;
      continue;
    }

    if (inDoubleQuote) {
      current += char;

      if (char === '"' && next === '"') {
        current += next;
        index += 2;
        continue;
      }

      if (char === '"') {
        inDoubleQuote = false;
      }

      index += 1;
      continue;
    }

    if (char === "-" && next === "-") {
      current += char + next;
      index += 2;
      inLineComment = true;
      continue;
    }

    if (char === "/" && next === "*") {
      current += char + next;
      index += 2;
      inBlockComment = true;
      continue;
    }

    if (char === "'") {
      current += char;
      index += 1;
      inSingleQuote = true;
      continue;
    }

    if (char === '"') {
      current += char;
      index += 1;
      inDoubleQuote = true;
      continue;
    }

    if (char === "$") {
      const tag = dollarQuoteTagAt(sql, index);

      if (tag !== undefined) {
        current += tag;
        index += tag.length;
        dollarQuoteTag = tag;
        continue;
      }
    }

    if (char === ";") {
      pushStatement(statements, current);
      current = "";
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  pushStatement(statements, current);

  return statements;
}

function dollarQuoteTagAt(sql: string, index: number): string | undefined {
  const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(sql.slice(index));

  return match?.[0];
}

function pushStatement(statements: string[], statement: string): void {
  const trimmed = statement.trim();

  if (trimmed.length > 0) {
    statements.push(trimmed);
  }
}

function stringColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];

  if (typeof value !== "string") {
    throw new Error(`Expected ${column} to be a string.`);
  }

  return value;
}
