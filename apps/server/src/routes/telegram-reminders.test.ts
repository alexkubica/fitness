import { describe, expect, it } from "vitest";
import { createAuditService } from "../services/audit.js";
import { createInMemoryTelegramReminderPreferenceStore } from "../telegram/reminders.js";
import {
  registerTelegramReminderJobRoutes,
  resolveTelegramReminderJobRouteConfig,
} from "./telegram-reminders.js";
import { Hono } from "hono";
import type { ServerEnv } from "../auth.js";

const jobSecret = "test-reminder-job-secret";

describe("Telegram reminder job routes", () => {
  it("does not register the hosted job endpoint without a configured secret", async () => {
    const app = new Hono<ServerEnv>();

    registerTelegramReminderJobRoutes(
      app,
      {
        audit: createAuditService(),
        telegramReminders: createInMemoryTelegramReminderPreferenceStore(),
      },
      {},
    );

    const response = await postReminderJob(app, {
      authorization: `Bearer ${jobSecret}`,
    });

    expect(response.status).toBe(404);
  });

  it("rejects unauthorized hosted job requests", async () => {
    const app = createReminderJobApp();

    const response = await postReminderJob(app);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "unauthorized",
    });
  });

  it("runs due reminders for authorized hosted job requests", async () => {
    const audit = createAuditService();
    const telegramReminders = createInMemoryTelegramReminderPreferenceStore();
    const sentMessages: { chatId: number; text: string }[] = [];
    const app = createReminderJobApp({
      audit,
      telegramReminders,
      messenger: {
        async sendMessage(chatId, text) {
          sentMessages.push({ chatId, text });
        },
      },
    });

    const response = await postReminderJob(app, {
      authorization: `Bearer ${jobSecret}`,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      result: {
        planned: 0,
        sent: 0,
        failed: 0,
        failures: [],
      },
    });
    expect(sentMessages).toEqual([]);
    expect(audit.list()).toEqual([]);
  });

  it("serializes concurrent hosted job requests in one server process", async () => {
    const app = createReminderJobApp({
      messenger: {
        sendMessage() {
          return new Promise(() => undefined);
        },
      },
    });

    void postReminderJob(app, {
      authorization: `Bearer ${jobSecret}`,
    });
    const response = await postReminderJob(app, {
      authorization: `Bearer ${jobSecret}`,
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "reminder-job-already-running",
    });
  });

  it("resolves deploy-time configuration from env names", () => {
    expect(
      resolveTelegramReminderJobRouteConfig(
        {},
        {
          TELEGRAM_BOT_TOKEN: "bot-token",
          TELEGRAM_REMINDER_JOB_SECRET: "job-secret",
        },
      ),
    ).toMatchObject({
      botToken: "bot-token",
      jobSecret: "job-secret",
    });
  });
});

function createReminderJobApp(
  options: Partial<{
    audit: ReturnType<typeof createAuditService>;
    messenger: {
      sendMessage(chatId: number, text: string): Promise<void>;
    };
    telegramReminders: ReturnType<
      typeof createInMemoryTelegramReminderPreferenceStore
    >;
  }> = {},
) {
  const app = new Hono<ServerEnv>();

  registerTelegramReminderJobRoutes(
    app,
    {
      audit: options.audit ?? createAuditService(),
      telegramReminders:
        options.telegramReminders ??
        createInMemoryTelegramReminderPreferenceStore(),
    },
    {
      jobSecret,
      messenger:
        options.messenger ??
        ({
          async sendMessage() {
            return undefined;
          },
        } satisfies {
          sendMessage(chatId: number, text: string): Promise<void>;
        }),
    },
  );

  return app;
}

function postReminderJob(
  app: Hono<ServerEnv>,
  options: { authorization?: string } = {},
) {
  const init: RequestInit =
    options.authorization === undefined
      ? { method: "POST" }
      : {
          method: "POST",
          headers: {
            authorization: options.authorization,
          },
        };

  return app.request("/internal/jobs/telegram-reminders/run", init);
}
