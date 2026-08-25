import { timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import type { ServerEnv } from "../auth.js";
import type { AuditPort } from "../services/audit.js";
import type { AuthorizationService } from "../services/authorization.js";
import type { CoachReportPort } from "../services/coach-report.js";
import type { ProfileService } from "../services/profiles.js";
import {
  createGrammyTelegramMessenger,
  createTelegramCoachBot,
  type TelegramBotStorage,
  type TelegramMessenger,
  type TelegramUpdate,
} from "../telegram/bot.js";
import type { AsyncTelegramLinkingService } from "../telegram/linking.js";
import {
  resolveTelegramLlmCoach,
  type TelegramLlmCoach,
} from "../telegram/llm-coach.js";
import type { TelegramReminderPreferenceStore } from "../telegram/reminders.js";

export type TelegramRouteServices = Readonly<{
  audit: AuditPort;
  authorization: AuthorizationService;
  profiles: ProfileService;
  reports: CoachReportPort;
  telegramLinking: AsyncTelegramLinkingService;
  telegramReminders: TelegramReminderPreferenceStore;
  telegramStorage: TelegramBotStorage;
}>;

export type TelegramRouteConfig = Readonly<{
  webhookSecretToken: string;
  botToken?: string;
  botUsername?: string;
  coach?: TelegramLlmCoach;
  linkUrl?: string;
  messenger?: TelegramMessenger;
}>;

export function resolveTelegramRouteConfig(
  config: Partial<TelegramRouteConfig> = {},
): TelegramRouteConfig {
  const webhookSecretToken =
    config.webhookSecretToken ?? envValue("TELEGRAM_WEBHOOK_SECRET_TOKEN");

  if (webhookSecretToken === undefined) {
    if (envValue("NODE_ENV") === "production") {
      throw new Error(
        "TELEGRAM_WEBHOOK_SECRET_TOKEN is required in production.",
      );
    }

    return {
      webhookSecretToken: "dev-telegram-webhook-secret",
      ...optionalTelegramRouteConfig(config),
    };
  }

  return {
    webhookSecretToken,
    ...optionalTelegramRouteConfig(config),
  };
}

export function registerTelegramRoutes(
  app: Hono<ServerEnv>,
  services: TelegramRouteServices,
  config: TelegramRouteConfig,
): void {
  const bot = createTelegramCoachBot({
    audit: services.audit,
    authorization: services.authorization,
    ...(config.coach === undefined ? {} : { coach: config.coach }),
    linkUrl: config.linkUrl,
    linking: services.telegramLinking,
    profiles: services.profiles,
    reminders: services.telegramReminders,
    reports: services.reports,
    storage: services.telegramStorage,
  });
  const messenger =
    config.messenger ??
    (config.botToken === undefined
      ? undefined
      : createGrammyTelegramMessenger(config.botToken));

  app.post("/telegram/webhook", async (context) => {
    const secret = context.req.header("x-telegram-bot-api-secret-token");

    if (!secretMatches(secret, config.webhookSecretToken)) {
      return context.json({ error: "unauthorized" }, 401);
    }

    let update: TelegramUpdate;

    try {
      update = (await context.req.json()) as TelegramUpdate;
    } catch {
      return context.json({ error: "invalid-json" }, 400);
    }

    const response = await bot.handleUpdate(update);

    if (messenger === undefined) {
      return context.json(response);
    }

    const outbound = await sendOutboundMessages(messenger, response.messages);

    return context.json({
      ...response,
      ...(outbound.failed === 0 ? {} : { outbound }),
    });
  });
}

async function sendOutboundMessages(
  messenger: TelegramMessenger,
  messages: readonly { chatId: number; text: string }[],
): Promise<{ sent: number; failed: number }> {
  const results = await Promise.allSettled(
    messages.map((message) =>
      messenger.sendMessage(message.chatId, message.text),
    ),
  );

  return {
    sent: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
  };
}

function secretMatches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) {
    return false;
  }

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.byteLength !== expectedBuffer.byteLength) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function envValue(name: string): string | undefined {
  const globalWithProcess = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return globalWithProcess.process?.env?.[name];
}

function optionalTelegramRouteConfig(
  config: Partial<TelegramRouteConfig>,
): Partial<TelegramRouteConfig> {
  const botToken = config.botToken ?? envValue("TELEGRAM_BOT_TOKEN");
  const botUsername = config.botUsername ?? envValue("TELEGRAM_BOT_USERNAME");
  const coach = config.coach ?? resolveTelegramLlmCoach();
  const linkUrl =
    config.linkUrl ??
    envValue("TELEGRAM_LINK_URL") ??
    telegramLinkUrlFromExternalOrigin(externalOriginFromEnv());

  return {
    ...(botToken === undefined ? {} : { botToken }),
    ...(botUsername === undefined ? {} : { botUsername }),
    ...(coach === undefined ? {} : { coach }),
    ...(linkUrl === undefined ? {} : { linkUrl }),
    ...(config.messenger === undefined ? {} : { messenger: config.messenger }),
  };
}

function telegramLinkUrlFromExternalOrigin(
  externalOrigin: string | undefined,
): string | undefined {
  if (externalOrigin === undefined) {
    return undefined;
  }

  return new URL("/telegram/link", externalOrigin).toString();
}

function externalOriginFromEnv(): string | undefined {
  return (
    originFromUrl(envValue("FITNESS_EXTERNAL_URL")) ??
    originFromUrl(envValue("RENDER_EXTERNAL_URL")) ??
    originFromVercelDomain(envValue("VERCEL_PROJECT_PRODUCTION_URL")) ??
    originFromVercelDomain(envValue("VERCEL_BRANCH_URL")) ??
    originFromVercelDomain(envValue("VERCEL_URL"))
  );
}

function originFromUrl(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function originFromVercelDomain(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return originFromUrl(value.includes("://") ? value : `https://${value}`);
}
