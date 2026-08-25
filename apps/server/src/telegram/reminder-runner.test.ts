import { describe, expect, it } from "vitest";
import { createAuditService } from "../services/audit.js";
import type { TelegramMessenger } from "./bot.js";
import {
  runDueTelegramReminders,
  type TelegramReminderPreferences,
  type TelegramReminderPreferenceStore,
} from "./reminders.js";

const now = new Date("2026-06-12T06:05:00.000Z");

describe("Telegram reminder runner", () => {
  it("claims due reminders, sends them, and records audit events", async () => {
    const audit = createAuditService({ now: () => now });
    const store = createReminderStore();
    const sentMessages: { chatId: number; text: string }[] = [];
    const messenger: TelegramMessenger = {
      async sendMessage(chatId, text) {
        sentMessages.push({ chatId, text });
      },
    };

    const result = await runDueTelegramReminders({
      audit,
      messenger,
      now: () => now,
      reminders: store,
    });

    expect(result).toEqual({
      planned: 1,
      sent: 1,
      failed: 0,
      failures: [],
    });
    expect(sentMessages).toEqual([
      {
        chatId: 67_890,
        text: "Quick check-in: hunger, mood, energy, stress, cravings?",
      },
    ]);
    expect(store.claims).toEqual([
      {
        localDate: "2026-06-12",
        sentAt: now.toISOString(),
        slotId: "morning-checkin",
        timezone: "Asia/Jerusalem",
        userId: "user_alex",
      },
    ]);
    expect(audit.list()).toContainEqual(
      expect.objectContaining({
        action: "telegram.reminder.send",
        actor: {
          type: "service",
          id: "telegram-reminder-runner",
        },
        target: {
          type: "telegram_reminder",
          id: "user_alex:morning-checkin:2026-06-12",
        },
        userId: "user_alex",
        metadata: {
          telegramUserId: 12_345,
          telegramChatId: 67_890,
          slotId: "morning-checkin",
          kind: "checkin",
          localDate: "2026-06-12",
          localTime: "09:00",
          textLength: 55,
        },
      }),
    );
  });

  it("keeps the claim when Telegram delivery fails to avoid ambiguous duplicates", async () => {
    const audit = createAuditService({ now: () => now });
    const store = createReminderStore();
    const messenger: TelegramMessenger = {
      async sendMessage() {
        throw new Error("telegram unavailable");
      },
    };

    const result = await runDueTelegramReminders({
      audit,
      messenger,
      now: () => now,
      reminders: store,
    });

    expect(result).toEqual({
      planned: 1,
      sent: 0,
      failed: 1,
      failures: [
        {
          userId: "user_alex",
          slotId: "morning-checkin",
          reason: "telegram unavailable",
        },
      ],
    });
    expect(store.claims).toEqual([
      {
        localDate: "2026-06-12",
        sentAt: now.toISOString(),
        slotId: "morning-checkin",
        timezone: "Asia/Jerusalem",
        userId: "user_alex",
      },
    ]);
    expect(audit.list()).toEqual([]);
  });

  it("skips sending when a concurrent run already claimed the slot", async () => {
    const audit = createAuditService({ now: () => now });
    const store = createReminderStore({ claimSucceeds: false });
    const sentMessages: { chatId: number; text: string }[] = [];
    const messenger: TelegramMessenger = {
      async sendMessage(chatId, text) {
        sentMessages.push({ chatId, text });
      },
    };

    const result = await runDueTelegramReminders({
      audit,
      messenger,
      now: () => now,
      reminders: store,
    });

    expect(result).toEqual({
      planned: 1,
      sent: 0,
      failed: 0,
      failures: [],
    });
    expect(sentMessages).toEqual([]);
    expect(audit.list()).toEqual([]);
  });
});

function createReminderStore(
  options: { claimSucceeds?: boolean } = {},
): TelegramReminderPreferenceStore & {
  claims: Awaited<
    Parameters<TelegramReminderPreferenceStore["claimReminderSlot"]>[0]
  >[];
} {
  const claims: Awaited<
    Parameters<TelegramReminderPreferenceStore["claimReminderSlot"]>[0]
  >[] = [];
  let preferences: TelegramReminderPreferences = {
    userId: "user_alex",
    enabled: true,
    timezone: "Asia/Jerusalem",
    slots: [
      {
        id: "morning-checkin",
        kind: "checkin" as const,
        localTime: "09:00",
      },
    ],
    lastSentAtBySlot: {},
  };

  return {
    claims,
    async upsertPreferences(input) {
      preferences = input;
      return input;
    },
    async findPreferencesByUserId(userId) {
      return userId === preferences.userId ? preferences : undefined;
    },
    async claimReminderSlot(input) {
      claims.push(input);

      if (options.claimSucceeds === false) {
        return undefined;
      }

      preferences = {
        ...preferences,
        lastSentAtBySlot: {
          ...preferences.lastSentAtBySlot,
          [input.slotId]: input.sentAt,
        },
      };

      return preferences;
    },
    async listPreferences() {
      return [preferences];
    },
    async listReminderCandidates() {
      return [
        {
          userId: "user_alex",
          telegramUserId: 12_345,
          telegramChatId: 67_890,
          preferences,
        },
      ];
    },
  };
}
