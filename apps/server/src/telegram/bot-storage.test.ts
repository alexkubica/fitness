import { describe, expect, it } from "vitest";
import { createAuditService } from "../services/audit.js";
import {
  createRepositoryTelegramBotStorage,
  createTelegramCoachBot,
  type TelegramUpdate,
} from "./bot.js";

const nowIso = "2026-06-11T12:00:00.000Z";

const update: TelegramUpdate = {
  update_id: 50,
  message: {
    message_id: 50,
    date: 1_812_797_600,
    from: {
      id: 12_345,
      is_bot: false,
      first_name: "Alex",
    },
    chat: {
      id: 12_345,
      type: "private",
    },
    text: "/checkin hunger=6 mood=7 energy=5 stress=4 cravings=2 notes=Stored",
  },
};

describe("Telegram bot storage", () => {
  it("claims updates and writes check-ins through an async repository", async () => {
    const calls: unknown[] = [];
    const storage = createRepositoryTelegramBotStorage({
      async claimUpdate(input) {
        calls.push({ method: "claimUpdate", input });
        return true;
      },
      async createCheckIn(input) {
        calls.push({ method: "createCheckIn", input });
        return {
          id: "db-checkin-1",
          userId: input.userId,
          telegramUserId: input.telegramUserId,
          hunger: input.hunger,
          mood: input.mood,
          energy: input.energy,
          stress: input.stress,
          cravings: input.cravings,
          notes: input.notes,
          createdAt: input.checkedInAt,
        };
      },
      async createMealLog() {
        throw new Error("not used");
      },
      async listCheckIns() {
        throw new Error("not used");
      },
      async listMealLogs() {
        throw new Error("not used");
      },
    });
    const audit = createAuditService({
      now: () => new Date(nowIso),
    });
    const bot = createTelegramCoachBot({
      audit,
      linking: {
        async createLinkToken() {
          throw new Error("not used");
        },
        async consumeLinkToken() {
          throw new Error("not used");
        },
        async consumeOpaqueLinkToken() {
          throw new Error("not used");
        },
        async findActiveAccountByTelegramUserId() {
          return {
            id: "telegram-account-1",
            userId: "user_alex",
            telegramUserId: 12_345,
            linkedAt: nowIso,
            active: true,
          };
        },
        async unlinkTelegramUser() {
          throw new Error("not used");
        },
      },
      now: () => new Date(nowIso),
      storage,
    });

    const response = await bot.handleUpdate(update);

    expect(response.messages[0]?.text).toBe("Check-in logged.");
    expect(calls).toEqual([
      {
        method: "claimUpdate",
        input: {
          updateId: 50,
          telegramUserId: 12_345,
          telegramChatId: 12_345,
          receivedAt: nowIso,
        },
      },
      {
        method: "createCheckIn",
        input: {
          idempotencyKey: "telegram-update-50-checkin",
          userId: "user_alex",
          telegramUserId: 12_345,
          checkedInAt: nowIso,
          timezone: "UTC",
          hunger: 6,
          mood: 7,
          energy: 5,
          stress: 4,
          cravings: 2,
          notes: "Stored",
        },
      },
    ]);
    expect(audit.list()[0]).toMatchObject({
      target: {
        type: "telegram_checkin",
        id: "db-checkin-1",
      },
    });
  });

  it("reads repository check-ins and meal logs for reports", async () => {
    const storage = createRepositoryTelegramBotStorage({
      async claimUpdate() {
        throw new Error("not used");
      },
      async createCheckIn() {
        throw new Error("not used");
      },
      async createMealLog() {
        throw new Error("not used");
      },
      async listCheckIns(input) {
        return [
          {
            id: "db-checkin-1",
            userId: input.userId,
            telegramUserId: 12_345,
            hunger: 6,
            mood: 7,
            energy: 5,
            stress: 4,
            cravings: 2,
            notes: "Stored",
            createdAt: input.range.from,
          },
        ];
      },
      async listMealLogs(input) {
        return [
          {
            id: "db-meal-1",
            userId: input.userId,
            telegramUserId: 12_345,
            text: "Greek yogurt",
            createdAt: input.range.from,
          },
        ];
      },
    });
    const range = {
      from: "2026-06-11T00:00:00.000Z",
      to: "2026-06-12T00:00:00.000Z",
    };

    await expect(
      storage.listCheckIns({
        userId: "user_alex",
        range,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "db-checkin-1",
        userId: "user_alex",
      }),
    ]);
    await expect(
      storage.listMealLogs({
        userId: "user_alex",
        range,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "db-meal-1",
        userId: "user_alex",
      }),
    ]);
  });
});
