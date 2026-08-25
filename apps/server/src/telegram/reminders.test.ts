import { describe, expect, it } from "vitest";
import {
  createInMemoryTelegramReminderPreferenceStore,
  createRepositoryTelegramReminderPreferenceStore,
  defaultTelegramReminderPreferences,
  planDueTelegramReminders,
} from "./reminders.js";

describe("Telegram reminder planner", () => {
  it("plans enabled linked-user reminders after the user's local slot time", () => {
    const due = planDueTelegramReminders({
      now: new Date("2026-06-11T06:05:00.000Z"),
      candidates: [
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
                id: "morning-checkin",
                kind: "checkin",
                localTime: "09:00",
              },
            ],
            lastSentAtBySlot: {},
          },
        },
      ],
    });

    expect(due).toEqual([
      {
        userId: "user_alex",
        telegramUserId: 12_345,
        telegramChatId: 67_890,
        slotId: "morning-checkin",
        kind: "checkin",
        timezone: "Asia/Jerusalem",
        localDate: "2026-06-11",
        localTime: "09:00",
        plannedAt: "2026-06-11T06:05:00.000Z",
        text: "Quick check-in: hunger, mood, energy, stress, cravings?",
      },
    ]);
  });

  it("avoids duplicate reminders for the same local date and slot", () => {
    const due = planDueTelegramReminders({
      now: new Date("2026-06-11T18:10:00.000Z"),
      candidates: [
        {
          userId: "user_alex",
          telegramUserId: 12_345,
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
            lastSentAtBySlot: {
              "evening-checkin": "2026-06-11T17:40:00.000Z",
            },
          },
        },
      ],
    });

    expect(due).toEqual([]);
  });

  it("skips disabled preferences and reminders that are inside quiet hours", () => {
    const due = planDueTelegramReminders({
      now: new Date("2026-06-11T20:05:00.000Z"),
      candidates: [
        {
          userId: "user_disabled",
          telegramUserId: 22_222,
          preferences: {
            userId: "user_disabled",
            enabled: false,
            timezone: "Asia/Jerusalem",
            slots: [
              {
                id: "evening-checkin",
                kind: "checkin",
                localTime: "22:00",
              },
            ],
            lastSentAtBySlot: {},
          },
        },
        {
          userId: "user_quiet",
          telegramUserId: 33_333,
          preferences: {
            userId: "user_quiet",
            enabled: true,
            timezone: "Asia/Jerusalem",
            slots: [
              {
                id: "evening-checkin",
                kind: "checkin",
                localTime: "22:00",
              },
            ],
            quietHours: {
              start: "22:30",
              end: "07:00",
            },
            lastSentAtBySlot: {},
          },
        },
      ],
    });

    expect(due).toEqual([]);
  });
});

describe("Telegram reminder preferences", () => {
  it("defaults reminders to disabled with quiet hours and check-in slots", () => {
    expect(
      defaultTelegramReminderPreferences({
        userId: "user_alex",
        timezone: "Asia/Jerusalem",
      }),
    ).toEqual({
      userId: "user_alex",
      enabled: false,
      timezone: "Asia/Jerusalem",
      slots: [
        {
          id: "morning-checkin",
          kind: "checkin",
          localTime: "09:00",
        },
        {
          id: "evening-checkin",
          kind: "checkin",
          localTime: "20:30",
        },
      ],
      quietHours: {
        start: "22:00",
        end: "07:00",
      },
      lastSentAtBySlot: {},
    });
  });

  it("stores reminder preferences without sharing mutable caller state", async () => {
    const store = createInMemoryTelegramReminderPreferenceStore();
    const slots = [
      {
        id: "midday-checkin",
        kind: "checkin" as const,
        localTime: "12:15",
      },
    ];

    const saved = await store.upsertPreferences({
      userId: "user_alex",
      enabled: true,
      timezone: "Asia/Jerusalem",
      slots,
      quietHours: {
        start: "23:00",
        end: "06:30",
      },
      lastSentAtBySlot: {
        "midday-checkin": "2026-06-10T09:30:00.000Z",
      },
    });

    slots[0] = {
      id: "mutated",
      kind: "checkin",
      localTime: "08:00",
    };

    await expect(store.findPreferencesByUserId("user_alex")).resolves.toEqual(
      saved,
    );
    await expect(store.listPreferences()).resolves.toEqual([saved]);
  });
});

describe("repository-backed Telegram reminder preference store", () => {
  it("delegates reminder preference reads and writes to the repository", async () => {
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
      quietHours: {
        start: "22:00",
        end: "07:00",
      },
      lastSentAtBySlot: {},
    };
    const calls: unknown[] = [];
    const store = createRepositoryTelegramReminderPreferenceStore({
      async upsertPreferences(input) {
        calls.push({
          method: "upsertPreferences",
          input,
        });
        return input;
      },
      async findPreferencesByUserId(userId) {
        calls.push({
          method: "findPreferencesByUserId",
          userId,
        });
        return preferences;
      },
      async claimReminderSlot(input) {
        calls.push({
          method: "claimReminderSlot",
          input,
        });
        return preferences;
      },
      async listPreferences() {
        calls.push({
          method: "listPreferences",
        });
        return [preferences];
      },
      async listReminderCandidates() {
        throw new Error("not used");
      },
    });

    await expect(store.upsertPreferences(preferences)).resolves.toEqual(
      preferences,
    );
    await expect(store.findPreferencesByUserId("user_alex")).resolves.toEqual(
      preferences,
    );
    await expect(
      store.claimReminderSlot({
        userId: "user_alex",
        slotId: "morning-checkin",
        localDate: "2026-06-12",
        timezone: "Asia/Jerusalem",
        sentAt: "2026-06-12T06:05:00.000Z",
      }),
    ).resolves.toEqual(preferences);
    await expect(store.listPreferences()).resolves.toEqual([preferences]);
    expect(calls).toEqual([
      {
        method: "upsertPreferences",
        input: preferences,
      },
      {
        method: "findPreferencesByUserId",
        userId: "user_alex",
      },
      {
        method: "claimReminderSlot",
        input: {
          userId: "user_alex",
          slotId: "morning-checkin",
          localDate: "2026-06-12",
          timezone: "Asia/Jerusalem",
          sentAt: "2026-06-12T06:05:00.000Z",
        },
      },
      {
        method: "listPreferences",
      },
    ]);
  });
});
