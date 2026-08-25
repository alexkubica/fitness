import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { resolveTelegramRouteConfig } from "../routes/telegram.js";
import { createAuditService } from "../services/audit.js";
import { createCoachReportService } from "../services/coach-report.js";
import { createInMemoryHealthReadService } from "../services/health-read.js";
import { createInMemoryProfileService } from "../services/profiles.js";
import {
  createInMemoryTelegramBotStorage,
  createTelegramCoachBot,
  type TelegramUpdate,
} from "./bot.js";
import { createTelegramLinkingService } from "./linking.js";
import type { TelegramLlmCoach } from "./llm-coach.js";
import { createInMemoryTelegramReminderPreferenceStore } from "./reminders.js";

const baseNowMs = Date.parse("2026-06-11T12:00:00.000Z");
const baseNowIso = new Date(baseNowMs).toISOString();

function messageUpdate(
  text: string,
  overrides: Partial<{
    updateId: number;
    telegramUserId: number;
    chatId: number;
    chatType: string;
  }> = {},
): TelegramUpdate {
  const telegramUserId = overrides.telegramUserId ?? 12_345;
  const chatId = overrides.chatId ?? telegramUserId;

  return {
    update_id: overrides.updateId ?? 1,
    message: {
      message_id: overrides.updateId ?? 1,
      date: Math.floor(baseNowMs / 1_000),
      from: {
        id: telegramUserId,
        is_bot: false,
        first_name: "Alex",
      },
      chat: {
        id: chatId,
        type: overrides.chatType ?? "private",
      },
      text,
    },
  };
}

function createTelegramHarness() {
  let nowMs = baseNowMs;
  let nextToken = 1;
  const audit = createAuditService({
    now: () => new Date(nowMs),
  });
  const linking = createTelegramLinkingService({
    now: () => new Date(nowMs),
    randomToken: () => `link-token-${nextToken++}`,
    tokenTtlMs: 5 * 60 * 1_000,
  });
  const reminders = createInMemoryTelegramReminderPreferenceStore();
  const bot = createTelegramCoachBot({
    audit,
    linking,
    now: () => new Date(nowMs),
    reminders,
  });

  return {
    audit,
    bot,
    linking,
    reminders,
    setNow(ms: number) {
      nowMs = ms;
    },
  };
}

describe("Telegram link security", () => {
  it("creates short-lived link tokens and binds the Telegram user on consumption", () => {
    const { linking } = createTelegramHarness();

    const linkToken = linking.createLinkToken({
      userId: "user_alex",
      state: "state-1",
      nonce: "nonce-1",
    });
    const consumeResult = linking.consumeLinkToken({
      token: linkToken.token,
      state: "state-1",
      nonce: "nonce-1",
      telegramUserId: 12_345,
    });

    expect(linkToken).toEqual({
      token: "link-token-1",
      userId: "user_alex",
      state: "state-1",
      nonce: "nonce-1",
      expiresAt: new Date(baseNowMs + 5 * 60 * 1_000).toISOString(),
    });
    expect(consumeResult).toMatchObject({
      ok: true,
      account: {
        id: "telegram_account_1",
        userId: "user_alex",
        telegramUserId: 12_345,
        active: true,
      },
    });
    expect(linking.findActiveAccountByTelegramUserId(12_345)).toMatchObject({
      userId: "user_alex",
      telegramUserId: 12_345,
      active: true,
    });
  });

  it("rejects expired, used, mismatched, and cross-account link attempts", () => {
    const { linking, setNow } = createTelegramHarness();

    const expiredToken = linking.createLinkToken({
      userId: "user_alex",
      state: "state-expired",
      nonce: "nonce-expired",
    });
    setNow(baseNowMs + 5 * 60 * 1_000 + 1);

    expect(
      linking.consumeLinkToken({
        token: expiredToken.token,
        state: "state-expired",
        nonce: "nonce-expired",
        telegramUserId: 12_345,
      }),
    ).toEqual({ ok: false, error: "expired" });

    setNow(baseNowMs);
    const linkToken = linking.createLinkToken({
      userId: "user_alex",
      state: "state-1",
      nonce: "nonce-1",
    });

    expect(
      linking.consumeLinkToken({
        token: linkToken.token,
        state: "wrong-state",
        nonce: "nonce-1",
        telegramUserId: 12_345,
      }),
    ).toEqual({ ok: false, error: "state-mismatch" });
    expect(
      linking.consumeLinkToken({
        token: linkToken.token,
        state: "state-1",
        nonce: "wrong-nonce",
        telegramUserId: 12_345,
      }),
    ).toEqual({ ok: false, error: "nonce-mismatch" });

    const firstConsume = linking.consumeLinkToken({
      token: linkToken.token,
      state: "state-1",
      nonce: "nonce-1",
      telegramUserId: 12_345,
    });
    const replayConsume = linking.consumeLinkToken({
      token: linkToken.token,
      state: "state-1",
      nonce: "nonce-1",
      telegramUserId: 12_345,
    });

    expect(firstConsume.ok).toBe(true);
    expect(replayConsume).toEqual({ ok: false, error: "used" });

    const otherUserToken = linking.createLinkToken({
      userId: "user_other",
      state: "state-other",
      nonce: "nonce-other",
    });

    expect(
      linking.consumeLinkToken({
        token: otherUserToken.token,
        state: "state-other",
        nonce: "nonce-other",
        telegramUserId: 12_345,
      }),
    ).toEqual({ ok: false, error: "account-mismatch" });
  });

  it("revokes old links on relink and unlink", async () => {
    const { audit, bot, linking } = createTelegramHarness();
    const firstToken = linking.createLinkToken({
      userId: "user_alex",
      state: "state-1",
      nonce: "nonce-1",
    });
    const secondToken = linking.createLinkToken({
      userId: "user_alex",
      state: "state-2",
      nonce: "nonce-2",
    });

    expect(
      linking.consumeLinkToken({
        token: firstToken.token,
        state: "state-1",
        nonce: "nonce-1",
        telegramUserId: 12_345,
      }).ok,
    ).toBe(true);
    expect(
      linking.consumeLinkToken({
        token: secondToken.token,
        state: "state-2",
        nonce: "nonce-2",
        telegramUserId: 12_345,
      }).ok,
    ).toBe(true);

    const accountsAfterRelink = linking.listAccounts();
    expect(accountsAfterRelink).toHaveLength(2);
    expect(accountsAfterRelink[0]).toMatchObject({
      id: "telegram_account_1",
      active: false,
      revokedAt: baseNowIso,
    });
    expect(accountsAfterRelink[1]).toMatchObject({
      id: "telegram_account_2",
      active: true,
    });
    expect(accountsAfterRelink[1]).not.toHaveProperty("revokedAt");

    const unlinkResponse = await bot.handleUpdate(
      messageUpdate("/unlink", { updateId: 20 }),
    );

    expect(unlinkResponse.messages[0]?.text).toContain("unlinked");
    expect(linking.findActiveAccountByTelegramUserId(12_345)).toBeUndefined();
    expect(audit.list().at(-1)).toMatchObject({
      action: "telegram.account.unlink",
      actor: {
        type: "user",
        id: "user_alex",
      },
      userId: "user_alex",
      target: {
        type: "telegram_account",
        id: "telegram_account_2",
      },
    });
  });
});

describe("Telegram bot commands", () => {
  it("responds to /checkin from an unlinked Telegram user with /link guidance", async () => {
    const { audit, bot } = createTelegramHarness();

    const response = await bot.handleUpdate(messageUpdate("/checkin"));

    expect(response.status).toBe("ok");
    expect(response.messages).toEqual([
      {
        chatId: 12_345,
        text: "I need to link this Telegram account first. Open the authenticated link flow, then tap the Telegram link.",
      },
    ]);
    expect(audit.list()).toEqual([]);
  });

  it("links Telegram accounts from a deep-link /start token", async () => {
    const { audit, bot, linking } = createTelegramHarness();
    const token = linking.createLinkToken({
      userId: "user_alex",
      state: "state-1",
      nonce: "nonce-1",
    });

    const response = await bot.handleUpdate(
      messageUpdate(`/start ${token.token}`),
    );

    expect(response.messages).toEqual([
      {
        chatId: 12_345,
        text: "Telegram account linked.",
      },
    ]);
    expect(JSON.stringify(response)).not.toContain(token.token);
    expect(linking.findActiveAccountByTelegramUserId(12_345)).toMatchObject({
      userId: "user_alex",
      telegramUserId: 12_345,
    });
    expect(audit.list()).toMatchObject([
      {
        action: "telegram.account.link",
        userId: "user_alex",
      },
    ]);
  });

  it("does not answer health commands in Telegram group chats", async () => {
    const { audit, bot, linking } = createTelegramHarness();

    linking.consumeLinkToken({
      ...linking.createLinkToken({
        userId: "user_alex",
        state: "state-1",
        nonce: "nonce-1",
      }),
      telegramUserId: 12_345,
    });

    const response = await bot.handleUpdate(
      messageUpdate("/report", {
        updateId: 29,
        chatId: -100_123,
        chatType: "group",
      }),
    );

    expect(response.messages).toEqual([
      {
        chatId: -100_123,
        text: "Please DM me for Fitness Coach commands so health data stays private.",
      },
    ]);
    expect(audit.list()).toEqual([]);
  });

  it("handles the first-slice command set without leaking secrets", async () => {
    const { bot, linking } = createTelegramHarness();
    const token = linking.createLinkToken({
      userId: "user_alex",
      state: "state-1",
      nonce: "nonce-1",
    });

    const linkResponse = await bot.handleUpdate(
      messageUpdate(`/link ${token.token}`, { updateId: 2 }),
    );
    const startResponse = await bot.handleUpdate(
      messageUpdate("/start", { updateId: 3 }),
    );
    const reportResponse = await bot.handleUpdate(
      messageUpdate("/report", { updateId: 4 }),
    );
    const settingsResponse = await bot.handleUpdate(
      messageUpdate("/settings", { updateId: 5 }),
    );

    expect(linkResponse.messages[0]?.text).toContain("linked");
    expect(startResponse.messages[0]?.text).toContain("/checkin");
    expect(reportResponse.messages[0]?.text).toContain("not ready");
    expect(settingsResponse.messages[0]?.text).toContain("linked");
    expect(JSON.stringify(linkResponse)).not.toContain(token.token);
  });

  it("shows command help before and after account linking", async () => {
    const { bot, linking } = createTelegramHarness();
    const unlinked = await bot.handleUpdate(
      messageUpdate("/help", { updateId: 21 }),
    );
    const token = linking.createLinkToken({
      userId: "user_alex",
      state: "state-1",
      nonce: "nonce-1",
    });

    linking.consumeLinkToken({
      ...token,
      telegramUserId: 12_345,
    });

    const linked = await bot.handleUpdate(
      messageUpdate("/commands", { updateId: 22 }),
    );

    expect(unlinked.messages[0]?.text).toContain("Fitness Coach commands");
    expect(unlinked.messages[0]?.text).toContain(
      "/link - Open the authenticated account-linking flow.",
    );
    expect(unlinked.messages[0]?.text).toContain(
      "Link this Telegram account first",
    );
    expect(linked.messages[0]?.text).toContain(
      "/coach - Ask the coach. Plain text DMs also work after linking.",
    );
    expect(linked.messages[0]?.text).toContain(
      "You can also DM a plain question",
    );
  });

  it("shows command help for unknown slash commands without calling the smart coach", async () => {
    const { audit, linking } = createTelegramHarness();
    const bot = createTelegramCoachBot({
      audit,
      coach: {
        async reply() {
          throw new Error("should not call coach for slash commands");
        },
      },
      linking,
      now: () => new Date(baseNowMs),
    });

    linking.consumeLinkToken({
      ...linking.createLinkToken({
        userId: "user_alex",
        state: "state-1",
        nonce: "nonce-1",
      }),
      telegramUserId: 12_345,
    });

    const response = await bot.handleUpdate(
      messageUpdate("/wat", { updateId: 23 }),
    );

    expect(response.messages[0]?.text).toContain("Unknown command: /wat");
    expect(response.messages[0]?.text).toContain("/help - Show this command");
    expect(audit.list()).toEqual([]);
  });

  it("lets linked users enable and disable reminder settings", async () => {
    const { audit, bot, linking, reminders } = createTelegramHarness();

    linking.consumeLinkToken({
      ...linking.createLinkToken({
        userId: "user_alex",
        state: "state-1",
        nonce: "nonce-1",
      }),
      telegramUserId: 12_345,
    });

    const initial = await bot.handleUpdate(
      messageUpdate("/settings", { updateId: 30 }),
    );
    const enabled = await bot.handleUpdate(
      messageUpdate("/settings remidners on", { updateId: 31 }),
    );
    const disabled = await bot.handleUpdate(
      messageUpdate("/settings reminders off", { updateId: 32 }),
    );

    expect(initial.messages[0]?.text).toContain("Reminders: off");
    expect(enabled.messages[0]?.text).toContain("Reminders: on");
    expect(enabled.messages[0]?.text).toContain("09:00");
    expect(enabled.messages[0]?.text).toContain("20:30");
    expect(disabled.messages[0]?.text).toContain("Reminders: off");
    await expect(
      reminders.findPreferencesByUserId("user_alex"),
    ).resolves.toMatchObject({
      enabled: false,
      timezone: "Asia/Jerusalem",
    });
    expect(
      audit
        .list()
        .filter((event) => event.action === "telegram.reminders.update"),
    ).toHaveLength(2);
    expect(audit.list().at(-1)).toMatchObject({
      action: "telegram.reminders.update",
      userId: "user_alex",
      metadata: {
        enabled: false,
        timezone: "Asia/Jerusalem",
        slotCount: 2,
      },
    });
  });

  it("logs linked check-ins with audit metadata", async () => {
    const { audit, bot, linking } = createTelegramHarness();

    linking.consumeLinkToken({
      ...linking.createLinkToken({
        userId: "user_alex",
        state: "state-1",
        nonce: "nonce-1",
      }),
      telegramUserId: 12_345,
    });

    const response = await bot.handleUpdate(
      messageUpdate(
        "/checkin hunger=6 mood=7 energy=5 stress=4 cravings=2 notes=Long day",
      ),
    );

    expect(response.messages[0]?.text).toBe("Check-in logged.");
    expect(bot.listCheckIns()).toEqual([
      {
        id: "telegram_checkin_1",
        userId: "user_alex",
        telegramUserId: 12_345,
        hunger: 6,
        mood: 7,
        energy: 5,
        stress: 4,
        cravings: 2,
        notes: "Long day",
        createdAt: baseNowIso,
      },
    ]);
    expect(audit.list()).toContainEqual(
      expect.objectContaining({
        action: "telegram.checkin.log",
        actor: {
          type: "user",
          id: "user_alex",
        },
        userId: "user_alex",
        metadata: {
          telegramUserId: 12_345,
          hunger: 6,
          mood: 7,
          energy: 5,
          stress: 4,
          cravings: 2,
        },
      }),
    );
  });

  it("returns a deterministic daily report for linked Telegram users", async () => {
    const audit = createAuditService({
      now: () => new Date(baseNowMs),
    });
    const linking = createTelegramLinkingService({
      now: () => new Date(baseNowMs),
      randomToken: () => "link-token-1",
    });
    const telegramStorage = createInMemoryTelegramBotStorage();
    const reports = createCoachReportService({
      healthRead: createInMemoryHealthReadService([
        {
          userId: "user_alex",
          metricName: "steps",
          unit: "count",
          value: 11_800,
          startTime: "2026-06-11T08:00:00.000Z",
          endTime: "2026-06-11T08:00:00.000Z",
          timezone: "Asia/Jerusalem",
          source: "apple-watch",
          sourceSampleId: "steps-2026-06-11",
        },
        {
          userId: "user_alex",
          metricName: "sleep",
          unit: "minute",
          value: 360,
          startTime: "2026-06-11T04:00:00.000Z",
          endTime: "2026-06-11T04:00:00.000Z",
          timezone: "Asia/Jerusalem",
          source: "apple-watch",
          sourceSampleId: "sleep-2026-06-11",
        },
      ]),
      telegramStorage,
      now: () => new Date(baseNowMs),
    });
    const bot = createTelegramCoachBot({
      audit,
      linking,
      now: () => new Date(baseNowMs),
      reports,
      storage: telegramStorage,
    });

    linking.consumeLinkToken({
      ...linking.createLinkToken({
        userId: "user_alex",
        state: "state-1",
        nonce: "nonce-1",
      }),
      telegramUserId: 12_345,
    });

    const response = await bot.handleUpdate(
      messageUpdate("/report", { updateId: 60 }),
    );

    expect(response.messages[0]?.text).toContain("Daily coach report");
    expect(response.messages[0]?.text).toContain("Steps: 11,800");
    expect(response.messages[0]?.text).toContain(
      "Sleep is the main recovery gap",
    );
    expect(response.messages[0]?.text).toContain("not a medical diagnosis");
  });

  it("answers linked /coach messages through the configured smart coach", async () => {
    const { audit, linking } = createTelegramHarness();
    const coachCalls: Parameters<TelegramLlmCoach["reply"]>[0][] = [];
    const coach: TelegramLlmCoach = {
      async reply(input) {
        coachCalls.push(input);

        return {
          text: "Keep dinner simple: protein, vegetables, and a normal carb portion.",
          provider: "openrouter",
          model: "openrouter/free",
        };
      },
    };
    const bot = createTelegramCoachBot({
      audit,
      coach,
      linking,
      now: () => new Date(baseNowMs),
    });

    linking.consumeLinkToken({
      ...linking.createLinkToken({
        userId: "user_alex",
        state: "state-1",
        nonce: "nonce-1",
      }),
      telegramUserId: 12_345,
    });

    const response = await bot.handleUpdate(
      messageUpdate("/coach should I eat pizza tonight?", { updateId: 70 }),
    );

    expect(response.messages).toEqual([
      {
        chatId: 12_345,
        text: "Keep dinner simple: protein, vegetables, and a normal carb portion.",
      },
    ]);
    expect(coachCalls).toHaveLength(1);
    expect(coachCalls[0]).toMatchObject({
      userId: "user_alex",
      telegramUserId: 12_345,
      messageText: "should I eat pizza tonight?",
    });
    expect(audit.list().at(-1)).toMatchObject({
      action: "telegram.coach.reply",
      userId: "user_alex",
      metadata: {
        telegramUserId: 12_345,
        provider: "openrouter",
        model: "openrouter/free",
        messageLength: 27,
        replyLength: 67,
        hasReportContext: false,
      },
    });
    expect(JSON.stringify(audit.list())).not.toContain("pizza");
  });

  it("routes linked free text to smart coach chat when configured", async () => {
    const { audit, linking } = createTelegramHarness();
    const coach: TelegramLlmCoach = {
      async reply(input) {
        return {
          text: `Coach saw: ${input.messageText}`,
          provider: "openrouter",
          model: "openrouter/free",
        };
      },
    };
    const bot = createTelegramCoachBot({
      audit,
      coach,
      linking,
      now: () => new Date(baseNowMs),
    });

    linking.consumeLinkToken({
      ...linking.createLinkToken({
        userId: "user_alex",
        state: "state-1",
        nonce: "nonce-1",
      }),
      telegramUserId: 12_345,
    });

    const response = await bot.handleUpdate(
      messageUpdate("what should I eat before training?", { updateId: 71 }),
    );

    expect(response.messages[0]?.text).toBe(
      "Coach saw: what should I eat before training?",
    );
  });

  it("does not call smart coach for unlinked Telegram users", async () => {
    const { audit, linking } = createTelegramHarness();
    const coach: TelegramLlmCoach = {
      async reply() {
        throw new Error("should not call coach");
      },
    };
    const bot = createTelegramCoachBot({
      audit,
      coach,
      linking,
      linkUrl: "https://fitness.example/telegram/link",
    });

    const response = await bot.handleUpdate(
      messageUpdate("what should I eat?", { updateId: 72 }),
    );

    expect(response.messages[0]?.text).toContain(
      "https://fitness.example/telegram/link",
    );
    expect(audit.list()).toEqual([]);
  });

  it("falls back when smart coach provider fails without leaking prompt text", async () => {
    const { audit, linking } = createTelegramHarness();
    const coach: TelegramLlmCoach = {
      async reply() {
        throw new Error("provider unavailable");
      },
    };
    const bot = createTelegramCoachBot({
      audit,
      coach,
      linking,
      now: () => new Date(baseNowMs),
    });

    linking.consumeLinkToken({
      ...linking.createLinkToken({
        userId: "user_alex",
        state: "state-1",
        nonce: "nonce-1",
      }),
      telegramUserId: 12_345,
    });

    const response = await bot.handleUpdate(
      messageUpdate("/coach I binged on ice cream", { updateId: 73 }),
    );

    expect(response.messages[0]?.text).toContain("temporarily unavailable");
    expect(audit.list().at(-1)).toMatchObject({
      action: "telegram.coach.error",
      userId: "user_alex",
      metadata: {
        telegramUserId: 12_345,
        messageLength: 21,
        hasReportContext: false,
      },
    });
    expect(JSON.stringify(audit.list())).not.toContain("ice cream");
  });

  it("awaits async account lookup before logging check-ins", async () => {
    const audit = createAuditService({
      now: () => new Date(baseNowMs),
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
            id: "telegram_account_db_1",
            userId: "user_alex",
            telegramUserId: 12_345,
            linkedAt: baseNowIso,
            active: true,
          };
        },
        async unlinkTelegramUser() {
          throw new Error("not used");
        },
      },
      now: () => new Date(baseNowMs),
    });

    const response = await bot.handleUpdate(
      messageUpdate(
        "/checkin hunger=6 mood=7 energy=5 stress=4 cravings=2 notes=Async repo",
      ),
    );

    expect(response.messages[0]?.text).toBe("Check-in logged.");
    expect((await bot.listCheckIns())[0]?.userId).toBe("user_alex");
    expect(audit.list()[0]?.userId).toBe("user_alex");
  });

  it("logs linked meal text and deduplicates repeated Telegram updates", async () => {
    const { audit, bot, linking } = createTelegramHarness();

    linking.consumeLinkToken({
      ...linking.createLinkToken({
        userId: "user_alex",
        state: "state-1",
        nonce: "nonce-1",
      }),
      telegramUserId: 12_345,
    });

    const update = messageUpdate("/log Greek yogurt and berries", {
      updateId: 50,
    });
    const firstResponse = await bot.handleUpdate(update);
    const duplicateResponse = await bot.handleUpdate(update);

    expect(firstResponse.messages[0]?.text).toBe("Meal note logged.");
    expect(duplicateResponse).toEqual({
      status: "duplicate",
      updateId: 50,
      messages: [],
    });
    expect(bot.listMealLogs()).toEqual([
      {
        id: "telegram_meal_1",
        userId: "user_alex",
        telegramUserId: 12_345,
        text: "Greek yogurt and berries",
        createdAt: baseNowIso,
      },
    ]);
    expect(
      audit.list().filter((event) => event.action === "telegram.meal.log"),
    ).toHaveLength(1);
  });

  it("resolves linked Telegram commands to the actor self profile", async () => {
    const audit = createAuditService({
      now: () => new Date(baseNowMs),
    });
    const linking = createTelegramLinkingService({
      now: () => new Date(baseNowMs),
      randomToken: () => "link-token-1",
    });
    const profiles = createInMemoryProfileService({
      now: () => new Date(baseNowMs),
    });
    const storage = createInMemoryTelegramBotStorage();
    const reportInputs: Parameters<
      NonNullable<
        Parameters<typeof createTelegramCoachBot>[0]["reports"]
      >["generateDailyReport"]
    >[0][] = [];
    const bot = createTelegramCoachBot({
      audit,
      linking,
      now: () => new Date(baseNowMs),
      profiles,
      reports: {
        async generateDailyReport(input) {
          reportInputs.push(input);

          return {
            report: {
              generatedAt: baseNowIso,
              range: input.range,
              metrics: {},
              checkIns: { count: 0 },
              meals: { count: 0, hasMacroEstimates: false },
              highlights: [],
              guidance: [],
              dataQuality: [],
              safetyNote: "Behavioral guidance only.",
              targetPeriods: [],
              targetChanges: [],
            },
            text: "Self-profile report.",
          };
        },
      },
      storage,
    });

    linking.consumeLinkToken({
      ...linking.createLinkToken({
        userId: "user_alex",
        state: "state-1",
        nonce: "nonce-1",
      }),
      telegramUserId: 12_345,
    });
    await profiles.createManagedProfile("user_alex", {
      displayName: "Dependent",
      timezone: "UTC",
    });

    await bot.handleUpdate(
      messageUpdate("/checkin hunger=6 mood=7 energy=5 stress=4 cravings=2", {
        updateId: 90,
      }),
    );
    await bot.handleUpdate(
      messageUpdate("/log Greek yogurt", { updateId: 91 }),
    );
    const report = await bot.handleUpdate(
      messageUpdate("/report", { updateId: 92 }),
    );

    expect((await bot.listCheckIns())[0]?.profileId).toBe(
      "profile_self_user_alex",
    );
    expect((await bot.listMealLogs())[0]?.profileId).toBe(
      "profile_self_user_alex",
    );
    expect(reportInputs).toMatchObject([
      {
        userId: "user_alex",
        profileId: "profile_self_user_alex",
      },
    ]);
    expect(report.messages[0]?.text).toBe("Self-profile report.");
    expect(
      audit
        .list()
        .filter((event) =>
          ["telegram.checkin.log", "telegram.meal.log"].includes(event.action),
        ),
    ).toMatchObject([
      { profileId: "profile_self_user_alex" },
      { profileId: "profile_self_user_alex" },
    ]);
  });
});

describe("Telegram webhook route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads deployment secrets from environment variables", () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN", "telegram-secret");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token");
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "fitness_coach_bot");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "fitness-coach.vercel.app");

    expect(resolveTelegramRouteConfig()).toMatchObject({
      botToken: "bot-token",
      botUsername: "fitness_coach_bot",
      linkUrl: "https://fitness-coach.vercel.app/telegram/link",
      webhookSecretToken: "telegram-secret",
    });
  });

  it("resolves optional Telegram smart coach config from environment variables", () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN", "telegram-secret");
    vi.stubEnv("TELEGRAM_COACH_LLM_ENABLED", "1");
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
    vi.stubEnv("OPENROUTER_MODEL", "openrouter/free");

    expect(resolveTelegramRouteConfig()).toMatchObject({
      coach: expect.any(Object),
      webhookSecretToken: "telegram-secret",
    });
  });

  it("validates X-Telegram-Bot-Api-Secret-Token before handling updates", async () => {
    const { audit, linking } = createTelegramHarness();
    const app = createApp({
      telegram: {
        webhookSecretToken: "telegram-secret",
      },
      services: {
        audit,
        telegramLinking: linking,
      },
    });

    const missingSecret = await app.request("/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(messageUpdate("/checkin")),
    });
    const wrongSecret = await app.request("/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "wrong-secret",
      },
      body: JSON.stringify(messageUpdate("/checkin")),
    });
    const accepted = await app.request("/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "telegram-secret",
      },
      body: JSON.stringify(messageUpdate("/checkin")),
    });

    expect(missingSecret.status).toBe(401);
    expect(wrongSecret.status).toBe(401);
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toMatchObject({
      status: "ok",
      messages: [
        {
          chatId: 12_345,
          text: expect.stringContaining("tap the Telegram link"),
        },
      ],
    });
  });

  it("does not fail the webhook after claiming an update when outbound delivery fails", async () => {
    const { audit, linking } = createTelegramHarness();
    const app = createApp({
      telegram: {
        webhookSecretToken: "telegram-secret",
        messenger: {
          async sendMessage() {
            throw new Error("telegram rejected chat");
          },
        },
      },
      services: {
        audit,
        telegramLinking: linking,
      },
    });

    const response = await app.request("/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "telegram-secret",
      },
      body: JSON.stringify(messageUpdate("/start")),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      updateId: 1,
      messages: [
        {
          chatId: 12_345,
          text: expect.stringContaining("/link"),
        },
      ],
      outbound: {
        failed: 1,
      },
    });
  });
});
