import type { SqlQueryExecutor } from "./health-samples.js";

export type { SqlQueryExecutor } from "./health-samples.js";

export type AuditActor = Readonly<{
  type: "user" | "service";
  id: string;
}>;

export type AuditTarget = Readonly<{
  type: string;
  id: string;
}>;

export type AuditEventInput = Readonly<{
  action: string;
  actor: AuditActor;
  target: AuditTarget;
  userId: string;
  profileId?: string | undefined;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type AuditEvent = AuditEventInput &
  Readonly<{
    id: string;
    createdAt: string;
  }>;

export type NeonAuditRepository = Readonly<{
  createAuditEvent(input: AuditEventInput): Promise<AuditEvent>;
}>;

export function createNeonAuditRepository(
  sql: SqlQueryExecutor,
): NeonAuditRepository {
  return {
    async createAuditEvent(input) {
      const rows = await sql`
        insert into audit_events (
          user_id,
          profile_id,
          actor_type,
          actor_id,
          action,
          target_type,
          target_id,
          metadata
        )
        values (
          ${input.userId},
          ${input.profileId ?? null}::uuid,
          ${input.actor.type},
          ${input.actor.id},
          ${input.action},
          ${input.target.type},
          ${input.target.id},
          ${metadataJson(input.metadata)}::jsonb
        )
        returning
          id::text,
          action,
          actor_type,
          actor_id,
          target_type,
          target_id,
          user_id,
          profile_id::text,
          metadata,
          created_at
      `;

      return rowToAuditEvent(rows[0]);
    },
  };
}

function rowToAuditEvent(row: Record<string, unknown> | undefined): AuditEvent {
  if (row === undefined) {
    throw new Error("Audit repository did not return a row.");
  }

  const metadata = metadataColumn(row, "metadata");

  return {
    id: stringColumn(row, "id"),
    action: stringColumn(row, "action"),
    actor: {
      type: auditActorType(row.actor_type),
      id: stringColumn(row, "actor_id"),
    },
    target: {
      type: stringColumn(row, "target_type"),
      id: stringColumn(row, "target_id"),
    },
    userId: stringColumn(row, "user_id"),
    profileId: optionalStringColumn(row, "profile_id"),
    ...(metadata === undefined ? {} : { metadata }),
    createdAt: timestampColumn(row, "created_at"),
  };
}

function optionalStringColumn(
  row: Record<string, unknown>,
  column: string,
): string | undefined {
  const value = row[column];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Expected ${column} to be a string.`);
  }

  return value;
}

function metadataJson(
  metadata: Readonly<Record<string, unknown>> | undefined,
): string | null {
  return metadata === undefined ? null : JSON.stringify(metadata);
}

function metadataColumn(
  row: Record<string, unknown>,
  column: string,
): Readonly<Record<string, unknown>> | undefined {
  const value = row[column];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;

    if (isRecord(parsed)) {
      return parsed;
    }
  }

  if (isRecord(value)) {
    return value;
  }

  throw new Error(`Expected ${column} to be JSON metadata.`);
}

function auditActorType(value: unknown): AuditActor["type"] {
  if (value === "user" || value === "service") {
    return value;
  }

  throw new Error("Expected actor_type to be a known audit actor type.");
}

function stringColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];

  if (typeof value !== "string") {
    throw new Error(`Expected ${column} to be a string.`);
  }

  return value;
}

function timestampColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }

  throw new Error(`Expected ${column} to be a timestamp.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
