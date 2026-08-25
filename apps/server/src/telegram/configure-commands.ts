import { execFileSync } from "node:child_process";
import { Bot } from "grammy";
import { telegramBotCommandMenu } from "./commands.js";

export type TelegramCommandMenuClient = Readonly<{
  setMyCommands(
    commands: readonly { command: string; description: string }[],
  ): Promise<unknown>;
}>;

export type TelegramCommandMenuSyncOptions = Readonly<{
  botToken?: string;
  client?: TelegramCommandMenuClient;
  stderr?: (chunk: string) => void;
  stdout?: (chunk: string) => void;
}>;

export type TelegramCommandMenuSyncResult = Readonly<{
  exitCode: number;
}>;

const telegramBotTokenKeychainService = "fitness-telegram-bot-token";

export async function syncTelegramCommandMenu(
  options: TelegramCommandMenuSyncOptions = {},
): Promise<TelegramCommandMenuSyncResult> {
  const stdout = options.stdout ?? ((chunk) => process.stdout.write(chunk));
  const stderr = options.stderr ?? ((chunk) => process.stderr.write(chunk));

  try {
    const client =
      options.client ?? telegramCommandMenuClient(options.botToken);

    await client.setMyCommands(telegramBotCommandMenu);
    stdout(
      `Updated Telegram command menu with ${telegramBotCommandMenu.length} commands.\n`,
    );

    return { exitCode: 0 };
  } catch (error) {
    stderr(`${errorMessage(error)}\n`);

    return { exitCode: 1 };
  }
}

function telegramCommandMenuClient(
  botToken: string | undefined,
): TelegramCommandMenuClient {
  const token =
    botToken ??
    envString("TELEGRAM_BOT_TOKEN") ??
    readKeychainGenericPassword(telegramBotTokenKeychainService);

  if (token === undefined) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN or Keychain fitness-telegram-bot-token is required to configure Telegram commands.",
    );
  }

  const bot = new Bot(token);

  return {
    setMyCommands(commands) {
      return bot.api.setMyCommands([...commands]);
    },
  };
}

function readKeychainGenericPassword(service: string): string | undefined {
  try {
    const value = execFileSync(
      "security",
      ["find-generic-password", "-w", "-s", service],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();

    return value.length === 0 ? undefined : value;
  } catch {
    return undefined;
  }
}

function envString(name: string): string | undefined {
  const value = (
    globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env?.[name];

  return value === undefined || value.length === 0 ? undefined : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Telegram command menu configuration failed.";
}

function isMainModule(): boolean {
  return import.meta.url === new URL(process.argv[1] ?? "", "file:").href;
}

if (isMainModule()) {
  const result = await syncTelegramCommandMenu();

  process.exitCode = result.exitCode;
}
