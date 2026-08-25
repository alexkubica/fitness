import { createHash } from "node:crypto";
import type { SqlQueryExecutor } from "./health-samples.js";

export type { SqlQueryExecutor } from "./health-samples.js";

export type TelegramLinkToken = Readonly<{
  token: string;
  userId: string;
  state: string;
  nonce: string;
  expiresAt: string;
}>;

export type TelegramAccount = Readonly<{
  id: string;
  userId: string;
  telegramUserId: number;
  linkedAt: string;
  active: boolean;
  revokedAt?: string;
}>;

export type TelegramLinkConsumeError =
  | "account-mismatch"
  | "expired"
  | "nonce-mismatch"
  | "not-found"
  | "state-mismatch"
  | "used";

export type TelegramLinkConsumeResult =
  | Readonly<{
      ok: true;
      account: TelegramAccount;
    }>
  | Readonly<{
      ok: false;
      error: TelegramLinkConsumeError;
    }>;

export type TelegramLinkTokenInput = Readonly<{
  token: string;
  userId: string;
  state: string;
  nonce: string;
  expiresAt: string;
}>;

export type TelegramLinkTokenConsumeInput = Readonly<{
  token: string;
  state: string;
  nonce: string;
  telegramUserId: number;
}>;

export type TelegramOpaqueLinkTokenConsumeInput = Readonly<{
  token: string;
  telegramUserId: number;
}>;

export type NeonTelegramLinkingRepository = Readonly<{
  createLinkToken(input: TelegramLinkTokenInput): Promise<TelegramLinkToken>;
  consumeLinkToken(
    input: TelegramLinkTokenConsumeInput,
  ): Promise<TelegramLinkConsumeResult>;
  consumeOpaqueLinkToken(
    input: TelegramOpaqueLinkTokenConsumeInput,
  ): Promise<TelegramLinkConsumeResult>;
  findActiveAccountByTelegramUserId(
    telegramUserId: number,
  ): Promise<TelegramAccount | undefined>;
  unlinkTelegramUser(
    telegramUserId: number,
  ): Promise<TelegramAccount | "not-linked">;
}>;

export type TelegramUpdateClaimInput = Readonly<{
  updateId: number;
  telegramUserId?: number;
  telegramChatId?: number;
  receivedAt: string;
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

export type TelegramCoachListInput = Readonly<{
  userId: string;
  profileId?: string | undefined;
  range: Readonly<{
    from: string;
    to: string;
  }>;
}>;

export type NeonTelegramCoachRepository = Readonly<{
  claimUpdate(input: TelegramUpdateClaimInput): Promise<boolean>;
  createCheckIn(input: TelegramCheckInInput): Promise<TelegramCheckIn>;
  createMealLog(input: TelegramMealLogInput): Promise<TelegramMealLog>;
  listCheckIns(
    input: TelegramCoachListInput,
  ): Promise<readonly TelegramCheckIn[]>;
  listMealLogs(
    input: TelegramCoachListInput,
  ): Promise<readonly TelegramMealLog[]>;
}>;

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
  telegramChatId: number;
  preferences: TelegramReminderPreferences;
}>;

export type TelegramReminderSlotClaim = Readonly<{
  userId: string;
  slotId: string;
  localDate: string;
  timezone: string;
  sentAt: string;
}>;

export type NeonTelegramReminderRepository = Readonly<{
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

export type NeonTelegramLinkingRepositoryOptions = Readonly<{
  hashToken?: (token: string) => string;
}>;

export function createNeonTelegramLinkingRepository(
  sql: SqlQueryExecutor,
  options: NeonTelegramLinkingRepositoryOptions = {},
): NeonTelegramLinkingRepository {
  const hashToken = options.hashToken ?? sha256TokenHash;

  return {
    async createLinkToken(input) {
      const tokenHash = hashToken(input.token);

      await sql`
        with ensure_user as (
          insert into users (id)
          values (${input.userId})
          on conflict (id) do nothing
        )
        insert into telegram_link_tokens (
          user_id,
          token_hash,
          nonce,
          state,
          expires_at
        )
        values (
          ${input.userId},
          ${tokenHash},
          ${input.nonce},
          ${input.state},
          ${input.expiresAt}
        )
      `;

      return { ...input };
    },
    async consumeLinkToken(input) {
      return consumeLinkTokenWithValidation(sql, hashToken, input);
    },
    async consumeOpaqueLinkToken(input) {
      return consumeLinkTokenWithValidation(sql, hashToken, input);
    },
    async findActiveAccountByTelegramUserId(telegramUserId) {
      const rows = await sql`
        select
          id::text,
          user_id,
          telegram_user_id,
          linked_at,
          revoked_at
        from telegram_accounts
        where telegram_user_id = ${String(telegramUserId)}
          and revoked_at is null
        order by linked_at desc
        limit 1
      `;

      return rows[0] === undefined ? undefined : rowToAccount(rows[0]);
    },
    async unlinkTelegramUser(telegramUserId) {
      const rows = await sql`
        update telegram_accounts
        set
          revoked_at = now(),
          revoke_reason = 'user_unlinked'
        where telegram_user_id = ${String(telegramUserId)}
          and revoked_at is null
        returning
          id::text,
          user_id,
          telegram_user_id,
          linked_at,
          revoked_at
      `;

      return rows[0] === undefined ? "not-linked" : rowToAccount(rows[0]);
    },
  };
}

async function consumeLinkTokenWithValidation(
  sql: SqlQueryExecutor,
  hashToken: (token: string) => string,
  input: TelegramLinkTokenConsumeInput | TelegramOpaqueLinkTokenConsumeInput,
): Promise<TelegramLinkConsumeResult> {
  const tokenHash = hashToken(input.token);
  const requiredState = "state" in input ? input.state : null;
  const requiredNonce = "nonce" in input ? input.nonce : null;

  const rows = await sql`
        with request_input as (
          select
            ${tokenHash}::text as token_hash,
            ${requiredState}::text as state,
            ${requiredNonce}::text as nonce,
            ${String(input.telegramUserId)}::text as telegram_user_id
        ),
        link_token as (
          select telegram_link_tokens.*
          from telegram_link_tokens, request_input
          where telegram_link_tokens.token_hash = request_input.token_hash
        ),
        active_account as (
          select telegram_accounts.*
          from telegram_accounts, request_input
          where telegram_accounts.telegram_user_id = request_input.telegram_user_id
            and telegram_accounts.revoked_at is null
          limit 1
        ),
        validation as (
          select case
            when not exists (select 1 from link_token) then 'not-found'
            when exists (
              select 1
              from link_token
              where used_at is not null or revoked_at is not null
            ) then 'used'
            when exists (
              select 1
              from link_token
              where expires_at <= now()
            ) then 'expired'
            when exists (
              select 1
              from link_token, request_input
              where request_input.state is not null
                and link_token.state <> request_input.state
            ) then 'state-mismatch'
            when exists (
              select 1
              from link_token, request_input
              where request_input.nonce is not null
                and link_token.nonce <> request_input.nonce
            ) then 'nonce-mismatch'
            when exists (
              select 1
              from active_account, link_token
              where active_account.user_id <> link_token.user_id
            ) then 'account-mismatch'
            else null
          end as error
        ),
        revoke_existing_account as (
          update telegram_accounts
          set
            revoked_at = now(),
            revoke_reason = 'relink'
          from active_account, link_token, validation
          where validation.error is null
            and telegram_accounts.id = active_account.id
            and active_account.user_id = link_token.user_id
          returning telegram_accounts.id
        ),
        consume_token as (
          update telegram_link_tokens
          set
            used_at = now(),
            consumed_by_telegram_user_id = request_input.telegram_user_id
          from request_input, validation
          where validation.error is null
            and telegram_link_tokens.token_hash = request_input.token_hash
          returning telegram_link_tokens.user_id
        ),
        inserted_account as (
          insert into telegram_accounts (
            user_id,
            telegram_user_id,
            linked_at,
            last_seen_at
          )
          select
            consume_token.user_id,
            request_input.telegram_user_id,
            now(),
            now()
          from consume_token, request_input
          returning id::text, user_id, telegram_user_id, linked_at, revoked_at
        )
        select
          validation.error is null as ok,
          validation.error,
          inserted_account.id,
          inserted_account.user_id,
          inserted_account.telegram_user_id,
          inserted_account.linked_at,
          inserted_account.revoked_at
        from validation
        left join inserted_account on validation.error is null
        limit 1
      `;

  return rowToConsumeResult(rows[0]);
}

export function createNeonTelegramCoachRepository(
  sql: SqlQueryExecutor,
): NeonTelegramCoachRepository {
  return {
    async claimUpdate(input) {
      const rows = await sql`
        insert into telegram_processed_updates (
          telegram_update_id,
          telegram_user_id,
          telegram_chat_id,
          received_at
        )
        values (
          ${input.updateId},
          ${optionalTelegramId(input.telegramUserId)},
          ${optionalTelegramId(input.telegramChatId)},
          ${input.receivedAt}
        )
        on conflict (telegram_update_id) do nothing
        returning true as claimed
      `;

      return rows[0]?.claimed === true;
    },
    async createCheckIn(input) {
      const rows = await sql`
        with ensure_user as (
          insert into users (id)
          values (${input.userId})
          on conflict (id) do update set id = excluded.id
          returning id, email, name, timezone, created_at
        ),
        self_profile as (
          insert into health_profiles (
            display_name,
            linked_user_id,
            owner_user_id,
            profile_type,
            timezone,
            created_at
          )
          select
            coalesce(nullif(name, ''), nullif(email, ''), id),
            id,
            id,
            'self',
            coalesce(nullif(timezone, ''), 'UTC'),
            created_at
          from ensure_user
          where ${input.profileId ?? null}::uuid is null
          on conflict (linked_user_id) where linked_user_id is not null
          do update set owner_user_id = excluded.owner_user_id
          returning id
        ),
        resolved_profile as (
          select ${input.profileId ?? null}::uuid as id
          where ${input.profileId ?? null}::uuid is not null
          union all
          select id from self_profile
          union all
          select id from health_profiles
          where linked_user_id = ${input.userId}
          limit 1
        )
        insert into check_ins (
          user_id,
          profile_id,
          idempotency_key,
          checked_in_at,
          timezone,
          hunger,
          mood,
          energy,
          stress,
          cravings,
          notes,
          origin,
          provenance
        )
        values (
          ${input.userId},
          (select id from resolved_profile),
          ${input.idempotencyKey},
          ${input.checkedInAt},
          ${input.timezone},
          ${input.hunger},
          ${input.mood},
          ${input.energy},
          ${input.stress},
          ${input.cravings},
          ${input.notes},
          'telegram',
          ${JSON.stringify({ telegramUserId: input.telegramUserId })}::jsonb
        )
        on conflict (profile_id, idempotency_key)
        where profile_id is not null
        do update set idempotency_key = check_ins.idempotency_key
        returning
          id::text,
          user_id,
          profile_id::text,
          checked_in_at,
          hunger,
          mood,
          energy,
          stress,
          cravings,
          notes
      `;

      return rowToCheckIn(rows[0], input.telegramUserId);
    },
    async createMealLog(input) {
      const rows = await sql`
        with ensure_user as (
          insert into users (id)
          values (${input.userId})
          on conflict (id) do update set id = excluded.id
          returning id, email, name, timezone, created_at
        ),
        self_profile as (
          insert into health_profiles (
            display_name,
            linked_user_id,
            owner_user_id,
            profile_type,
            timezone,
            created_at
          )
          select
            coalesce(nullif(name, ''), nullif(email, ''), id),
            id,
            id,
            'self',
            coalesce(nullif(timezone, ''), 'UTC'),
            created_at
          from ensure_user
          where ${input.profileId ?? null}::uuid is null
          on conflict (linked_user_id) where linked_user_id is not null
          do update set owner_user_id = excluded.owner_user_id
          returning id
        ),
        resolved_profile as (
          select ${input.profileId ?? null}::uuid as id
          where ${input.profileId ?? null}::uuid is not null
          union all
          select id from self_profile
          union all
          select id from health_profiles
          where linked_user_id = ${input.userId}
          limit 1
        )
        insert into meals (
          user_id,
          profile_id,
          idempotency_key,
          occurred_at,
          timezone,
          description,
          origin,
          provenance
        )
        values (
          ${input.userId},
          (select id from resolved_profile),
          ${input.idempotencyKey},
          ${input.occurredAt},
          ${input.timezone},
          ${input.text},
          'telegram',
          ${JSON.stringify({ telegramUserId: input.telegramUserId })}::jsonb
        )
        on conflict (profile_id, idempotency_key)
        where profile_id is not null
        do update set idempotency_key = meals.idempotency_key
        returning
          id::text,
          user_id,
          profile_id::text,
          description,
          occurred_at
      `;

      return rowToMealLog(rows[0], input.telegramUserId);
    },
    async listCheckIns(input) {
      const rows = await sql`
        select
          id::text,
          user_id,
          profile_id::text,
          provenance->>'telegramUserId' as telegram_user_id,
          checked_in_at,
          hunger,
          mood,
          energy,
          stress,
          cravings,
          notes
        from check_ins
        where user_id = ${input.userId}
          and (
            profile_id = ${input.profileId ?? null}::uuid
            or (
              ${input.profileId ?? null}::uuid is null
              and (
                profile_id is null
                or user_id = ${input.userId}
              )
            )
          )
          and checked_in_at >= ${input.range.from}
          and checked_in_at < ${input.range.to}
        order by checked_in_at asc, id asc
      `;

      return rows.map((row) =>
        rowToCheckIn(row, numberColumn(row, "telegram_user_id")),
      );
    },
    async listMealLogs(input) {
      const rows = await sql`
        select
          id::text,
          user_id,
          profile_id::text,
          provenance->>'telegramUserId' as telegram_user_id,
          description,
          occurred_at
        from meals
        where user_id = ${input.userId}
          and (
            profile_id = ${input.profileId ?? null}::uuid
            or (
              ${input.profileId ?? null}::uuid is null
              and (
                profile_id is null
                or user_id = ${input.userId}
              )
            )
          )
          and occurred_at >= ${input.range.from}
          and occurred_at < ${input.range.to}
        order by occurred_at asc, id asc
      `;

      return rows.map((row) =>
        rowToMealLog(row, numberColumn(row, "telegram_user_id")),
      );
    },
  };
}

export function createNeonTelegramReminderRepository(
  sql: SqlQueryExecutor,
): NeonTelegramReminderRepository {
  return {
    async upsertPreferences(preferences) {
      const rows = await sql`
        with ensure_user as (
          insert into users (id)
          values (${preferences.userId})
          on conflict (id) do nothing
        )
        insert into telegram_reminder_preferences (
          user_id,
          enabled,
          timezone,
          slots,
          quiet_hours,
          last_sent_at_by_slot
        )
        values (
          ${preferences.userId},
          ${preferences.enabled},
          ${preferences.timezone},
          ${JSON.stringify(preferences.slots)}::jsonb,
          ${optionalJsonInput(preferences.quietHours)}::jsonb,
          ${JSON.stringify(preferences.lastSentAtBySlot)}::jsonb
        )
        on conflict (user_id)
        do update set
          enabled = excluded.enabled,
          timezone = excluded.timezone,
          slots = excluded.slots,
          quiet_hours = excluded.quiet_hours,
          last_sent_at_by_slot = excluded.last_sent_at_by_slot
        returning
          user_id,
          enabled,
          timezone,
          slots,
          quiet_hours,
          last_sent_at_by_slot
      `;

      return rowToReminderPreferences(rows[0]);
    },
    async findPreferencesByUserId(userId) {
      const rows = await sql`
        select
          user_id,
          enabled,
          timezone,
          slots,
          quiet_hours,
          last_sent_at_by_slot
        from telegram_reminder_preferences
        where user_id = ${userId}
      `;

      return rows[0] === undefined
        ? undefined
        : rowToReminderPreferences(rows[0]);
    },
    async claimReminderSlot(input) {
      const rows = await sql`
        update telegram_reminder_preferences
        set last_sent_at_by_slot = jsonb_set(
          last_sent_at_by_slot,
          array[${input.slotId}],
          to_jsonb(${input.sentAt}::text),
          true
        )
        where user_id = ${input.userId}
          and enabled = true
          and timezone = ${input.timezone}
          and (
            last_sent_at_by_slot ->> ${input.slotId} is null
            or to_char(
              ((last_sent_at_by_slot ->> ${input.slotId})::timestamptz at time zone ${input.timezone}),
              'YYYY-MM-DD'
            ) <> ${input.localDate}
          )
        returning
          user_id,
          enabled,
          timezone,
          slots,
          quiet_hours,
          last_sent_at_by_slot
      `;

      return rows[0] === undefined
        ? undefined
        : rowToReminderPreferences(rows[0]);
    },
    async listPreferences() {
      const rows = await sql`
        select
          user_id,
          enabled,
          timezone,
          slots,
          quiet_hours,
          last_sent_at_by_slot
        from telegram_reminder_preferences
        order by user_id asc
      `;

      return rows.map(rowToReminderPreferences);
    },
    async listReminderCandidates() {
      const rows = await sql`
        select
          telegram_reminder_preferences.user_id,
          telegram_accounts.telegram_user_id,
          coalesce(
            telegram_accounts.telegram_chat_id,
            telegram_accounts.telegram_user_id
          ) as telegram_chat_id,
          telegram_reminder_preferences.enabled,
          telegram_reminder_preferences.timezone,
          telegram_reminder_preferences.slots,
          telegram_reminder_preferences.quiet_hours,
          telegram_reminder_preferences.last_sent_at_by_slot
        from telegram_reminder_preferences
        join telegram_accounts
          on telegram_accounts.user_id = telegram_reminder_preferences.user_id
        where telegram_accounts.revoked_at is null
          and telegram_reminder_preferences.enabled = true
        order by telegram_reminder_preferences.user_id asc
      `;

      return rows.map(rowToReminderPlanCandidate);
    },
  };
}

function rowToConsumeResult(
  row: Record<string, unknown> | undefined,
): TelegramLinkConsumeResult {
  if (row === undefined) {
    return { ok: false, error: "not-found" };
  }

  if (row.ok === true) {
    return {
      ok: true,
      account: rowToAccount(row),
    };
  }

  return {
    ok: false,
    error: linkConsumeError(row.error),
  };
}

function rowToAccount(row: Record<string, unknown>): TelegramAccount {
  const revokedAt = nullableTimestampColumn(row, "revoked_at");

  return {
    id: stringColumn(row, "id"),
    userId: stringColumn(row, "user_id"),
    telegramUserId: Number.parseInt(stringColumn(row, "telegram_user_id"), 10),
    linkedAt: timestampColumn(row, "linked_at"),
    active: revokedAt === undefined,
    ...(revokedAt === undefined ? {} : { revokedAt }),
  };
}

function rowToCheckIn(
  row: Record<string, unknown> | undefined,
  telegramUserId: number,
): TelegramCheckIn {
  if (row === undefined) {
    throw new Error("Telegram check-in repository did not return a row.");
  }

  return {
    id: stringColumn(row, "id"),
    userId: stringColumn(row, "user_id"),
    profileId: optionalStringColumn(row, "profile_id"),
    telegramUserId,
    hunger: numberColumn(row, "hunger"),
    mood: numberColumn(row, "mood"),
    energy: numberColumn(row, "energy"),
    stress: numberColumn(row, "stress"),
    cravings: numberColumn(row, "cravings"),
    notes: optionalStringColumn(row, "notes") ?? "",
    createdAt: timestampColumn(row, "checked_in_at"),
  };
}

function rowToMealLog(
  row: Record<string, unknown> | undefined,
  telegramUserId: number,
): TelegramMealLog {
  if (row === undefined) {
    throw new Error("Telegram meal repository did not return a row.");
  }

  return {
    id: stringColumn(row, "id"),
    userId: stringColumn(row, "user_id"),
    profileId: optionalStringColumn(row, "profile_id"),
    telegramUserId,
    text: optionalStringColumn(row, "description") ?? "",
    createdAt: timestampColumn(row, "occurred_at"),
  };
}

function rowToReminderPlanCandidate(
  row: Record<string, unknown>,
): TelegramReminderPlanCandidate {
  return {
    userId: stringColumn(row, "user_id"),
    telegramUserId: Number.parseInt(stringColumn(row, "telegram_user_id"), 10),
    telegramChatId: Number.parseInt(stringColumn(row, "telegram_chat_id"), 10),
    preferences: rowToReminderPreferences(row),
  };
}

function rowToReminderPreferences(
  row: Record<string, unknown> | undefined,
): TelegramReminderPreferences {
  if (row === undefined) {
    throw new Error("Telegram reminder repository did not return a row.");
  }

  const quietHours = quietHoursColumn(row, "quiet_hours");

  return {
    userId: stringColumn(row, "user_id"),
    enabled: booleanColumn(row, "enabled"),
    timezone: stringColumn(row, "timezone"),
    slots: reminderSlotsColumn(row, "slots"),
    ...(quietHours === undefined ? {} : { quietHours }),
    lastSentAtBySlot: stringRecordColumn(row, "last_sent_at_by_slot"),
  };
}

function linkConsumeError(value: unknown): TelegramLinkConsumeError {
  if (
    value === "account-mismatch" ||
    value === "expired" ||
    value === "nonce-mismatch" ||
    value === "not-found" ||
    value === "state-mismatch" ||
    value === "used"
  ) {
    return value;
  }

  return "not-found";
}

function optionalJsonInput(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function stringColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];

  if (typeof value !== "string") {
    throw new Error(`Expected ${column} to be a string.`);
  }

  return value;
}

function booleanColumn(row: Record<string, unknown>, column: string): boolean {
  const value = row[column];

  if (typeof value !== "boolean") {
    throw new Error(`Expected ${column} to be a boolean.`);
  }

  return value;
}

function optionalStringColumn(
  row: Record<string, unknown>,
  column: string,
): string | undefined {
  const value = row[column];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Expected ${column} to be a string.`);
  }

  return value;
}

function numberColumn(row: Record<string, unknown>, column: string): number {
  const value = row[column];
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected ${column} to be a finite number.`);
  }

  return parsed;
}

function reminderSlotsColumn(
  row: Record<string, unknown>,
  column: string,
): readonly TelegramReminderSlot[] {
  const value = jsonColumn(row, column);

  if (!Array.isArray(value)) {
    throw new Error(`Expected ${column} to be an array.`);
  }

  return value.map((slot) => {
    if (!isRecord(slot)) {
      throw new Error(`Expected ${column} entries to be objects.`);
    }

    const kind = slot.kind;

    if (kind !== "checkin") {
      throw new Error(`Expected ${column} kind to be checkin.`);
    }

    return {
      id: stringJsonField(slot, "id"),
      kind,
      localTime: stringJsonField(slot, "localTime"),
    };
  });
}

function quietHoursColumn(
  row: Record<string, unknown>,
  column: string,
): TelegramQuietHours | undefined {
  const value = jsonColumn(row, column);

  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Expected ${column} to be an object.`);
  }

  return {
    start: stringJsonField(value, "start"),
    end: stringJsonField(value, "end"),
  };
}

function stringRecordColumn(
  row: Record<string, unknown>,
  column: string,
): Readonly<Record<string, string>> {
  const value = jsonColumn(row, column);

  if (!isRecord(value)) {
    throw new Error(`Expected ${column} to be an object.`);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, recordValue]) => {
      if (typeof recordValue !== "string") {
        throw new Error(`Expected ${column}.${key} to be a string.`);
      }

      return [key, recordValue];
    }),
  );
}

function jsonColumn(
  row: Record<string, unknown>,
  column: string,
): unknown | undefined {
  const value = row[column];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return JSON.parse(value) as unknown;
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringJsonField(row: Record<string, unknown>, field: string): string {
  const value = row[field];

  if (typeof value !== "string") {
    throw new Error(`Expected ${field} to be a string.`);
  }

  return value;
}

function timestampColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }

  throw new Error(`Expected ${column} to be a timestamp.`);
}

function nullableTimestampColumn(
  row: Record<string, unknown>,
  column: string,
): string | undefined {
  const value = row[column];

  if (value === null || value === undefined) {
    return undefined;
  }

  return timestampColumn(row, column);
}

function sha256TokenHash(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

function optionalTelegramId(id: number | undefined): string | null {
  return id === undefined ? null : String(id);
}
