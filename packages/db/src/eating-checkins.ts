import type { SqlQueryExecutor } from "./health-samples.js";

export const EATING_CONTEXTS = [
  "physical_hunger",
  "emotional_eating",
  "habit",
  "social",
  "boredom",
  "stress",
  "fatigue",
  "screen_eating",
  "unknown",
] as const;

export type EatingContext = (typeof EATING_CONTEXTS)[number];

export type EatingCheckInInput = Readonly<{
  userId: string;
  profileId?: string | undefined;
  idempotencyKey?: string | undefined;
  occurredAt: string;
  timezone: string;
  linkedMealId?: string | undefined;
  linkedPlannedMealId?: string | undefined;
  hungerBefore?: number | undefined;
  fullnessAfter?: number | undefined;
  urgeIntensity?: number | undefined;
  emotionIntensity?: number | undefined;
  emotions?: readonly string[] | undefined;
  triggers?: readonly string[] | undefined;
  automaticThought?: string | undefined;
  balancedResponse?: string | undefined;
  eatingContext?: EatingContext | undefined;
  lossOfControl?: boolean | undefined;
  ateUntilPain?: boolean | undefined;
  ateWithScreen?: boolean | undefined;
  ateFromPackage?: boolean | undefined;
  tookSecondServing?: boolean | undefined;
  copingAction?: string | undefined;
  urgeDelayMinutes?: number | undefined;
  outcome?: string | undefined;
  note?: string | undefined;
}>;

export type EatingCheckInPatch = Partial<
  Omit<EatingCheckInInput, "idempotencyKey" | "profileId" | "userId">
>;

export type EatingCheckIn = Readonly<{
  id: string;
  userId: string;
  profileId?: string | undefined;
  idempotencyKey?: string | undefined;
  occurredAt: string;
  timezone: string;
  linkedMealId?: string | undefined;
  linkedPlannedMealId?: string | undefined;
  hungerBefore?: number | undefined;
  fullnessAfter?: number | undefined;
  urgeIntensity?: number | undefined;
  emotionIntensity?: number | undefined;
  emotions: readonly string[];
  triggers: readonly string[];
  automaticThought?: string | undefined;
  balancedResponse?: string | undefined;
  eatingContext?: EatingContext | undefined;
  lossOfControl?: boolean | undefined;
  ateUntilPain?: boolean | undefined;
  ateWithScreen?: boolean | undefined;
  ateFromPackage?: boolean | undefined;
  tookSecondServing?: boolean | undefined;
  copingAction?: string | undefined;
  urgeDelayMinutes?: number | undefined;
  outcome?: string | undefined;
  note?: string | undefined;
  createdAt: string;
  updatedAt: string;
}>;

export type EatingCheckInListInput = Readonly<{
  userId: string;
  profileId?: string | undefined;
  range?: Readonly<{ from: string; to: string }> | undefined;
  linkedMealId?: string | undefined;
  linkedPlannedMealId?: string | undefined;
  limit?: number | undefined;
}>;

export type EatingCheckInRepository = Readonly<{
  createCheckIn(input: EatingCheckInInput): Promise<EatingCheckIn>;
  updateCheckIn(input: {
    userId: string;
    profileId?: string | undefined;
    checkInId: string;
    patch: EatingCheckInPatch;
  }): Promise<EatingCheckIn | undefined>;
  listCheckIns(
    input: EatingCheckInListInput,
  ): Promise<readonly EatingCheckIn[]>;
  getLatestCheckIn(input: {
    userId: string;
    profileId?: string | undefined;
  }): Promise<EatingCheckIn | undefined>;
  linkCheckInToMeal(input: {
    userId: string;
    profileId?: string | undefined;
    checkInId: string;
    linkedMealId?: string | undefined;
    linkedPlannedMealId?: string | undefined;
  }): Promise<EatingCheckIn | undefined>;
}>;

export function createNeonEatingCheckInRepository(
  sql: SqlQueryExecutor,
): EatingCheckInRepository {
  return {
    async createCheckIn(input) {
      if (input.idempotencyKey !== undefined) {
        const replay = await selectByIdempotencyKey(sql, input);
        if (replay !== undefined) return replay;
      }

      const rows = await sql`
        with ensure_user as (
          insert into users (id)
          values (${input.userId}::text)
          on conflict (id) do nothing
        )
        insert into eating_checkins (
          user_id,
          profile_id,
          idempotency_key,
          occurred_at,
          timezone,
          linked_meal_id,
          linked_planned_meal_id,
          hunger_before,
          fullness_after,
          urge_intensity,
          emotion_intensity,
          emotions,
          triggers,
          automatic_thought,
          balanced_response,
          eating_context,
          loss_of_control,
          ate_until_pain,
          ate_with_screen,
          ate_from_package,
          took_second_serving,
          coping_action,
          urge_delay_minutes,
          outcome,
          note
        )
        values (
          ${input.userId}::text,
          ${input.profileId ?? null}::uuid,
          ${input.idempotencyKey ?? null}::text,
          ${input.occurredAt}::timestamptz,
          ${input.timezone}::text,
          ${input.linkedMealId ?? null}::uuid,
          ${input.linkedPlannedMealId ?? null}::uuid,
          ${input.hungerBefore ?? null}::integer,
          ${input.fullnessAfter ?? null}::integer,
          ${input.urgeIntensity ?? null}::integer,
          ${input.emotionIntensity ?? null}::integer,
          ${input.emotions ?? []}::text[],
          ${input.triggers ?? []}::text[],
          ${input.automaticThought ?? null}::text,
          ${input.balancedResponse ?? null}::text,
          ${input.eatingContext ?? null}::text,
          ${input.lossOfControl ?? null}::boolean,
          ${input.ateUntilPain ?? null}::boolean,
          ${input.ateWithScreen ?? null}::boolean,
          ${input.ateFromPackage ?? null}::boolean,
          ${input.tookSecondServing ?? null}::boolean,
          ${input.copingAction ?? null}::text,
          ${input.urgeDelayMinutes ?? null}::integer,
          ${input.outcome ?? null}::text,
          ${input.note ?? null}::text
        )
        on conflict (profile_id, idempotency_key)
        where profile_id is not null and idempotency_key is not null
        do nothing
        returning *
      `;

      if (rows[0] !== undefined) return rowToEatingCheckIn(rows[0]);

      const replay = await selectByIdempotencyKey(sql, input);
      if (replay !== undefined) return replay;
      throw new Error(
        "Eating check-in insert conflicted but no row was found.",
      );
    },
    async updateCheckIn(input) {
      const patch = input.patch;
      const rows = await sql`
        update eating_checkins
        set
          occurred_at = coalesce(${patch.occurredAt ?? null}::timestamptz, occurred_at),
          timezone = coalesce(${patch.timezone ?? null}::text, timezone),
          linked_meal_id = coalesce(${patch.linkedMealId ?? null}::uuid, linked_meal_id),
          linked_planned_meal_id = coalesce(${patch.linkedPlannedMealId ?? null}::uuid, linked_planned_meal_id),
          hunger_before = coalesce(${patch.hungerBefore ?? null}::integer, hunger_before),
          fullness_after = coalesce(${patch.fullnessAfter ?? null}::integer, fullness_after),
          urge_intensity = coalesce(${patch.urgeIntensity ?? null}::integer, urge_intensity),
          emotion_intensity = coalesce(${patch.emotionIntensity ?? null}::integer, emotion_intensity),
          emotions = coalesce(${patch.emotions ?? null}::text[], emotions),
          triggers = coalesce(${patch.triggers ?? null}::text[], triggers),
          automatic_thought = coalesce(${patch.automaticThought ?? null}::text, automatic_thought),
          balanced_response = coalesce(${patch.balancedResponse ?? null}::text, balanced_response),
          eating_context = coalesce(${patch.eatingContext ?? null}::text, eating_context),
          loss_of_control = coalesce(${patch.lossOfControl ?? null}::boolean, loss_of_control),
          ate_until_pain = coalesce(${patch.ateUntilPain ?? null}::boolean, ate_until_pain),
          ate_with_screen = coalesce(${patch.ateWithScreen ?? null}::boolean, ate_with_screen),
          ate_from_package = coalesce(${patch.ateFromPackage ?? null}::boolean, ate_from_package),
          took_second_serving = coalesce(${patch.tookSecondServing ?? null}::boolean, took_second_serving),
          coping_action = coalesce(${patch.copingAction ?? null}::text, coping_action),
          urge_delay_minutes = coalesce(${patch.urgeDelayMinutes ?? null}::integer, urge_delay_minutes),
          outcome = coalesce(${patch.outcome ?? null}::text, outcome),
          note = coalesce(${patch.note ?? null}::text, note),
          updated_at = now()
        where user_id = ${input.userId}::text
          and (
            profile_id = ${input.profileId ?? null}::uuid
            or (
              ${input.profileId ?? null}::uuid is null
              and profile_id is null
            )
          )
          and id::text = ${input.checkInId}::text
        returning *
      `;

      return rows[0] === undefined ? undefined : rowToEatingCheckIn(rows[0]);
    },
    async listCheckIns(input) {
      const rows = await sql`
        select *
        from eating_checkins
        where user_id = ${input.userId}::text
          and (
            profile_id = ${input.profileId ?? null}::uuid
            or (
              ${input.profileId ?? null}::uuid is null
              and profile_id is null
            )
          )
          and (${input.range?.from ?? null}::timestamptz is null or occurred_at >= ${input.range?.from ?? null}::timestamptz)
          and (${input.range?.to ?? null}::timestamptz is null or occurred_at < ${input.range?.to ?? null}::timestamptz)
          and (${input.linkedMealId ?? null}::uuid is null or linked_meal_id = ${input.linkedMealId ?? null}::uuid)
          and (${input.linkedPlannedMealId ?? null}::uuid is null or linked_planned_meal_id = ${input.linkedPlannedMealId ?? null}::uuid)
        order by occurred_at desc, created_at desc
        limit ${Math.min(Math.max(input.limit ?? 100, 1), 500)}::integer
      `;

      return rows.map(rowToEatingCheckIn);
    },
    async getLatestCheckIn(input) {
      const rows = await this.listCheckIns({ ...input, limit: 1 });
      return rows[0];
    },
    async linkCheckInToMeal(input) {
      return this.updateCheckIn({
        userId: input.userId,
        profileId: input.profileId,
        checkInId: input.checkInId,
        patch: {
          linkedMealId: input.linkedMealId,
          linkedPlannedMealId: input.linkedPlannedMealId,
        },
      });
    },
  };
}

async function selectByIdempotencyKey(
  sql: SqlQueryExecutor,
  input: Pick<EatingCheckInInput, "idempotencyKey" | "profileId" | "userId">,
): Promise<EatingCheckIn | undefined> {
  if (input.idempotencyKey === undefined) return undefined;

  const rows = await sql`
    select *
    from eating_checkins
    where user_id = ${input.userId}::text
      and (
        profile_id = ${input.profileId ?? null}::uuid
        or (
          ${input.profileId ?? null}::uuid is null
          and profile_id is null
        )
      )
      and idempotency_key = ${input.idempotencyKey}::text
    limit 1
  `;

  return rows[0] === undefined ? undefined : rowToEatingCheckIn(rows[0]);
}

function rowToEatingCheckIn(row: Record<string, unknown>): EatingCheckIn {
  return {
    id: stringColumn(row, "id"),
    userId: stringColumn(row, "user_id"),
    profileId: optionalStringColumn(row, "profile_id"),
    idempotencyKey: optionalStringColumn(row, "idempotency_key"),
    occurredAt: timestampColumn(row, "occurred_at"),
    timezone: stringColumn(row, "timezone"),
    linkedMealId: optionalStringColumn(row, "linked_meal_id"),
    linkedPlannedMealId: optionalStringColumn(row, "linked_planned_meal_id"),
    hungerBefore: optionalNumberColumn(row, "hunger_before"),
    fullnessAfter: optionalNumberColumn(row, "fullness_after"),
    urgeIntensity: optionalNumberColumn(row, "urge_intensity"),
    emotionIntensity: optionalNumberColumn(row, "emotion_intensity"),
    emotions: stringArrayColumn(row, "emotions"),
    triggers: stringArrayColumn(row, "triggers"),
    automaticThought: optionalStringColumn(row, "automatic_thought"),
    balancedResponse: optionalStringColumn(row, "balanced_response"),
    eatingContext: optionalEatingContextColumn(row, "eating_context"),
    lossOfControl: optionalBooleanColumn(row, "loss_of_control"),
    ateUntilPain: optionalBooleanColumn(row, "ate_until_pain"),
    ateWithScreen: optionalBooleanColumn(row, "ate_with_screen"),
    ateFromPackage: optionalBooleanColumn(row, "ate_from_package"),
    tookSecondServing: optionalBooleanColumn(row, "took_second_serving"),
    copingAction: optionalStringColumn(row, "coping_action"),
    urgeDelayMinutes: optionalNumberColumn(row, "urge_delay_minutes"),
    outcome: optionalStringColumn(row, "outcome"),
    note: optionalStringColumn(row, "note"),
    createdAt: timestampColumn(row, "created_at"),
    updatedAt: timestampColumn(row, "updated_at"),
  };
}

function stringColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (typeof value !== "string")
    throw new Error(`Expected ${column} to be a string.`);
  return value;
}

function optionalStringColumn(
  row: Record<string, unknown>,
  column: string,
): string | undefined {
  const value = row[column];
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string")
    throw new Error(`Expected ${column} to be a string.`);
  return value;
}

function optionalNumberColumn(
  row: Record<string, unknown>,
  column: string,
): number | undefined {
  const value = row[column];
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed))
    throw new Error(`Expected ${column} to be numeric.`);
  return parsed;
}

function optionalBooleanColumn(
  row: Record<string, unknown>,
  column: string,
): boolean | undefined {
  const value = row[column];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "boolean")
    throw new Error(`Expected ${column} to be boolean.`);
  return value;
}

function optionalEatingContextColumn(
  row: Record<string, unknown>,
  column: string,
): EatingContext | undefined {
  const value = optionalStringColumn(row, column);
  if (value === undefined) return undefined;
  if (!(EATING_CONTEXTS as readonly string[]).includes(value)) {
    throw new Error(`Unexpected ${column}.`);
  }
  return value as EatingContext;
}

function stringArrayColumn(
  row: Record<string, unknown>,
  column: string,
): readonly string[] {
  const value = row[column];
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Expected ${column} array.`);
  return value.map((item) => {
    if (typeof item !== "string")
      throw new Error(`Expected ${column} item to be string.`);
    return item;
  });
}

function timestampColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new Error(`Expected ${column} timestamp.`);
}
