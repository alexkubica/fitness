import { createPersistenceServices } from "../persistence.js";
import { createAuditService, type AuditPort } from "../services/audit.js";
import {
  createGrammyTelegramMessenger,
  type TelegramMessenger,
} from "./bot.js";
import {
  createInMemoryTelegramReminderPreferenceStore,
  runDueTelegramReminders,
  type TelegramReminderPreferenceStore,
} from "./reminders.js";

export type TelegramReminderJobEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type TelegramReminderJobServices = Readonly<{
  audit: AuditPort;
  telegramReminders: TelegramReminderPreferenceStore;
}>;

export type TelegramReminderJobOptions = Readonly<{
  env?: TelegramReminderJobEnvironment;
  messenger?: TelegramMessenger;
  now?: () => Date;
  services?: TelegramReminderJobServices;
  stderr?: (chunk: string) => void;
  stdout?: (chunk: string) => void;
}>;

export type TelegramReminderJobResult = Readonly<{
  exitCode: number;
}>;

export async function runTelegramReminderJob(
  options: TelegramReminderJobOptions = {},
): Promise<TelegramReminderJobResult> {
  const stdout = options.stdout ?? ((chunk) => process.stdout.write(chunk));
  const stderr = options.stderr ?? ((chunk) => process.stderr.write(chunk));
  const env = options.env ?? envRecord();

  try {
    const services = resolveReminderJobServices(options.services, env);
    const result = await runDueTelegramReminders({
      audit: services.audit,
      messenger: options.messenger ?? messengerFromEnv(env),
      ...(options.now === undefined ? {} : { now: options.now }),
      reminders: services.telegramReminders,
    });

    stdout(`${JSON.stringify(result, null, 2)}\n`);
    return { exitCode: 0 };
  } catch (error) {
    stderr(`${errorMessage(error)}\n`);
    return { exitCode: 1 };
  }
}

function resolveReminderJobServices(
  services: TelegramReminderJobServices | undefined,
  env: TelegramReminderJobEnvironment,
): TelegramReminderJobServices {
  if (services !== undefined) {
    return services;
  }

  const persistenceServices = createPersistenceServices(env);

  return {
    audit: persistenceServices.audit ?? createAuditService(),
    telegramReminders:
      persistenceServices.telegramReminders ??
      createInMemoryTelegramReminderPreferenceStore(),
  };
}

function messengerFromEnv(
  env: TelegramReminderJobEnvironment,
): TelegramMessenger {
  const botToken = envString(env, "TELEGRAM_BOT_TOKEN");

  if (botToken === undefined) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is required to run Telegram reminder delivery.",
    );
  }

  return createGrammyTelegramMessenger(botToken);
}

function envString(
  env: TelegramReminderJobEnvironment,
  name: string,
): string | undefined {
  const value = env[name];

  return value === undefined || value.length === 0 ? undefined : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Telegram reminder job failed.";
}

function envRecord(): TelegramReminderJobEnvironment {
  const globalWithProcess = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return globalWithProcess.process?.env ?? {};
}

function isMainModule(): boolean {
  return import.meta.url === new URL(process.argv[1] ?? "", "file:").href;
}

if (isMainModule()) {
  const result = await runTelegramReminderJob();

  process.exitCode = result.exitCode;
}
