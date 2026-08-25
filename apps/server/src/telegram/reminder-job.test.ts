import { describe, expect, it } from "vitest";
import { createAuditService } from "../services/audit.js";
import { runTelegramReminderJob } from "./reminder-job.js";
import type { TelegramReminderPreferenceStore } from "./reminders.js";

const now = new Date("2026-06-12T06:05:00.000Z");

describe("Telegram reminder job", () => {
  it("runs due reminders and writes a JSON result", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const sentMessages: { chatId: number; text: string }[] = [];
    const result = await runTelegramReminderJob({
      env: {},
      messenger: {
        async sendMessage(chatId, text) {
          sentMessages.push({ chatId, text });
        },
      },
      now: () => now,
      services: {
        audit: createAuditService({ now: () => now }),
        telegramReminders: createReminderStore(),
      },
      stderr(chunk) {
        stderr.push(chunk);
      },
      stdout(chunk) {
        stdout.push(chunk);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(sentMessages).toHaveLength(1);
    expect(JSON.parse(stdout.join(""))).toEqual({
      planned: 1,
      sent: 1,
      failed: 0,
      failures: [],
    });
  });

  it("refuses to run without a Telegram bot token or injected messenger", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await runTelegramReminderJob({
      env: {},
      services: {
        audit: createAuditService({ now: () => now }),
        telegramReminders: createReminderStore(),
      },
      stderr(chunk) {
        stderr.push(chunk);
      },
      stdout(chunk) {
        stdout.push(chunk);
      },
    });

    expect(result.exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toMatch(/TELEGRAM_BOT_TOKEN/);
  });
});

function createReminderStore(): TelegramReminderPreferenceStore {
  const preferences = {
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
    async upsertPreferences(input) {
      return input;
    },
    async findPreferencesByUserId(userId) {
      return userId === preferences.userId ? preferences : undefined;
    },
    async claimReminderSlot(input) {
      return {
        ...preferences,
        lastSentAtBySlot: {
          ...preferences.lastSentAtBySlot,
          [input.slotId]: input.sentAt,
        },
      };
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
