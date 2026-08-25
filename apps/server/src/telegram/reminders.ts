import type { AuditPort } from "../services/audit.js";
import type { TelegramMessenger } from "./bot.js";

export type TelegramReminderKind = "checkin";

export type TelegramReminderSlot = Readonly<{
  id: string;
  kind: TelegramReminderKind;
  localTime: string;
}>;

export type TelegramQuietHours = Readonly<{
  start: string;
  end: string;
}>;

export type TelegramReminderPreferences = Readonly<{
  userId: string;
  enabled: boolean;
  timezone: string;
  slots: readonly TelegramReminderSlot[];
  quietHours?: TelegramQuietHours;
  lastSentAtBySlot: Readonly<Record<string, string>>;
}>;

export type TelegramReminderPlanCandidate = Readonly<{
  userId: string;
  telegramUserId: number;
  telegramChatId?: number;
  preferences: TelegramReminderPreferences;
}>;

export type TelegramReminderSlotClaim = Readonly<{
  userId: string;
  slotId: string;
  localDate: string;
  timezone: string;
  sentAt: string;
}>;

export type TelegramReminderPreferenceStore = Readonly<{
  upsertPreferences(
    preferences: TelegramReminderPreferences,
  ): Promise<TelegramReminderPreferences>;
  findPreferencesByUserId(
    userId: string,
  ): Promise<TelegramReminderPreferences | undefined>;
  claimReminderSlot(
    input: TelegramReminderSlotClaim,
  ): Promise<TelegramReminderPreferences | undefined>;
  listPreferences(): Promise<readonly TelegramReminderPreferences[]>;
  listReminderCandidates(): Promise<readonly TelegramReminderPlanCandidate[]>;
}>;

export type DueTelegramReminder = Readonly<{
  userId: string;
  telegramUserId: number;
  telegramChatId: number;
  slotId: string;
  kind: TelegramReminderKind;
  timezone: string;
  localDate: string;
  localTime: string;
  plannedAt: string;
  text: string;
}>;

export type TelegramReminderRunFailure = Readonly<{
  userId: string;
  slotId: string;
  reason: string;
}>;

export type TelegramReminderRunResult = Readonly<{
  planned: number;
  sent: number;
  failed: number;
  failures: readonly TelegramReminderRunFailure[];
}>;

export type TelegramReminderRunnerOptions = Readonly<{
  audit: AuditPort;
  messenger: TelegramMessenger;
  now?: () => Date;
  reminders: TelegramReminderPreferenceStore;
}>;

const checkInReminderText =
  "Quick check-in: hunger, mood, energy, stress, cravings?";

const defaultReminderSlots: readonly TelegramReminderSlot[] = [
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
];

export function defaultTelegramReminderPreferences(input: {
  userId: string;
  timezone?: string;
}): TelegramReminderPreferences {
  return {
    userId: input.userId,
    enabled: false,
    timezone: input.timezone ?? "UTC",
    slots: copySlots(defaultReminderSlots),
    quietHours: {
      start: "22:00",
      end: "07:00",
    },
    lastSentAtBySlot: {},
  };
}

export function createInMemoryTelegramReminderPreferenceStore(): TelegramReminderPreferenceStore {
  const preferencesByUserId = new Map<string, TelegramReminderPreferences>();

  return {
    async upsertPreferences(preferences) {
      const copy = copyPreferences(preferences);

      preferencesByUserId.set(copy.userId, copy);

      return copyPreferences(copy);
    },
    async findPreferencesByUserId(userId) {
      const preferences = preferencesByUserId.get(userId);

      return preferences === undefined
        ? undefined
        : copyPreferences(preferences);
    },
    async claimReminderSlot(input) {
      const preferences = preferencesByUserId.get(input.userId);

      if (preferences === undefined) {
        return undefined;
      }

      const lastSentAt = preferences.lastSentAtBySlot[input.slotId];

      if (
        lastSentAt !== undefined &&
        localDateFor(lastSentAt, input.timezone) === input.localDate
      ) {
        return undefined;
      }

      const updatedPreferences = markReminderSlotSent({
        preferences,
        slotId: input.slotId,
        sentAt: input.sentAt,
      });

      preferencesByUserId.set(input.userId, updatedPreferences);

      return copyPreferences(updatedPreferences);
    },
    async listPreferences() {
      return [...preferencesByUserId.values()].map(copyPreferences);
    },
    async listReminderCandidates() {
      return [];
    },
  };
}

export function createRepositoryTelegramReminderPreferenceStore(
  repository: TelegramReminderPreferenceStore,
): TelegramReminderPreferenceStore {
  return {
    upsertPreferences(preferences) {
      return repository.upsertPreferences(preferences);
    },
    findPreferencesByUserId(userId) {
      return repository.findPreferencesByUserId(userId);
    },
    claimReminderSlot(input) {
      return repository.claimReminderSlot(input);
    },
    listPreferences() {
      return repository.listPreferences();
    },
    listReminderCandidates() {
      return repository.listReminderCandidates();
    },
  };
}

export function planDueTelegramReminders(input: {
  now: Date;
  candidates: readonly TelegramReminderPlanCandidate[];
}): readonly DueTelegramReminder[] {
  const plannedAt = input.now.toISOString();
  const due: DueTelegramReminder[] = [];

  for (const candidate of input.candidates) {
    const preferences = candidate.preferences;

    if (!preferences.enabled) {
      continue;
    }

    const localNow = localDateTimeParts(input.now, preferences.timezone);

    if (localNow === undefined) {
      continue;
    }

    if (
      preferences.quietHours !== undefined &&
      isWithinQuietHours(localNow.minutes, preferences.quietHours)
    ) {
      continue;
    }

    for (const slot of preferences.slots) {
      const slotMinutes = parseLocalTime(slot.localTime);

      if (slotMinutes === undefined || localNow.minutes < slotMinutes) {
        continue;
      }

      const lastSentAt = preferences.lastSentAtBySlot[slot.id];

      if (
        lastSentAt !== undefined &&
        localDateFor(lastSentAt, preferences.timezone) === localNow.date
      ) {
        continue;
      }

      due.push({
        userId: candidate.userId,
        telegramUserId: candidate.telegramUserId,
        telegramChatId: candidate.telegramChatId ?? candidate.telegramUserId,
        slotId: slot.id,
        kind: slot.kind,
        timezone: preferences.timezone,
        localDate: localNow.date,
        localTime: slot.localTime,
        plannedAt,
        text: reminderText(slot),
      });
    }
  }

  return due;
}

export async function runDueTelegramReminders(
  options: TelegramReminderRunnerOptions,
): Promise<TelegramReminderRunResult> {
  const now = (options.now ?? (() => new Date()))();
  const candidates = await options.reminders.listReminderCandidates();
  const due = planDueTelegramReminders({
    now,
    candidates,
  });
  const failures: TelegramReminderRunFailure[] = [];
  let sent = 0;

  for (const reminder of due) {
    const claimedPreferences = await options.reminders.claimReminderSlot({
      userId: reminder.userId,
      slotId: reminder.slotId,
      localDate: reminder.localDate,
      timezone: reminder.timezone,
      sentAt: now.toISOString(),
    });

    if (claimedPreferences === undefined) {
      continue;
    }

    try {
      await options.messenger.sendMessage(
        reminder.telegramChatId,
        reminder.text,
      );
      await options.audit.create({
        action: "telegram.reminder.send",
        actor: {
          type: "service",
          id: "telegram-reminder-runner",
        },
        target: {
          type: "telegram_reminder",
          id: `${reminder.userId}:${reminder.slotId}:${reminder.localDate}`,
        },
        userId: reminder.userId,
        metadata: {
          telegramUserId: reminder.telegramUserId,
          telegramChatId: reminder.telegramChatId,
          slotId: reminder.slotId,
          kind: reminder.kind,
          localDate: reminder.localDate,
          localTime: reminder.localTime,
          textLength: reminder.text.length,
        },
      });
      sent += 1;
    } catch (error) {
      failures.push({
        userId: reminder.userId,
        slotId: reminder.slotId,
        reason: errorMessage(error),
      });
    }
  }

  return {
    planned: due.length,
    sent,
    failed: failures.length,
    failures,
  };
}

function markReminderSlotSent(input: {
  preferences: TelegramReminderPreferences;
  slotId: string;
  sentAt: string;
}): TelegramReminderPreferences {
  return {
    ...copyPreferences(input.preferences),
    lastSentAtBySlot: {
      ...input.preferences.lastSentAtBySlot,
      [input.slotId]: input.sentAt,
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Reminder send failed.";
}

function localDateFor(
  isoTimestamp: string,
  timezone: string,
): string | undefined {
  const timestamp = new Date(isoTimestamp);

  if (!Number.isFinite(timestamp.getTime())) {
    return undefined;
  }

  return localDateTimeParts(timestamp, timezone)?.date;
}

function localDateTimeParts(
  date: Date,
  timezone: string,
): { date: string; minutes: number } | undefined {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const parts = new Map(
      formatter
        .formatToParts(date)
        .map((part) => [part.type, part.value] as const),
    );
    const year = parts.get("year");
    const month = parts.get("month");
    const day = parts.get("day");
    const hour = parts.get("hour");
    const minute = parts.get("minute");

    if (
      year === undefined ||
      month === undefined ||
      day === undefined ||
      hour === undefined ||
      minute === undefined
    ) {
      return undefined;
    }

    return {
      date: `${year}-${month}-${day}`,
      minutes: Number.parseInt(hour, 10) * 60 + Number.parseInt(minute, 10),
    };
  } catch {
    return undefined;
  }
}

function isWithinQuietHours(
  localMinutes: number,
  quietHours: TelegramQuietHours,
): boolean {
  const start = parseLocalTime(quietHours.start);
  const end = parseLocalTime(quietHours.end);

  if (start === undefined || end === undefined || start === end) {
    return false;
  }

  if (start < end) {
    return localMinutes >= start && localMinutes < end;
  }

  return localMinutes >= start || localMinutes < end;
}

function parseLocalTime(localTime: string): number | undefined {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(localTime);

  if (match === null) {
    return undefined;
  }

  return (
    Number.parseInt(match[1] ?? "0", 10) * 60 +
    Number.parseInt(match[2] ?? "0", 10)
  );
}

function reminderText(slot: TelegramReminderSlot): string {
  switch (slot.kind) {
    case "checkin":
      return checkInReminderText;
  }
}

function copyPreferences(
  preferences: TelegramReminderPreferences,
): TelegramReminderPreferences {
  return {
    userId: preferences.userId,
    enabled: preferences.enabled,
    timezone: preferences.timezone,
    slots: copySlots(preferences.slots),
    ...(preferences.quietHours === undefined
      ? {}
      : { quietHours: { ...preferences.quietHours } }),
    lastSentAtBySlot: { ...preferences.lastSentAtBySlot },
  };
}

function copySlots(
  slots: readonly TelegramReminderSlot[],
): readonly TelegramReminderSlot[] {
  return slots.map((slot) => ({ ...slot }));
}
