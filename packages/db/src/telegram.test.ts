import { describe, expect, it } from "vitest";
import {
  createNeonTelegramCoachRepository,
  createNeonTelegramLinkingRepository,
  createNeonTelegramReminderRepository,
  type SqlQueryExecutor,
} from "./telegram.js";

describe("Neon Telegram linking repository", () => {
  it("stores only a token hash when creating link tokens", async () => {
    const sql = createFakeSql([[]]);
    const repository = createNeonTelegramLinkingRepository(sql, {
      hashToken: (token) => `hash:${token}`,
    });

    const linkToken = await repository.createLinkToken({
      token: "raw-link-token",
      userId: "user_alex",
      state: "state-1",
      nonce: "nonce-1",
      expiresAt: "2026-06-11T12:05:00.000Z",
    });

    expect(linkToken).toEqual({
      token: "raw-link-token",
      userId: "user_alex",
      state: "state-1",
      nonce: "nonce-1",
      expiresAt: "2026-06-11T12:05:00.000Z",
    });
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0]?.text).toContain("telegram_link_tokens");
    expect(sql.calls[0]?.text).toContain("token_hash");
    expect(sql.calls[0]?.values).toContain("hash:raw-link-token");
    expect(sql.calls[0]?.values).not.toContain("raw-link-token");
  });

  it("consumes link tokens by hash and returns the linked account", async () => {
    const sql = createFakeSql([
      [
        {
          ok: true,
          id: "telegram-account-1",
          user_id: "user_alex",
          telegram_user_id: "12345",
          linked_at: new Date("2026-06-11T12:00:00.000Z"),
          revoked_at: null,
        },
      ],
    ]);
    const repository = createNeonTelegramLinkingRepository(sql, {
      hashToken: (token) => `hash:${token}`,
    });

    const result = await repository.consumeLinkToken({
      token: "raw-link-token",
      state: "state-1",
      nonce: "nonce-1",
      telegramUserId: 12_345,
    });

    expect(result).toEqual({
      ok: true,
      account: {
        id: "telegram-account-1",
        userId: "user_alex",
        telegramUserId: 12_345,
        linkedAt: "2026-06-11T12:00:00.000Z",
        active: true,
      },
    });
    expect(sql.calls[0]?.text).toContain("token_hash");
    expect(sql.calls[0]?.text).toContain("account-mismatch");
    expect(sql.calls[0]?.values).toContain("hash:raw-link-token");
    expect(sql.calls[0]?.values).not.toContain("raw-link-token");
  });

  it("consumes opaque deep-link tokens without requiring state and nonce in Telegram", async () => {
    const sql = createFakeSql([
      [
        {
          ok: true,
          id: "telegram-account-1",
          user_id: "user_alex",
          telegram_user_id: "12345",
          linked_at: new Date("2026-06-11T12:00:00.000Z"),
          revoked_at: null,
        },
      ],
    ]);
    const repository = createNeonTelegramLinkingRepository(sql, {
      hashToken: (token) => `hash:${token}`,
    });

    const result = await repository.consumeOpaqueLinkToken({
      token: "raw-link-token",
      telegramUserId: 12_345,
    });

    expect(result).toMatchObject({
      ok: true,
      account: {
        userId: "user_alex",
        telegramUserId: 12_345,
      },
    });
    expect(sql.calls[0]?.text).toContain("request_input.state is not null");
    expect(sql.calls[0]?.text).toContain("request_input.nonce is not null");
    expect(sql.calls[0]?.values).toContain("hash:raw-link-token");
    expect(sql.calls[0]?.values).toContain(null);
    expect(sql.calls[0]?.values).not.toContain("raw-link-token");
  });
});

describe("Neon Telegram coach repository", () => {
  it("claims Telegram updates for durable idempotency", async () => {
    const sql = createFakeSql([[{ claimed: true }]]);
    const repository = createNeonTelegramCoachRepository(sql);

    const claimed = await repository.claimUpdate({
      updateId: 50,
      telegramUserId: 12_345,
      telegramChatId: 12_345,
      receivedAt: "2026-06-11T12:00:00.000Z",
    });

    expect(claimed).toBe(true);
    expect(sql.calls[0]?.text).toContain("telegram_processed_updates");
    expect(sql.calls[0]?.text).toContain("on conflict");
    expect(sql.calls[0]?.values).toEqual([
      50,
      "12345",
      "12345",
      "2026-06-11T12:00:00.000Z",
    ]);
  });

  it("persists Telegram check-ins and meal logs with idempotency keys", async () => {
    const sql = createFakeSql([
      [
        {
          id: "check-in-1",
          user_id: "user_alex",
          checked_in_at: new Date("2026-06-11T12:00:00.000Z"),
          hunger: 6,
          mood: 7,
          energy: 5,
          stress: 4,
          cravings: 2,
          notes: "Long day",
        },
      ],
      [
        {
          id: "meal-1",
          user_id: "user_alex",
          description: "Greek yogurt and berries",
          occurred_at: new Date("2026-06-11T12:00:00.000Z"),
        },
      ],
    ]);
    const repository = createNeonTelegramCoachRepository(sql);

    const checkIn = await repository.createCheckIn({
      idempotencyKey: "telegram-update-50-checkin",
      userId: "user_alex",
      telegramUserId: 12_345,
      checkedInAt: "2026-06-11T12:00:00.000Z",
      timezone: "Asia/Jerusalem",
      hunger: 6,
      mood: 7,
      energy: 5,
      stress: 4,
      cravings: 2,
      notes: "Long day",
    });
    const meal = await repository.createMealLog({
      idempotencyKey: "telegram-update-51-meal",
      userId: "user_alex",
      telegramUserId: 12_345,
      text: "Greek yogurt and berries",
      occurredAt: "2026-06-11T12:00:00.000Z",
      timezone: "Asia/Jerusalem",
    });

    expect(checkIn).toEqual({
      id: "check-in-1",
      userId: "user_alex",
      telegramUserId: 12_345,
      hunger: 6,
      mood: 7,
      energy: 5,
      stress: 4,
      cravings: 2,
      notes: "Long day",
      createdAt: "2026-06-11T12:00:00.000Z",
    });
    expect(meal).toEqual({
      id: "meal-1",
      userId: "user_alex",
      telegramUserId: 12_345,
      text: "Greek yogurt and berries",
      createdAt: "2026-06-11T12:00:00.000Z",
    });
    expect(sql.calls[0]?.text).toContain("check_ins");
    expect(sql.calls[0]?.text).toContain("on conflict");
    expect(sql.calls[1]?.text).toContain("meals");
    expect(sql.calls[1]?.text).toContain("on conflict");
  });

  it("lists Telegram check-ins and meal logs for report ranges", async () => {
    const sql = createFakeSql([
      [
        {
          id: "check-in-1",
          user_id: "user_alex",
          telegram_user_id: "12345",
          checked_in_at: new Date("2026-06-11T08:00:00.000Z"),
          hunger: 6,
          mood: 7,
          energy: 5,
          stress: 4,
          cravings: 2,
          notes: "Long day",
        },
      ],
      [
        {
          id: "meal-1",
          user_id: "user_alex",
          telegram_user_id: "12345",
          description: "Greek yogurt and berries",
          occurred_at: new Date("2026-06-11T09:00:00.000Z"),
        },
      ],
    ]);
    const repository = createNeonTelegramCoachRepository(sql);
    const range = {
      from: "2026-06-11T00:00:00.000Z",
      to: "2026-06-12T00:00:00.000Z",
    };

    const checkIns = await repository.listCheckIns({
      userId: "user_alex",
      range,
    });
    const mealLogs = await repository.listMealLogs({
      userId: "user_alex",
      range,
    });

    expect(checkIns).toEqual([
      {
        id: "check-in-1",
        userId: "user_alex",
        telegramUserId: 12_345,
        hunger: 6,
        mood: 7,
        energy: 5,
        stress: 4,
        cravings: 2,
        notes: "Long day",
        createdAt: "2026-06-11T08:00:00.000Z",
      },
    ]);
    expect(mealLogs).toEqual([
      {
        id: "meal-1",
        userId: "user_alex",
        telegramUserId: 12_345,
        text: "Greek yogurt and berries",
        createdAt: "2026-06-11T09:00:00.000Z",
      },
    ]);
    expect(sql.calls[0]?.text).toContain("from check_ins");
    expect(sql.calls[0]?.values).toEqual([
      "user_alex",
      null,
      null,
      "user_alex",
      range.from,
      range.to,
    ]);
    expect(sql.calls[1]?.text).toContain("from meals");
    expect(sql.calls[1]?.values).toEqual([
      "user_alex",
      null,
      null,
      "user_alex",
      range.from,
      range.to,
    ]);
  });
});

describe("Neon Telegram reminder repository", () => {
  it("upserts reminder preferences as structured JSON", async () => {
    const slots = [
      {
        id: "morning-checkin",
        kind: "checkin" as const,
        localTime: "09:00",
      },
    ];
    const quietHours = {
      start: "22:00",
      end: "07:00",
    };
    const lastSentAtBySlot = {
      "morning-checkin": "2026-06-10T06:05:00.000Z",
    };
    const sql = createFakeSql([
      [
        {
          user_id: "user_alex",
          enabled: true,
          timezone: "Asia/Jerusalem",
          slots,
          quiet_hours: quietHours,
          last_sent_at_by_slot: lastSentAtBySlot,
        },
      ],
    ]);
    const repository = createNeonTelegramReminderRepository(sql);

    const preferences = await repository.upsertPreferences({
      userId: "user_alex",
      enabled: true,
      timezone: "Asia/Jerusalem",
      slots,
      quietHours,
      lastSentAtBySlot,
    });

    expect(preferences).toEqual({
      userId: "user_alex",
      enabled: true,
      timezone: "Asia/Jerusalem",
      slots,
      quietHours,
      lastSentAtBySlot,
    });
    expect(sql.calls[0]?.text).toContain("telegram_reminder_preferences");
    expect(sql.calls[0]?.text).toContain("on conflict");
    expect(sql.calls[0]?.values).toEqual([
      "user_alex",
      "user_alex",
      true,
      "Asia/Jerusalem",
      JSON.stringify(slots),
      JSON.stringify(quietHours),
      JSON.stringify(lastSentAtBySlot),
    ]);
  });

  it("lists active linked Telegram users with reminder preferences for planning", async () => {
    const sql = createFakeSql([
      [
        {
          user_id: "user_alex",
          telegram_user_id: "12345",
          telegram_chat_id: "67890",
          enabled: true,
          timezone: "Asia/Jerusalem",
          slots: [
            {
              id: "evening-checkin",
              kind: "checkin",
              localTime: "20:30",
            },
          ],
          quiet_hours: null,
          last_sent_at_by_slot: {},
        },
      ],
    ]);
    const repository = createNeonTelegramReminderRepository(sql);

    const candidates = await repository.listReminderCandidates();

    expect(candidates).toEqual([
      {
        userId: "user_alex",
        telegramUserId: 12_345,
        telegramChatId: 67_890,
        preferences: {
          userId: "user_alex",
          enabled: true,
          timezone: "Asia/Jerusalem",
          slots: [
            {
              id: "evening-checkin",
              kind: "checkin",
              localTime: "20:30",
            },
          ],
          lastSentAtBySlot: {},
        },
      },
    ]);
    expect(sql.calls[0]?.text).toContain("join telegram_accounts");
    expect(sql.calls[0]?.text).toContain("revoked_at is null");
  });

  it("lists stored reminder preferences for service adapters", async () => {
    const sql = createFakeSql([
      [
        {
          user_id: "user_alex",
          enabled: false,
          timezone: "Asia/Jerusalem",
          slots: [],
          quiet_hours: {
            start: "22:00",
            end: "07:00",
          },
          last_sent_at_by_slot: {},
        },
      ],
    ]);
    const repository = createNeonTelegramReminderRepository(sql);

    const preferences = await repository.listPreferences();

    expect(preferences).toEqual([
      {
        userId: "user_alex",
        enabled: false,
        timezone: "Asia/Jerusalem",
        slots: [],
        quietHours: {
          start: "22:00",
          end: "07:00",
        },
        lastSentAtBySlot: {},
      },
    ]);
    expect(sql.calls[0]?.text).toContain("from telegram_reminder_preferences");
    expect(sql.calls[0]?.text).toContain("order by user_id asc");
  });

  it("claims a reminder slot only when it has not been sent for the local date", async () => {
    const slots = [
      {
        id: "morning-checkin",
        kind: "checkin",
        localTime: "09:00",
      },
    ];
    const lastSentAtBySlot = {
      "morning-checkin": "2026-06-12T06:05:00.000Z",
    };
    const sql = createFakeSql([
      [
        {
          user_id: "user_alex",
          enabled: true,
          timezone: "Asia/Jerusalem",
          slots,
          quiet_hours: null,
          last_sent_at_by_slot: lastSentAtBySlot,
        },
      ],
    ]);
    const repository = createNeonTelegramReminderRepository(sql);

    const preferences = await repository.claimReminderSlot({
      userId: "user_alex",
      slotId: "morning-checkin",
      localDate: "2026-06-12",
      timezone: "Asia/Jerusalem",
      sentAt: "2026-06-12T06:05:00.000Z",
    });

    expect(preferences).toEqual({
      userId: "user_alex",
      enabled: true,
      timezone: "Asia/Jerusalem",
      slots,
      lastSentAtBySlot,
    });
    expect(sql.calls[0]?.text).toContain(
      "update telegram_reminder_preferences",
    );
    expect(sql.calls[0]?.text).toContain("jsonb_set");
    expect(sql.calls[0]?.text).toContain("returning");
    expect(sql.calls[0]?.values).toEqual([
      "morning-checkin",
      "2026-06-12T06:05:00.000Z",
      "user_alex",
      "Asia/Jerusalem",
      "morning-checkin",
      "morning-checkin",
      "Asia/Jerusalem",
      "2026-06-12",
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
