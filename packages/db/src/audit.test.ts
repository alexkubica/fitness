import { describe, expect, it } from "vitest";
import { createNeonAuditRepository, type SqlQueryExecutor } from "./audit.js";

describe("Neon audit repository", () => {
  it("inserts append-only audit events", async () => {
    const sql = createFakeSql([
      [
        {
          id: "audit-event-1",
          action: "telegram.checkin.log",
          actor_type: "user",
          actor_id: "user_alex",
          target_type: "telegram_checkin",
          target_id: "db-checkin-1",
          user_id: "user_alex",
          metadata: { telegramUserId: 12_345 },
          created_at: new Date("2026-06-11T12:00:00.000Z"),
        },
      ],
    ]);
    const repository = createNeonAuditRepository(sql);

    const event = await repository.createAuditEvent({
      action: "telegram.checkin.log",
      actor: {
        type: "user",
        id: "user_alex",
      },
      target: {
        type: "telegram_checkin",
        id: "db-checkin-1",
      },
      userId: "user_alex",
      metadata: {
        telegramUserId: 12_345,
      },
    });

    expect(event).toEqual({
      id: "audit-event-1",
      action: "telegram.checkin.log",
      actor: {
        type: "user",
        id: "user_alex",
      },
      target: {
        type: "telegram_checkin",
        id: "db-checkin-1",
      },
      userId: "user_alex",
      metadata: {
        telegramUserId: 12_345,
      },
      createdAt: "2026-06-11T12:00:00.000Z",
    });
    expect(sql.calls).toEqual([
      {
        text: expect.stringContaining("insert into audit_events"),
        values: [
          "user_alex",
          null,
          "user",
          "user_alex",
          "telegram.checkin.log",
          "telegram_checkin",
          "db-checkin-1",
          JSON.stringify({ telegramUserId: 12_345 }),
        ],
      },
    ]);
  });
});

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
