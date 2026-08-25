import { timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import type { ServerEnv } from "../auth.js";
import type { AuditPort } from "../services/audit.js";
import {
  createGrammyTelegramMessenger,
  type TelegramMessenger,
} from "../telegram/bot.js";
import {
  runDueTelegramReminders,
  type TelegramReminderPreferenceStore,
} from "../telegram/reminders.js";

export type TelegramReminderJobRouteServices = Readonly<{
  audit: AuditPort;
  telegramReminders: TelegramReminderPreferenceStore;
}>;

export type TelegramReminderJobRouteConfig = Readonly<{
  botToken?: string;
  jobSecret?: string;
  messenger?: TelegramMessenger;
}>;

export type TelegramReminderJobRouteEnvironment = Readonly<
  Record<string, string | undefined>
>;

export function resolveTelegramReminderJobRouteConfig(
  config: Partial<TelegramReminderJobRouteConfig> = {},
  env: TelegramReminderJobRouteEnvironment = envRecord(),
): TelegramReminderJobRouteConfig {
  const botToken = config.botToken ?? envString(env, "TELEGRAM_BOT_TOKEN");
  const jobSecret =
    config.jobSecret ?? envString(env, "TELEGRAM_REMINDER_JOB_SECRET");

  return {
    ...(botToken === undefined ? {} : { botToken }),
    ...(jobSecret === undefined ? {} : { jobSecret }),
    ...(config.messenger === undefined ? {} : { messenger: config.messenger }),
  };
}

export function registerTelegramReminderJobRoutes(
  app: Hono<ServerEnv>,
  services: TelegramReminderJobRouteServices,
  config: TelegramReminderJobRouteConfig,
): void {
  const jobSecret = config.jobSecret;

  if (jobSecret === undefined) {
    return;
  }

  let inFlight = false;

  app.post("/internal/jobs/telegram-reminders/run", async (context) => {
    const authorization = context.req.header("authorization");

    if (!bearerSecretMatches(authorization, jobSecret)) {
      return context.json({ error: "unauthorized" }, 401);
    }

    const messenger = resolveMessenger(config);

    if (messenger === undefined) {
      return context.json({ error: "telegram-bot-token-unavailable" }, 503);
    }

    if (inFlight) {
      return context.json({ error: "reminder-job-already-running" }, 409);
    }

    inFlight = true;

    try {
      const result = await runDueTelegramReminders({
        audit: services.audit,
        messenger,
        reminders: services.telegramReminders,
      });
      const status = result.failed === 0 ? 200 : 502;

      return context.json({ status: "ok", result }, status);
    } catch {
      return context.json({ error: "reminder-job-failed" }, 500);
    } finally {
      inFlight = false;
    }
  });
}

function resolveMessenger(
  config: TelegramReminderJobRouteConfig,
): TelegramMessenger | undefined {
  if (config.messenger !== undefined) {
    return config.messenger;
  }

  return config.botToken === undefined
    ? undefined
    : createGrammyTelegramMessenger(config.botToken);
}

function bearerSecretMatches(
  authorization: string | undefined,
  expected: string,
): boolean {
  const prefix = "Bearer ";

  if (authorization === undefined || !authorization.startsWith(prefix)) {
    return false;
  }

  return secretMatches(authorization.slice(prefix.length), expected);
}

function secretMatches(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.byteLength !== expectedBuffer.byteLength) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function envString(
  env: TelegramReminderJobRouteEnvironment,
  name: string,
): string | undefined {
  const value = env[name];

  return value === undefined || value.length === 0 ? undefined : value;
}

function envRecord(): TelegramReminderJobRouteEnvironment {
  const globalWithProcess = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return globalWithProcess.process?.env ?? {};
}
