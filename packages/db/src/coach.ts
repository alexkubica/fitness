import type { SqlQueryExecutor } from "./health-samples.js";

export type { SqlQueryExecutor } from "./health-samples.js";

export type CoachGoal = "lose_weight" | "maintain" | "gain_mass";

export type CoachMealSlot = Readonly<{
  id: string;
  name: string;
  timeMinutes: number;
  remindersEnabled: boolean;
}>;

export type NutritionTargets = Readonly<{
  maintenanceCalories: number;
  loseCalories: number;
  maintainCalories: number;
  gainCalories: number;
  selectedCalories: number;
  proteinGrams: number;
  fatGrams: number;
  carbsGrams: number;
  fiberGrams: number;
}>;

export type CoachProfileInput = Readonly<{
  userId: string;
  profileId?: string | undefined;
  goal: CoachGoal;
  weightKg: number;
  estimatedStepsPerDay: number;
  estimatedActiveCaloriesPerDay?: number | undefined;
  estimatedRestingCaloriesPerDay?: number | undefined;
  wakeTimeMinutes: number;
  sleepTimeMinutes: number;
  mealRemindersEnabled: boolean;
  mealSlots: readonly CoachMealSlot[];
  targets: NutritionTargets;
  source: "ios" | "web" | "mcp";
  completedAt: string;
}>;

export type CoachProfile = CoachProfileInput &
  Readonly<{
    createdAt: string;
    updatedAt: string;
  }>;

export type NeonCoachRepository = Readonly<{
  getProfile(
    userId: string,
    profileId?: string | undefined,
  ): Promise<CoachProfile | undefined>;
  upsertProfile(input: CoachProfileInput): Promise<CoachProfile>;
}>;

export function createNeonCoachRepository(
  sql: SqlQueryExecutor,
): NeonCoachRepository {
  return {
    async getProfile(userId, profileId) {
      const rows = await sql`
        select *
        from coach_profiles
        where user_id = ${userId}::text
          and (
            profile_id = ${profileId ?? null}::uuid
            or (
              ${profileId ?? null}::uuid is null
              and (
                profile_id is null
                or user_id = ${userId}::text
              )
            )
          )
        order by
          case when profile_id = ${profileId ?? null}::uuid then 0 else 1 end,
          updated_at desc
        limit 1
      `;

      return rows[0] === undefined ? undefined : rowToCoachProfile(rows[0]);
    },
    async upsertProfile(input) {
      const slotsJson = JSON.stringify(input.mealSlots);
      const targetsJson = JSON.stringify(input.targets);
      const rows = await sql`
        with ensure_user as (
          insert into users (id)
          values (${input.userId}::text)
          on conflict (id) do nothing
        )
          insert into coach_profiles (
            user_id,
            profile_id,
            goal,
          weight_kg,
          estimated_steps_per_day,
          estimated_active_calories_per_day,
          estimated_resting_calories_per_day,
          wake_time_minutes,
          sleep_time_minutes,
          meal_reminders_enabled,
          meal_slots,
          targets,
          source,
          completed_at
        )
        values (
          ${input.userId}::text,
          ${input.profileId ?? null}::uuid,
          ${input.goal}::text,
          ${input.weightKg}::numeric,
          ${input.estimatedStepsPerDay}::integer,
          ${input.estimatedActiveCaloriesPerDay ?? null}::numeric,
          ${input.estimatedRestingCaloriesPerDay ?? null}::numeric,
          ${input.wakeTimeMinutes}::integer,
          ${input.sleepTimeMinutes}::integer,
          ${input.mealRemindersEnabled}::boolean,
          ${slotsJson}::jsonb,
          ${targetsJson}::jsonb,
          ${input.source}::text,
          ${input.completedAt}::timestamptz
        )
        on conflict (profile_id)
        where profile_id is not null
        do update set
          goal = excluded.goal,
          weight_kg = excluded.weight_kg,
          estimated_steps_per_day = excluded.estimated_steps_per_day,
          estimated_active_calories_per_day = excluded.estimated_active_calories_per_day,
          estimated_resting_calories_per_day = excluded.estimated_resting_calories_per_day,
          wake_time_minutes = excluded.wake_time_minutes,
          sleep_time_minutes = excluded.sleep_time_minutes,
          meal_reminders_enabled = excluded.meal_reminders_enabled,
          meal_slots = excluded.meal_slots,
          targets = excluded.targets,
          source = excluded.source,
          completed_at = excluded.completed_at,
          updated_at = now()
        returning *
      `;

      return rowToCoachProfile(rows[0]);
    },
  };
}

function rowToCoachProfile(
  row: Record<string, unknown> | undefined,
): CoachProfile {
  if (row === undefined) {
    throw new Error("Coach repository did not return a profile row.");
  }

  return {
    userId: stringColumn(row, "user_id"),
    profileId: optionalStringColumn(row, "profile_id"),
    goal: coachGoalColumn(row, "goal"),
    weightKg: numberColumn(row, "weight_kg"),
    estimatedStepsPerDay: numberColumn(row, "estimated_steps_per_day"),
    estimatedActiveCaloriesPerDay: optionalNumberColumn(
      row,
      "estimated_active_calories_per_day",
    ),
    estimatedRestingCaloriesPerDay: optionalNumberColumn(
      row,
      "estimated_resting_calories_per_day",
    ),
    wakeTimeMinutes: numberColumn(row, "wake_time_minutes"),
    sleepTimeMinutes: numberColumn(row, "sleep_time_minutes"),
    mealRemindersEnabled: booleanColumn(row, "meal_reminders_enabled"),
    mealSlots: mealSlotsColumn(row, "meal_slots"),
    targets: targetsColumn(row, "targets"),
    source: sourceColumn(row, "source"),
    completedAt: timestampColumn(row, "completed_at"),
    createdAt: timestampColumn(row, "created_at"),
    updatedAt: timestampColumn(row, "updated_at"),
  };
}

function mealSlotsColumn(
  row: Record<string, unknown>,
  column: string,
): readonly CoachMealSlot[] {
  const value = jsonColumn(row, column);

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((slot) => {
    if (!isRecord(slot)) {
      return [];
    }

    return [
      {
        id: stringColumn(slot, "id"),
        name: stringColumn(slot, "name"),
        timeMinutes: numberColumn(slot, "timeMinutes"),
        remindersEnabled: booleanColumn(slot, "remindersEnabled"),
      },
    ];
  });
}

function targetsColumn(
  row: Record<string, unknown>,
  column: string,
): NutritionTargets {
  const value = jsonRecordColumn(row, column);

  return {
    maintenanceCalories: numberColumn(value, "maintenanceCalories"),
    loseCalories: numberColumn(value, "loseCalories"),
    maintainCalories: numberColumn(value, "maintainCalories"),
    gainCalories: numberColumn(value, "gainCalories"),
    selectedCalories: numberColumn(value, "selectedCalories"),
    proteinGrams: numberColumn(value, "proteinGrams"),
    fatGrams: numberColumn(value, "fatGrams"),
    carbsGrams: numberColumn(value, "carbsGrams"),
    fiberGrams: numberColumn(value, "fiberGrams"),
  };
}

function jsonRecordColumn(
  row: Record<string, unknown>,
  column: string,
): Record<string, unknown> {
  const value = jsonColumn(row, column);

  if (!isRecord(value)) {
    throw new Error(`Expected ${column} to be an object.`);
  }

  return value;
}

function jsonColumn(row: Record<string, unknown>, column: string): unknown {
  const value = row[column];

  if (typeof value === "string") {
    return JSON.parse(value) as unknown;
  }

  return value;
}

function coachGoalColumn(
  row: Record<string, unknown>,
  column: string,
): CoachGoal {
  const value = stringColumn(row, column);

  if (
    value === "lose_weight" ||
    value === "maintain" ||
    value === "gain_mass"
  ) {
    return value;
  }

  throw new Error(`Unexpected coach goal "${value}".`);
}

function sourceColumn(
  row: Record<string, unknown>,
  column: string,
): CoachProfileInput["source"] {
  const value = stringColumn(row, column);

  if (value === "ios" || value === "web" || value === "mcp") {
    return value;
  }

  return "web";
}

function stringColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];

  if (typeof value !== "string") {
    throw new Error(`Expected ${column} to be a string.`);
  }

  return value;
}

function optionalStringColumn(
  row: Record<string, unknown>,
  column: string,
): string | undefined {
  const value = row[column];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Expected ${column} to be a string.`);
  }

  return value;
}

function numberColumn(row: Record<string, unknown>, column: string): number {
  const value = row[column];

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error(`Expected ${column} to be numeric.`);
}

function optionalNumberColumn(
  row: Record<string, unknown>,
  column: string,
): number | undefined {
  const value = row[column];

  if (value === undefined || value === null) {
    return undefined;
  }

  return numberColumn(row, column);
}

function booleanColumn(row: Record<string, unknown>, column: string): boolean {
  const value = row[column];

  if (typeof value !== "boolean") {
    throw new Error(`Expected ${column} to be a boolean.`);
  }

  return value;
}

function timestampColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return new Date(value).toISOString();
  }

  throw new Error(`Expected ${column} to be a timestamp.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
