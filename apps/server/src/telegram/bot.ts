import { Bot } from "grammy";
import type { NeonTelegramCoachRepository } from "@fitness/db";
import type { AuditPort } from "../services/audit.js";
import {
  AuthorizationError,
  type AuthorizationService,
} from "../services/authorization.js";
import type { ProfilePermission } from "@fitness/auth";
import type { ProfileService } from "../services/profiles.js";
import {
  lastTwentyFourHoursRange,
  type CoachReportPort,
} from "../services/coach-report.js";
import type {
  AsyncTelegramLinkingService,
  TelegramAccount,
  TelegramLinkConsumeResult,
} from "./linking.js";
import {
  defaultTelegramReminderPreferences,
  type TelegramReminderPreferenceStore,
} from "./reminders.js";
import type { TelegramLlmCoach } from "./llm-coach.js";
import { formatTelegramCommandHelp } from "./commands.js";

export type TelegramUpdate = Readonly<{
  update_id: number;
  message?: TelegramMessage;
}>;

export type TelegramMessage = Readonly<{
  message_id: number;
  date: number;
  from?: Readonly<{
    id: number;
    is_bot: boolean;
    first_name?: string;
  }>;
  chat: Readonly<{
    id: number;
    type: string;
  }>;
  text?: string;
}>;

export type TelegramOutboundMessage = Readonly<{
  chatId: number;
  text: string;
}>;

export type TelegramBotResponse = Readonly<{
  status: "duplicate" | "ignored" | "ok";
  updateId: number;
  messages: readonly TelegramOutboundMessage[];
}>;

export type TelegramCheckIn = Readonly<{
  id: string;
  userId: string;
  profileId?: string | undefined;
  telegramUserId: number;
  hunger: number;
  mood: number;
  energy: number;
  stress: number;
  cravings: number;
  notes: string;
  createdAt: string;
}>;

export type TelegramMealLog = Readonly<{
  id: string;
  userId: string;
  profileId?: string | undefined;
  telegramUserId: number;
  text: string;
  createdAt: string;
}>;

export type TelegramUpdateClaimInput = Readonly<{
  updateId: number;
  telegramUserId?: number;
  telegramChatId?: number;
  receivedAt: string;
}>;

export type TelegramCheckInInput = Readonly<{
  idempotencyKey: string;
  userId: string;
  profileId?: string | undefined;
  telegramUserId: number;
  checkedInAt: string;
  timezone: string;
  hunger: number;
  mood: number;
  energy: number;
  stress: number;
  cravings: number;
  notes: string;
}>;

export type TelegramMealLogInput = Readonly<{
  idempotencyKey: string;
  userId: string;
  profileId?: string | undefined;
  telegramUserId: number;
  text: string;
  occurredAt: string;
  timezone: string;
}>;

export type TelegramStorageListInput = Readonly<{
  userId: string;
  profileId?: string | undefined;
  range: Readonly<{
    from: string;
    to: string;
  }>;
}>;

export type TelegramBotStorage = Readonly<{
  claimUpdate(input: TelegramUpdateClaimInput): boolean | Promise<boolean>;
  createCheckIn(
    input: TelegramCheckInInput,
  ): TelegramCheckIn | Promise<TelegramCheckIn>;
  createMealLog(
    input: TelegramMealLogInput,
  ): TelegramMealLog | Promise<TelegramMealLog>;
  listCheckIns(
    input?: TelegramStorageListInput,
  ): readonly TelegramCheckIn[] | Promise<readonly TelegramCheckIn[]>;
  listMealLogs(
    input?: TelegramStorageListInput,
  ): readonly TelegramMealLog[] | Promise<readonly TelegramMealLog[]>;
}>;

export type TelegramCoachBot = Readonly<{
  handleUpdate(update: TelegramUpdate): Promise<TelegramBotResponse>;
  listCheckIns():
    | readonly TelegramCheckIn[]
    | Promise<readonly TelegramCheckIn[]>;
  listMealLogs():
    | readonly TelegramMealLog[]
    | Promise<readonly TelegramMealLog[]>;
}>;

export type TelegramCoachBotOptions = Readonly<{
  audit: AuditPort;
  authorization?: AuthorizationService | undefined;
  coach?: TelegramLlmCoach;
  linkUrl?: string | undefined;
  linking: AsyncTelegramLinkingService;
  now?: () => Date;
  profiles?: ProfileService;
  reminders?: TelegramReminderPreferenceStore;
  reports?: CoachReportPort;
  storage?: TelegramBotStorage;
}>;

export type TelegramMessenger = Readonly<{
  sendMessage(chatId: number, text: string): Promise<void>;
}>;

type ParsedCommand = Readonly<{
  name: string;
  args: string;
}>;

type CheckInScores = Readonly<{
  hunger: number;
  mood: number;
  energy: number;
  stress: number;
  cravings: number;
  notes: string;
}>;

export function createInMemoryTelegramBotStorage(): TelegramBotStorage {
  const processedUpdateIds = new Set<number>();
  const checkIns: TelegramCheckIn[] = [];
  const mealLogs: TelegramMealLog[] = [];
  let nextCheckInId = 1;
  let nextMealLogId = 1;

  return {
    claimUpdate(input) {
      if (processedUpdateIds.has(input.updateId)) {
        return false;
      }

      processedUpdateIds.add(input.updateId);
      return true;
    },
    createCheckIn(input) {
      const checkIn: TelegramCheckIn = {
        id: `telegram_checkin_${nextCheckInId++}`,
        userId: input.userId,
        profileId: input.profileId,
        telegramUserId: input.telegramUserId,
        hunger: input.hunger,
        mood: input.mood,
        energy: input.energy,
        stress: input.stress,
        cravings: input.cravings,
        notes: input.notes,
        createdAt: input.checkedInAt,
      };

      checkIns.push(checkIn);
      return { ...checkIn };
    },
    createMealLog(input) {
      const mealLog: TelegramMealLog = {
        id: `telegram_meal_${nextMealLogId++}`,
        userId: input.userId,
        profileId: input.profileId,
        telegramUserId: input.telegramUserId,
        text: input.text,
        createdAt: input.occurredAt,
      };

      mealLogs.push(mealLog);
      return { ...mealLog };
    },
    listCheckIns(input) {
      return filterTelegramRows(checkIns, input).map((checkIn) => ({
        ...checkIn,
      }));
    },
    listMealLogs(input) {
      return filterTelegramRows(mealLogs, input).map((mealLog) => ({
        ...mealLog,
      }));
    },
  };
}

export function createRepositoryTelegramBotStorage(
  repository: NeonTelegramCoachRepository,
): TelegramBotStorage {
  return {
    claimUpdate(input) {
      return repository.claimUpdate(input);
    },
    createCheckIn(input) {
      return repository.createCheckIn(input);
    },
    createMealLog(input) {
      return repository.createMealLog(input);
    },
    listCheckIns(input) {
      if (input === undefined) {
        return [];
      }

      return repository.listCheckIns(input);
    },
    listMealLogs(input) {
      if (input === undefined) {
        return [];
      }

      return repository.listMealLogs(input);
    },
  };
}

function filterTelegramRows<
  Row extends Readonly<{
    createdAt: string;
    profileId?: string | undefined;
    userId: string;
  }>,
>(
  rows: readonly Row[],
  input: TelegramStorageListInput | undefined,
): readonly Row[] {
  if (input === undefined) {
    return rows;
  }

  return rows
    .filter((row) => row.userId === input.userId)
    .filter(
      (row) =>
        input.profileId === undefined ||
        row.profileId === input.profileId ||
        row.profileId === undefined,
    )
    .filter((row) => isWithinStorageRange(row.createdAt, input.range));
}

function isWithinStorageRange(
  timestamp: string,
  range: TelegramStorageListInput["range"],
): boolean {
  const time = Date.parse(timestamp);
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);

  return (
    Number.isFinite(time) &&
    Number.isFinite(from) &&
    Number.isFinite(to) &&
    time >= from &&
    time < to
  );
}

export function createTelegramCoachBot(
  options: TelegramCoachBotOptions,
): TelegramCoachBot {
  const now = options.now ?? (() => new Date());
  const storage = options.storage ?? createInMemoryTelegramBotStorage();

  return {
    async handleUpdate(update) {
      const message = update.message;
      const telegramUserId = message?.from?.id;
      const chatId = message?.chat.id;
      const claimed = await storage.claimUpdate({
        updateId: update.update_id,
        ...(telegramUserId === undefined ? {} : { telegramUserId }),
        ...(chatId === undefined ? {} : { telegramChatId: chatId }),
        receivedAt: now().toISOString(),
      });

      if (!claimed) {
        return {
          status: "duplicate",
          updateId: update.update_id,
          messages: [],
        };
      }

      const text = message?.text?.trim();

      if (
        message === undefined ||
        telegramUserId === undefined ||
        chatId === undefined ||
        text === undefined ||
        text.length === 0
      ) {
        return {
          status: "ignored",
          updateId: update.update_id,
          messages: [],
        };
      }

      const command = parseCommand(text);

      if (message.chat.type !== "private") {
        return ok(
          update,
          chatId,
          "Please DM me for Fitness Coach commands so health data stays private.",
        );
      }

      const activeAccount =
        await options.linking.findActiveAccountByTelegramUserId(telegramUserId);

      if (command.name === "/start") {
        const deepLinkToken = opaqueLinkTokenFromStartArgs(command.args);

        if (deepLinkToken !== undefined) {
          return handleOpaqueLinkCommand({
            audit: options.audit,
            chatId,
            linking: options.linking,
            telegramUserId,
            token: deepLinkToken,
            update,
          });
        }

        return ok(
          update,
          chatId,
          formatTelegramCommandHelp({
            linked: activeAccount !== undefined,
            linkUrl: options.linkUrl,
          }),
        );
      }

      if (command.name === "/link") {
        return handleLinkCommand({
          activeAccount,
          audit: options.audit,
          chatId,
          command,
          linkUrl: options.linkUrl,
          linking: options.linking,
          telegramUserId,
          update,
        });
      }

      if (command.name === "/commands" || command.name === "/help") {
        return ok(
          update,
          chatId,
          formatTelegramCommandHelp({
            linked: activeAccount !== undefined,
            linkUrl: options.linkUrl,
          }),
        );
      }

      if (activeAccount === undefined) {
        return ok(update, chatId, linkRequiredText(options.linkUrl));
      }

      const selfProfile = await options.profiles?.getSelfProfile(
        activeAccount.userId,
      );
      const profileId = selfProfile?.profileId;
      const requiredPermission = telegramCommandPermission(command.name);

      if (
        options.authorization !== undefined &&
        profileId !== undefined &&
        requiredPermission !== undefined
      ) {
        try {
          await options.authorization.requirePermission(
            activeAccount.userId,
            profileId,
            requiredPermission,
            { requestedAction: `telegram${command.name}` },
          );
        } catch (error) {
          if (error instanceof AuthorizationError) {
            return ok(
              update,
              chatId,
              "This action is not available for the linked health profile.",
            );
          }

          throw error;
        }
      }

      switch (command.name) {
        case "/checkin":
          return handleCheckInCommand({
            account: activeAccount,
            audit: options.audit,
            chatId,
            command,
            now,
            profileId,
            storage,
            telegramUserId,
            update,
          });
        case "/log":
          return handleMealLogCommand({
            account: activeAccount,
            audit: options.audit,
            chatId,
            command,
            now,
            profileId,
            storage,
            telegramUserId,
            update,
          });
        case "/coach":
          return handleCoachCommand({
            account: activeAccount,
            audit: options.audit,
            chatId,
            coach: options.coach,
            command,
            now,
            profileId,
            reports: options.reports,
            telegramUserId,
            update,
          });
        case "/report":
          return handleReportCommand({
            account: activeAccount,
            chatId,
            now,
            profileId,
            reports: options.reports,
            update,
          });
        case "/settings":
          return handleSettingsCommand({
            account: activeAccount,
            audit: options.audit,
            chatId,
            command,
            reminders: options.reminders,
            update,
          });
        case "/unlink":
          return handleUnlinkCommand({
            account: activeAccount,
            audit: options.audit,
            chatId,
            linking: options.linking,
            telegramUserId,
            update,
          });
        default:
          if (!isSlashCommand(text)) {
            return handleCoachCommand({
              account: activeAccount,
              audit: options.audit,
              chatId,
              coach: options.coach,
              command: {
                name: "/coach",
                args: text,
              },
              now,
              profileId,
              reports: options.reports,
              telegramUserId,
              update,
            });
          }

          return ok(
            update,
            chatId,
            formatTelegramCommandHelp({
              linked: true,
              prefix: `Unknown command: ${command.name}`,
            }),
          );
      }
    },
    listCheckIns() {
      return storage.listCheckIns();
    },
    listMealLogs() {
      return storage.listMealLogs();
    },
  };
}

function telegramCommandPermission(
  commandName: string,
): ProfilePermission | undefined {
  switch (commandName) {
    case "/checkin":
      return "checkin.write";
    case "/log":
      return "meal.write";
    case "/coach":
      return "report.read";
    case "/report":
      return "report.create";
    case "/settings":
      return "reminder.write";
    default:
      return commandName.startsWith("/") ? undefined : "report.read";
  }
}

export function createGrammyTelegramMessenger(
  botToken: string,
): TelegramMessenger {
  const bot = new Bot(botToken);

  return {
    async sendMessage(chatId, text) {
      await bot.api.sendMessage(chatId, text);
    },
  };
}

async function handleLinkCommand(input: {
  activeAccount: TelegramAccount | undefined;
  audit: AuditPort;
  chatId: number;
  command: ParsedCommand;
  linkUrl: string | undefined;
  linking: AsyncTelegramLinkingService;
  telegramUserId: number;
  update: TelegramUpdate;
}): Promise<TelegramBotResponse> {
  const parts = input.command.args.split(/\s+/u).filter(Boolean);

  if (parts.length === 0) {
    const linkedSuffix =
      input.activeAccount === undefined
        ? linkRequiredText(input.linkUrl)
        : "This Telegram account is already linked.";

    return ok(input.update, input.chatId, linkedSuffix);
  }

  if (parts.length === 1) {
    const [token] = parts;

    if (token !== undefined && isOpaqueLinkToken(token)) {
      return handleOpaqueLinkCommand({
        audit: input.audit,
        chatId: input.chatId,
        linking: input.linking,
        telegramUserId: input.telegramUserId,
        token,
        update: input.update,
      });
    }
  }

  const [token, state, nonce] = parts;

  if (token === undefined || state === undefined || nonce === undefined) {
    return ok(
      input.update,
      input.chatId,
      "Link format: /link <token> <state> <nonce>.",
    );
  }

  const consumeResult = await input.linking.consumeLinkToken({
    token,
    state,
    nonce,
    telegramUserId: input.telegramUserId,
  });

  if (consumeResult.ok === false) {
    const error = consumeResult.error;

    return ok(input.update, input.chatId, `Link failed: ${error}.`);
  }

  return completeTelegramLink({
    audit: input.audit,
    chatId: input.chatId,
    consumeResult,
    telegramUserId: input.telegramUserId,
    update: input.update,
  });
}

async function handleOpaqueLinkCommand(input: {
  audit: AuditPort;
  chatId: number;
  linking: AsyncTelegramLinkingService;
  telegramUserId: number;
  token: string;
  update: TelegramUpdate;
}): Promise<TelegramBotResponse> {
  const consumeResult = await input.linking.consumeOpaqueLinkToken({
    token: input.token,
    telegramUserId: input.telegramUserId,
  });

  if (consumeResult.ok === false) {
    const error = consumeResult.error;

    return ok(input.update, input.chatId, `Link failed: ${error}.`);
  }

  return completeTelegramLink({
    audit: input.audit,
    chatId: input.chatId,
    consumeResult,
    telegramUserId: input.telegramUserId,
    update: input.update,
  });
}

async function completeTelegramLink(input: {
  audit: AuditPort;
  chatId: number;
  consumeResult: Extract<TelegramLinkConsumeResult, { ok: true }>;
  telegramUserId: number;
  update: TelegramUpdate;
}): Promise<TelegramBotResponse> {
  await input.audit.create({
    action: "telegram.account.link",
    actor: {
      type: "user",
      id: input.consumeResult.account.userId,
    },
    target: {
      type: "telegram_account",
      id: input.consumeResult.account.id,
    },
    userId: input.consumeResult.account.userId,
    metadata: {
      telegramUserId: input.telegramUserId,
    },
  });

  return ok(input.update, input.chatId, "Telegram account linked.");
}

async function handleCheckInCommand(input: {
  account: TelegramAccount;
  audit: AuditPort;
  chatId: number;
  command: ParsedCommand;
  now: () => Date;
  profileId?: string | undefined;
  storage: TelegramBotStorage;
  telegramUserId: number;
  update: TelegramUpdate;
}): Promise<TelegramBotResponse> {
  const scores = parseCheckInScores(input.command.args);

  if (scores === undefined) {
    return ok(
      input.update,
      input.chatId,
      "Send /checkin hunger=1-10 mood=1-10 energy=1-10 stress=1-10 cravings=1-10 notes=optional.",
    );
  }

  const checkedInAt = input.now().toISOString();
  const checkIn = await input.storage.createCheckIn({
    idempotencyKey: idempotencyKeyForUpdate(input.update, "checkin"),
    userId: input.account.userId,
    profileId: input.profileId,
    telegramUserId: input.telegramUserId,
    checkedInAt,
    timezone: "UTC",
    ...scores,
  });

  await input.audit.create({
    action: "telegram.checkin.log",
    actor: {
      type: "user",
      id: input.account.userId,
    },
    target: {
      type: "telegram_checkin",
      id: checkIn.id,
    },
    userId: input.account.userId,
    profileId: input.profileId,
    metadata: {
      profileId: input.profileId,
      telegramUserId: input.telegramUserId,
      hunger: checkIn.hunger,
      mood: checkIn.mood,
      energy: checkIn.energy,
      stress: checkIn.stress,
      cravings: checkIn.cravings,
    },
  });

  return ok(input.update, input.chatId, "Check-in logged.");
}

async function handleMealLogCommand(input: {
  account: TelegramAccount;
  audit: AuditPort;
  chatId: number;
  command: ParsedCommand;
  now: () => Date;
  profileId?: string | undefined;
  storage: TelegramBotStorage;
  telegramUserId: number;
  update: TelegramUpdate;
}): Promise<TelegramBotResponse> {
  const text = input.command.args.trim();

  if (text.length === 0) {
    return ok(
      input.update,
      input.chatId,
      "Send /log followed by the meal text.",
    );
  }

  const occurredAt = input.now().toISOString();
  const mealLog = await input.storage.createMealLog({
    idempotencyKey: idempotencyKeyForUpdate(input.update, "meal"),
    userId: input.account.userId,
    profileId: input.profileId,
    telegramUserId: input.telegramUserId,
    text,
    occurredAt,
    timezone: "UTC",
  });

  await input.audit.create({
    action: "telegram.meal.log",
    actor: {
      type: "user",
      id: input.account.userId,
    },
    target: {
      type: "telegram_meal",
      id: mealLog.id,
    },
    userId: input.account.userId,
    profileId: input.profileId,
    metadata: {
      profileId: input.profileId,
      telegramUserId: input.telegramUserId,
      textLength: text.length,
    },
  });

  return ok(input.update, input.chatId, "Meal note logged.");
}

async function handleCoachCommand(input: {
  account: TelegramAccount;
  audit: AuditPort;
  chatId: number;
  coach: TelegramLlmCoach | undefined;
  command: ParsedCommand;
  now: () => Date;
  profileId?: string | undefined;
  reports: CoachReportPort | undefined;
  telegramUserId: number;
  update: TelegramUpdate;
}): Promise<TelegramBotResponse> {
  const messageText = input.command.args.trim();

  if (messageText.length === 0) {
    return ok(
      input.update,
      input.chatId,
      "Send /coach followed by the question or just DM me the question.",
    );
  }

  if (input.coach === undefined) {
    return ok(
      input.update,
      input.chatId,
      "Smart coach chat is not configured yet. You can still use /log, /checkin, and /report.",
    );
  }

  const reportText = await dailyReportTextOrUndefined({
    account: input.account,
    now: input.now,
    profileId: input.profileId,
    reports: input.reports,
  });

  try {
    const reply = await input.coach.reply({
      userId: input.account.userId,
      telegramUserId: input.telegramUserId,
      messageText,
      ...(reportText === undefined ? {} : { reportText }),
      now: input.now(),
    });

    await input.audit.create({
      action: "telegram.coach.reply",
      actor: {
        type: "user",
        id: input.account.userId,
      },
      target: {
        type: "telegram_coach_reply",
        id: idempotencyKeyForUpdate(input.update, "coach"),
      },
      userId: input.account.userId,
      profileId: input.profileId,
      metadata: {
        profileId: input.profileId,
        telegramUserId: input.telegramUserId,
        provider: reply.provider,
        model: reply.model,
        messageLength: messageText.length,
        replyLength: reply.text.length,
        hasReportContext: reportText !== undefined,
      },
    });

    return ok(input.update, input.chatId, reply.text);
  } catch {
    await input.audit.create({
      action: "telegram.coach.error",
      actor: {
        type: "user",
        id: input.account.userId,
      },
      target: {
        type: "telegram_coach_reply",
        id: idempotencyKeyForUpdate(input.update, "coach"),
      },
      userId: input.account.userId,
      profileId: input.profileId,
      metadata: {
        profileId: input.profileId,
        telegramUserId: input.telegramUserId,
        messageLength: messageText.length,
        hasReportContext: reportText !== undefined,
      },
    });

    return ok(
      input.update,
      input.chatId,
      "Smart coach chat is temporarily unavailable. Use /report for the deterministic summary.",
    );
  }
}

async function handleReportCommand(input: {
  account: TelegramAccount;
  chatId: number;
  now: () => Date;
  profileId?: string | undefined;
  reports: CoachReportPort | undefined;
  update: TelegramUpdate;
}): Promise<TelegramBotResponse> {
  if (input.reports === undefined) {
    return ok(input.update, input.chatId, "Reports are not ready yet.");
  }

  const result = await input.reports.generateDailyReport({
    userId: input.account.userId,
    profileId: input.profileId,
    range: lastTwentyFourHoursRange(input.now()),
  });

  return ok(input.update, input.chatId, result.text);
}

async function dailyReportTextOrUndefined(input: {
  account: TelegramAccount;
  now: () => Date;
  profileId?: string | undefined;
  reports: CoachReportPort | undefined;
}): Promise<string | undefined> {
  if (input.reports === undefined) {
    return undefined;
  }

  try {
    const result = await input.reports.generateDailyReport({
      userId: input.account.userId,
      profileId: input.profileId,
      range: lastTwentyFourHoursRange(input.now()),
    });

    return result.text;
  } catch {
    return undefined;
  }
}

async function handleSettingsCommand(input: {
  account: TelegramAccount;
  audit: AuditPort;
  chatId: number;
  command: ParsedCommand;
  reminders: TelegramReminderPreferenceStore | undefined;
  update: TelegramUpdate;
}): Promise<TelegramBotResponse> {
  if (input.reminders === undefined) {
    return ok(input.update, input.chatId, "Settings are not ready yet.");
  }

  const parts = input.command.args.split(/\s+/u).filter(Boolean);
  const [rawSection, action] = parts;
  const section = normalizedSettingsSection(rawSection);

  if (section === undefined) {
    const preferences = await input.reminders.findPreferencesByUserId(
      input.account.userId,
    );

    return ok(input.update, input.chatId, settingsSummary(preferences));
  }

  if (section !== "reminders" || (action !== "on" && action !== "off")) {
    return ok(
      input.update,
      input.chatId,
      "Settings: /settings reminders on or /settings reminders off.",
    );
  }

  const existingPreferences = await input.reminders.findPreferencesByUserId(
    input.account.userId,
  );
  const enabled = action === "on";
  const preferences = await input.reminders.upsertPreferences({
    ...(existingPreferences ??
      defaultTelegramReminderPreferences({
        userId: input.account.userId,
        timezone: "Asia/Jerusalem",
      })),
    enabled,
  });

  await input.audit.create({
    action: "telegram.reminders.update",
    actor: {
      type: "user",
      id: input.account.userId,
    },
    target: {
      type: "telegram_reminder_preferences",
      id: input.account.userId,
    },
    userId: input.account.userId,
    metadata: {
      enabled: preferences.enabled,
      timezone: preferences.timezone,
      slotCount: preferences.slots.length,
    },
  });

  return ok(input.update, input.chatId, settingsSummary(preferences));
}

function settingsSummary(
  preferences: Awaited<
    ReturnType<TelegramReminderPreferenceStore["findPreferencesByUserId"]>
  >,
): string {
  if (preferences === undefined || !preferences.enabled) {
    return "Telegram coach settings: linked. Reminders: off. Use /settings reminders on.";
  }

  const slots = preferences.slots.map((slot) => slot.localTime).join(", ");

  return `Telegram coach settings: linked. Reminders: on (${slots}, ${preferences.timezone}). Use /settings reminders off.`;
}

function normalizedSettingsSection(
  section: string | undefined,
): string | undefined {
  if (section === "remidners" || section === "reminder") {
    return "reminders";
  }

  return section;
}

function idempotencyKeyForUpdate(
  update: TelegramUpdate,
  kind: "checkin" | "coach" | "meal",
): string {
  return `telegram-update-${update.update_id}-${kind}`;
}

async function handleUnlinkCommand(input: {
  account: TelegramAccount;
  audit: AuditPort;
  chatId: number;
  linking: AsyncTelegramLinkingService;
  telegramUserId: number;
  update: TelegramUpdate;
}): Promise<TelegramBotResponse> {
  const unlinkedAccount = await input.linking.unlinkTelegramUser(
    input.telegramUserId,
  );

  if (unlinkedAccount === "not-linked") {
    return ok(input.update, input.chatId, "No linked Telegram account found.");
  }

  await input.audit.create({
    action: "telegram.account.unlink",
    actor: {
      type: "user",
      id: input.account.userId,
    },
    target: {
      type: "telegram_account",
      id: input.account.id,
    },
    userId: input.account.userId,
    metadata: {
      telegramUserId: input.telegramUserId,
    },
  });

  return ok(input.update, input.chatId, "Telegram account unlinked.");
}

function parseCommand(text: string): ParsedCommand {
  const [rawCommand = "", ...rest] = text.split(/\s+/u);
  const name = rawCommand.split("@")[0]?.toLowerCase() ?? "";

  return {
    name,
    args: rest.join(" "),
  };
}

function isSlashCommand(text: string): boolean {
  return text.startsWith("/");
}

function opaqueLinkTokenFromStartArgs(args: string): string | undefined {
  const parts = args.split(/\s+/u).filter(Boolean);

  if (parts.length !== 1) {
    return undefined;
  }

  const [token] = parts;

  return token !== undefined && isOpaqueLinkToken(token) ? token : undefined;
}

function isOpaqueLinkToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/u.test(value);
}

function parseCheckInScores(input: string): CheckInScores | undefined {
  const values = parseKeyValues(input);
  const hunger = score(values.get("hunger"));
  const mood = score(values.get("mood"));
  const energy = score(values.get("energy"));
  const stress = score(values.get("stress"));
  const cravings = score(values.get("cravings"));

  if (
    hunger === undefined ||
    mood === undefined ||
    energy === undefined ||
    stress === undefined ||
    cravings === undefined
  ) {
    return undefined;
  }

  return {
    hunger,
    mood,
    energy,
    stress,
    cravings,
    notes: values.get("notes") ?? "",
  };
}

function parseKeyValues(input: string): ReadonlyMap<string, string> {
  const matches = [...input.matchAll(/([a-z_]+)=/giu)];
  const values = new Map<string, string>();

  for (const [index, match] of matches.entries()) {
    const key = match[1]?.toLowerCase();
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? input.length;

    if (key !== undefined) {
      values.set(key, input.slice(start, end).trim());
    }
  }

  return values;
}

function score(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/u.test(value)) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return parsed >= 1 && parsed <= 10 ? parsed : undefined;
}

function ok(
  update: TelegramUpdate,
  chatId: number,
  text: string,
): TelegramBotResponse {
  return {
    status: "ok",
    updateId: update.update_id,
    messages: [
      {
        chatId,
        text,
      },
    ],
  };
}

function linkRequiredText(linkUrl: string | undefined): string {
  if (linkUrl === undefined) {
    return "I need to link this Telegram account first. Open the authenticated link flow, then tap the Telegram link.";
  }

  return `I need to link this Telegram account first. Open ${linkUrl}, sign in, then tap the Telegram link.`;
}
