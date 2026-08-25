import type { SqlQueryExecutor } from "./health-samples.js";

export type { SqlQueryExecutor } from "./health-samples.js";

export type MealMacroTotals = Readonly<{
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
  fiberGrams: number;
}>;

export type MealIngredientInput = Readonly<{
  clientIngredientId?: string | undefined;
  name: string;
  quantity: number;
  unit: string;
  grams?: number | undefined;
  totals: MealMacroTotals;
}>;

export type MealIngredient = MealIngredientInput &
  Readonly<{
    id: string;
    position: number;
  }>;

export type MealLogInput = Readonly<{
  userId: string;
  profileId?: string | undefined;
  idempotencyKey: string;
  clientMealId?: string | undefined;
  occurredAt: string;
  timezone: string;
  title: string;
  mealType: string;
  note?: string | undefined;
  totals: MealMacroTotals;
  ingredients: readonly MealIngredientInput[];
  photoCount: number;
  estimateStatus: "manual" | "ai_estimated" | "estimation_failed";
  estimateConfidence?: number | undefined;
  estimateSummary?: string | undefined;
  origin: "ios" | "web" | "telegram" | "mcp";
  provenance?: Readonly<Record<string, unknown>> | undefined;
}>;

export type MealLog = Readonly<{
  id: string;
  userId: string;
  profileId?: string | undefined;
  idempotencyKey: string;
  clientMealId?: string | undefined;
  occurredAt: string;
  timezone: string;
  title: string;
  mealType: string;
  note: string;
  totals: MealMacroTotals;
  ingredients: readonly MealIngredient[];
  photoCount: number;
  estimateStatus: "manual" | "ai_estimated" | "estimation_failed";
  estimateConfidence?: number | undefined;
  estimateSummary?: string | undefined;
  origin: string;
  createdAt: string;
  updatedAt: string;
}>;

export type MealLogUpsertOperation = "created" | "updated" | "unchanged";

export type MealLogUpsertResult = Readonly<{
  meal: MealLog;
  operation: MealLogUpsertOperation;
  mealId: string;
}>;

export type MealLogListInput = Readonly<{
  userId: string;
  profileId?: string | undefined;
  range?: Readonly<{
    from: string;
    to: string;
  }>;
  limit?: number;
}>;

export type MealLogSnapshotState = Readonly<{
  meals: readonly MealLog[];
  totals: MealMacroTotals;
}>;

export type MealLogSnapshotInput = Readonly<{
  userId: string;
  profileId?: string | undefined;
  operationType: string;
  affectedLocalDate: string;
  timezone: string;
  beforeState: MealLogSnapshotState;
  afterState?: MealLogSnapshotState | undefined;
  source: "ios" | "web" | "mcp" | "assistant" | "telegram" | "server";
  description: string;
  createdAt?: string | undefined;
  expiresAt?: string | undefined;
}>;

export type MealLogSnapshot = MealLogSnapshotInput &
  Readonly<{
    id: string;
    createdAt: string;
    expiresAt: string;
  }>;

export type MealLogSnapshotListInput = Readonly<{
  userId: string;
  profileId?: string | undefined;
  date?: string | undefined;
  includeExpired?: boolean | undefined;
  limit?: number | undefined;
  now?: string | undefined;
}>;

export type MealDeleteInput = Readonly<{
  userId: string;
  profileId?: string | undefined;
  id: string;
  deletedAt: string;
}>;

export type SavedMealTemplateInput = Readonly<{
  userId: string;
  profileId?: string | undefined;
  clientTemplateId: string;
  title: string;
  mealType: string;
  note?: string | undefined;
  totals: MealMacroTotals;
  ingredients: readonly MealIngredientInput[];
  usageCount?: number | undefined;
  lastUsedAt: string;
}>;

export type SavedMealTemplate = Readonly<{
  id: string;
  userId: string;
  profileId?: string | undefined;
  clientTemplateId: string;
  title: string;
  mealType: string;
  note: string;
  totals: MealMacroTotals;
  ingredients: readonly MealIngredientInput[];
  usageCount: number;
  lastUsedAt: string;
  createdAt: string;
  updatedAt: string;
}>;

export type NeonMealRepository = Readonly<{
  upsertMeal(input: MealLogInput): Promise<MealLog>;
  upsertMealWithResult(input: MealLogInput): Promise<MealLogUpsertResult>;
  deleteMeal(input: MealDeleteInput): Promise<MealLog | undefined>;
  listMeals(input: MealLogListInput): Promise<readonly MealLog[]>;
  createSnapshot(input: MealLogSnapshotInput): Promise<MealLogSnapshot>;
  getSnapshot(input: {
    userId: string;
    profileId?: string | undefined;
    snapshotId: string;
  }): Promise<MealLogSnapshot | undefined>;
  listSnapshots(
    input: MealLogSnapshotListInput,
  ): Promise<readonly MealLogSnapshot[]>;
  upsertTemplate(input: SavedMealTemplateInput): Promise<SavedMealTemplate>;
  listTemplates(input: {
    userId: string;
    profileId?: string | undefined;
    limit?: number;
  }): Promise<readonly SavedMealTemplate[]>;
}>;

type MealIngredientJson = MealIngredientInput &
  Readonly<{
    ordinal: number;
  }>;

export function createNeonMealRepository(
  sql: SqlQueryExecutor,
): NeonMealRepository {
  return {
    async upsertMeal(input) {
      return (await upsertMealLogWithResult(sql, input)).meal;
    },
    async upsertMealWithResult(input) {
      return upsertMealLogWithResult(sql, input);
    },
    async deleteMeal(input) {
      const rows = await sql`
        with deleted_meal as (
          update meals
          set deleted_at = ${input.deletedAt}::timestamptz,
              updated_at = now()
          where user_id = ${input.userId}::text
            and (
              profile_id = ${input.profileId ?? null}::uuid
              or (
                ${input.profileId ?? null}::uuid is null
                and profile_id is null
              )
            )
            and deleted_at is null
            and (
              id::text = ${input.id}::text
              or client_meal_id = ${input.id}::text
            )
          returning *
        )
        select
          deleted_meal.*,
          coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'id',
                  meal_ingredients.id::text,
                  'clientIngredientId',
                  meal_ingredients.client_ingredient_id,
                  'position',
                  meal_ingredients.position,
                  'name',
                  meal_ingredients.name,
                  'quantity',
                  meal_ingredients.quantity,
                  'unit',
                  meal_ingredients.unit,
                  'grams',
                  meal_ingredients.grams,
                  'calories',
                  meal_ingredients.calories,
                  'proteinGrams',
                  meal_ingredients.protein_grams,
                  'carbsGrams',
                  meal_ingredients.carbs_grams,
                  'fatGrams',
                  meal_ingredients.fat_grams,
                  'fiberGrams',
                  meal_ingredients.fiber_grams
                )
                order by position
              )
              from meal_ingredients
              where meal_ingredients.meal_id = deleted_meal.id
            ),
            '[]'::jsonb
          ) as ingredients
        from deleted_meal
      `;

      return rows[0] === undefined ? undefined : rowToMealLog(rows[0]);
    },
    async listMeals(input) {
      const rows = await sql`
        select
          meals.*,
          coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'id',
                  meal_ingredients.id::text,
                  'clientIngredientId',
                  meal_ingredients.client_ingredient_id,
                  'position',
                  meal_ingredients.position,
                  'name',
                  meal_ingredients.name,
                  'quantity',
                  meal_ingredients.quantity,
                  'unit',
                  meal_ingredients.unit,
                  'grams',
                  meal_ingredients.grams,
                  'calories',
                  meal_ingredients.calories,
                  'proteinGrams',
                  meal_ingredients.protein_grams,
                  'carbsGrams',
                  meal_ingredients.carbs_grams,
                  'fatGrams',
                  meal_ingredients.fat_grams,
                  'fiberGrams',
                  meal_ingredients.fiber_grams
                )
                order by position
              )
              from meal_ingredients
              where meal_ingredients.meal_id = meals.id
            ),
            '[]'::jsonb
          ) as ingredients
        from meals
        where meals.user_id = ${input.userId}::text
          and (
            meals.profile_id = ${input.profileId ?? null}::uuid
            or (
              ${input.profileId ?? null}::uuid is null
              and (
                meals.profile_id is null
                or meals.user_id = ${input.userId}::text
              )
            )
          )
          and meals.deleted_at is null
          and (${input.range?.from ?? null}::timestamptz is null or meals.occurred_at >= ${input.range?.from ?? null}::timestamptz)
          and (${input.range?.to ?? null}::timestamptz is null or meals.occurred_at < ${input.range?.to ?? null}::timestamptz)
        order by meals.occurred_at desc
        limit ${Math.min(Math.max(input.limit ?? 250, 1), 1_000)}::integer
      `;

      return rows.map(rowToMealLog);
    },
    async createSnapshot(input) {
      const createdAt = new Date(input.createdAt ?? Date.now()).toISOString();
      const expiresAt =
        input.expiresAt ??
        new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1_000).toISOString();
      const rows = await sql`
        with ensure_user as (
          insert into users (id)
          values (${input.userId}::text)
          on conflict (id) do nothing
        )
        insert into meal_log_snapshots (
          user_id,
          profile_id,
          operation_type,
          affected_local_date,
          timezone,
          source,
          description,
          before_state,
          after_state,
          created_at,
          expires_at
        )
        values (
          ${input.userId}::text,
          ${input.profileId ?? null}::uuid,
          ${input.operationType}::text,
          ${input.affectedLocalDate}::date,
          ${input.timezone}::text,
          ${input.source}::text,
          ${input.description}::text,
          ${JSON.stringify(input.beforeState)}::jsonb,
          ${input.afterState === undefined ? null : JSON.stringify(input.afterState)}::jsonb,
          ${createdAt}::timestamptz,
          ${expiresAt}::timestamptz
        )
        returning *
      `;

      return rowToMealLogSnapshot(rows[0]);
    },
    async getSnapshot(input) {
      const rows = await queryOrEmpty(sql`
          select *
          from meal_log_snapshots
          where user_id = ${input.userId}::text
            and (
              profile_id = ${input.profileId ?? null}::uuid
              or (
                ${input.profileId ?? null}::uuid is null
                and profile_id is null
              )
            )
            and id::text = ${input.snapshotId}::text
          limit 1
        `);

      return rows[0] === undefined ? undefined : rowToMealLogSnapshot(rows[0]);
    },
    async listSnapshots(input) {
      const rows = await queryOrEmpty(sql`
          select *
          from meal_log_snapshots
          where user_id = ${input.userId}::text
            and (
              profile_id = ${input.profileId ?? null}::uuid
              or (
                ${input.profileId ?? null}::uuid is null
                and (
                  profile_id is null
                  or user_id = ${input.userId}::text
                )
              )
            )
            and (${input.date ?? null}::date is null or affected_local_date = ${input.date ?? null}::date)
            and (${input.includeExpired ?? false}::boolean or expires_at > ${input.now ?? new Date().toISOString()}::timestamptz)
          order by created_at desc
          limit ${Math.min(Math.max(input.limit ?? 20, 1), 100)}::integer
        `);

      return rows.map(rowToMealLogSnapshot);
    },
    async upsertTemplate(input) {
      const ingredientsJson = JSON.stringify(input.ingredients);
      const rows = await sql`
        with ensure_user as (
          insert into users (id)
          values (${input.userId}::text)
          on conflict (id) do nothing
        )
        insert into saved_meal_templates (
          user_id,
          profile_id,
          client_template_id,
          title,
          meal_type,
          note,
          calories,
          protein_grams,
          carbs_grams,
          fat_grams,
          fiber_grams,
          ingredients,
          usage_count,
          last_used_at
        )
        values (
          ${input.userId}::text,
          ${input.profileId ?? null}::uuid,
          ${input.clientTemplateId}::text,
          ${input.title}::text,
          ${input.mealType}::text,
          ${input.note ?? ""}::text,
          ${input.totals.calories}::numeric,
          ${input.totals.proteinGrams}::numeric,
          ${input.totals.carbsGrams}::numeric,
          ${input.totals.fatGrams}::numeric,
          ${input.totals.fiberGrams}::numeric,
          ${ingredientsJson}::jsonb,
          ${input.usageCount ?? 0}::integer,
          ${input.lastUsedAt}::timestamptz
        )
        on conflict (profile_id, client_template_id)
        where profile_id is not null
        do update set
          title = excluded.title,
          meal_type = excluded.meal_type,
          note = excluded.note,
          calories = excluded.calories,
          protein_grams = excluded.protein_grams,
          carbs_grams = excluded.carbs_grams,
          fat_grams = excluded.fat_grams,
          fiber_grams = excluded.fiber_grams,
          ingredients = excluded.ingredients,
          usage_count = greatest(saved_meal_templates.usage_count, excluded.usage_count),
          last_used_at = greatest(saved_meal_templates.last_used_at, excluded.last_used_at),
          updated_at = now()
        returning *
      `;

      return rowToSavedMealTemplate(rows[0]);
    },
    async listTemplates(input) {
      const rows = await sql`
        select *
        from saved_meal_templates
        where user_id = ${input.userId}::text
          and (
            profile_id = ${input.profileId ?? null}::uuid
            or (
              ${input.profileId ?? null}::uuid is null
              and (
                profile_id is null
                or user_id = ${input.userId}::text
              )
            )
          )
        order by last_used_at desc
        limit ${Math.min(Math.max(input.limit ?? 50, 1), 200)}::integer
      `;

      return rows.map(rowToSavedMealTemplate);
    },
  };
}

async function upsertMealLogWithResult(
  sql: SqlQueryExecutor,
  input: MealLogInput,
): Promise<MealLogUpsertResult> {
  const ingredientsJson = JSON.stringify(ingredientsForJson(input.ingredients));
  const replay = await selectMealByIdempotencyKey(sql, input);

  if (replay !== undefined) {
    return {
      meal: replay,
      operation: "unchanged",
      mealId: replay.id,
    };
  }

  const existingClientMeal =
    input.clientMealId === undefined
      ? undefined
      : await selectMealByClientMealId(sql, input);
  const operation: MealLogUpsertOperation =
    existingClientMeal === undefined ? "created" : "updated";
  const mealId = await upsertMealRow(sql, input);
  await replaceMealIngredients(sql, mealId, ingredientsJson);
  const meal = await selectMealById(sql, input, mealId);

  if (meal === undefined) {
    throw new Error("Meal repository could not reload the upserted meal.");
  }

  return {
    meal,
    operation,
    mealId: meal.id,
  };
}

async function selectMealByIdempotencyKey(
  sql: SqlQueryExecutor,
  input: Pick<MealLogInput, "idempotencyKey" | "profileId" | "userId">,
): Promise<MealLog | undefined> {
  const rows = await sql`
    select
      meals.*,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id',
              meal_ingredients.id::text,
              'clientIngredientId',
              meal_ingredients.client_ingredient_id,
              'position',
              meal_ingredients.position,
              'name',
              meal_ingredients.name,
              'quantity',
              meal_ingredients.quantity,
              'unit',
              meal_ingredients.unit,
              'grams',
              meal_ingredients.grams,
              'calories',
              meal_ingredients.calories,
              'proteinGrams',
              meal_ingredients.protein_grams,
              'carbsGrams',
              meal_ingredients.carbs_grams,
              'fatGrams',
              meal_ingredients.fat_grams,
              'fiberGrams',
              meal_ingredients.fiber_grams
            )
            order by meal_ingredients.position
          )
          from meal_ingredients
          where meal_ingredients.meal_id = meals.id
        ),
        '[]'::jsonb
      ) as ingredients
    from meals
    where meals.user_id = ${input.userId}::text
      and (
        meals.profile_id = ${input.profileId ?? null}::uuid
        or (
          ${input.profileId ?? null}::uuid is null
          and meals.profile_id is null
        )
      )
      and meals.idempotency_key = ${input.idempotencyKey}::text
      and meals.deleted_at is null
    limit 1
  `;

  return rows[0] === undefined ? undefined : rowToMealLog(rows[0]);
}

async function selectMealByClientMealId(
  sql: SqlQueryExecutor,
  input: Pick<MealLogInput, "clientMealId" | "origin" | "profileId" | "userId">,
): Promise<MealLog | undefined> {
  if (input.clientMealId === undefined) {
    return undefined;
  }

  const rows = await sql`
    select
      meals.*,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id',
              meal_ingredients.id::text,
              'clientIngredientId',
              meal_ingredients.client_ingredient_id,
              'position',
              meal_ingredients.position,
              'name',
              meal_ingredients.name,
              'quantity',
              meal_ingredients.quantity,
              'unit',
              meal_ingredients.unit,
              'grams',
              meal_ingredients.grams,
              'calories',
              meal_ingredients.calories,
              'proteinGrams',
              meal_ingredients.protein_grams,
              'carbsGrams',
              meal_ingredients.carbs_grams,
              'fatGrams',
              meal_ingredients.fat_grams,
              'fiberGrams',
              meal_ingredients.fiber_grams
            )
            order by meal_ingredients.position
          )
          from meal_ingredients
          where meal_ingredients.meal_id = meals.id
        ),
        '[]'::jsonb
      ) as ingredients
    from meals
    where meals.user_id = ${input.userId}::text
      and (
        meals.profile_id = ${input.profileId ?? null}::uuid
        or (
          ${input.profileId ?? null}::uuid is null
          and meals.profile_id is null
        )
      )
      and meals.origin = ${input.origin}::text
      and meals.client_meal_id = ${input.clientMealId}::text
      and meals.deleted_at is null
    limit 1
  `;

  return rows[0] === undefined ? undefined : rowToMealLog(rows[0]);
}

async function selectMealById(
  sql: SqlQueryExecutor,
  input: Pick<MealLogInput, "profileId" | "userId">,
  mealId: string,
): Promise<MealLog | undefined> {
  const rows = await sql`
    select
      meals.*,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id',
              meal_ingredients.id::text,
              'clientIngredientId',
              meal_ingredients.client_ingredient_id,
              'position',
              meal_ingredients.position,
              'name',
              meal_ingredients.name,
              'quantity',
              meal_ingredients.quantity,
              'unit',
              meal_ingredients.unit,
              'grams',
              meal_ingredients.grams,
              'calories',
              meal_ingredients.calories,
              'proteinGrams',
              meal_ingredients.protein_grams,
              'carbsGrams',
              meal_ingredients.carbs_grams,
              'fatGrams',
              meal_ingredients.fat_grams,
              'fiberGrams',
              meal_ingredients.fiber_grams
            )
            order by meal_ingredients.position
          )
          from meal_ingredients
          where meal_ingredients.meal_id = meals.id
        ),
        '[]'::jsonb
      ) as ingredients
    from meals
    where meals.user_id = ${input.userId}::text
      and (
        meals.profile_id = ${input.profileId ?? null}::uuid
        or (
          ${input.profileId ?? null}::uuid is null
          and meals.profile_id is null
        )
      )
      and meals.id = ${mealId}::uuid
      and meals.deleted_at is null
    limit 1
  `;

  return rows[0] === undefined ? undefined : rowToMealLog(rows[0]);
}

async function upsertMealRow(
  sql: SqlQueryExecutor,
  input: MealLogInput,
): Promise<string> {
  if (input.clientMealId !== undefined && input.profileId !== undefined) {
    return upsertProfileMealByClientMealId(sql, input);
  }

  if (input.clientMealId !== undefined) {
    return upsertLegacyMealByClientMealId(sql, input);
  }

  if (input.profileId !== undefined) {
    return insertProfileMealByIdempotencyKey(sql, input);
  }

  return insertLegacyMealByIdempotencyKey(sql, input);
}

async function upsertProfileMealByClientMealId(
  sql: SqlQueryExecutor,
  input: MealLogInput,
): Promise<string> {
  const provenanceJson = JSON.stringify(input.provenance ?? {});
  const rows = await sql`
    with ensure_user as (
      insert into users (id)
      values (${input.userId}::text)
      on conflict (id) do nothing
    )
    insert into meals (
      user_id,
      profile_id,
      idempotency_key,
      client_meal_id,
      occurred_at,
      timezone,
      description,
      title,
      meal_type,
      note,
      origin,
      calories,
      protein_grams,
      carbs_grams,
      fat_grams,
      fiber_grams,
      estimate_status,
      estimate_confidence,
      estimate_summary,
      photo_count,
      provenance,
      deleted_at
    )
    values (
      ${input.userId}::text,
      ${input.profileId ?? null}::uuid,
      ${input.idempotencyKey}::text,
      ${input.clientMealId ?? null}::text,
      ${input.occurredAt}::timestamptz,
      ${input.timezone}::text,
      ${input.note ?? input.title}::text,
      ${input.title}::text,
      ${input.mealType}::text,
      ${input.note ?? ""}::text,
      ${input.origin}::text,
      ${input.totals.calories}::numeric,
      ${input.totals.proteinGrams}::numeric,
      ${input.totals.carbsGrams}::numeric,
      ${input.totals.fatGrams}::numeric,
      ${input.totals.fiberGrams}::numeric,
      ${input.estimateStatus}::text,
      ${input.estimateConfidence ?? null}::numeric,
      ${input.estimateSummary ?? null}::text,
      ${input.photoCount}::integer,
      ${provenanceJson}::jsonb,
      null
    )
    on conflict (profile_id, origin, client_meal_id)
    where profile_id is not null and client_meal_id is not null
    do update set
      idempotency_key = excluded.idempotency_key,
      occurred_at = excluded.occurred_at,
      timezone = excluded.timezone,
      description = excluded.description,
      title = excluded.title,
      meal_type = excluded.meal_type,
      note = excluded.note,
      calories = excluded.calories,
      protein_grams = excluded.protein_grams,
      carbs_grams = excluded.carbs_grams,
      fat_grams = excluded.fat_grams,
      fiber_grams = excluded.fiber_grams,
      estimate_status = excluded.estimate_status,
      estimate_confidence = excluded.estimate_confidence,
      estimate_summary = excluded.estimate_summary,
      photo_count = excluded.photo_count,
      provenance = excluded.provenance,
      deleted_at = null,
      updated_at = now()
    returning id::text
  `;

  return idColumn(rows[0]);
}

async function upsertLegacyMealByClientMealId(
  sql: SqlQueryExecutor,
  input: MealLogInput,
): Promise<string> {
  const provenanceJson = JSON.stringify(input.provenance ?? {});
  const rows = await sql`
    with ensure_user as (
      insert into users (id)
      values (${input.userId}::text)
      on conflict (id) do nothing
    )
    insert into meals (
      user_id,
      profile_id,
      idempotency_key,
      client_meal_id,
      occurred_at,
      timezone,
      description,
      title,
      meal_type,
      note,
      origin,
      calories,
      protein_grams,
      carbs_grams,
      fat_grams,
      fiber_grams,
      estimate_status,
      estimate_confidence,
      estimate_summary,
      photo_count,
      provenance,
      deleted_at
    )
    values (
      ${input.userId}::text,
      null,
      ${input.idempotencyKey}::text,
      ${input.clientMealId ?? null}::text,
      ${input.occurredAt}::timestamptz,
      ${input.timezone}::text,
      ${input.note ?? input.title}::text,
      ${input.title}::text,
      ${input.mealType}::text,
      ${input.note ?? ""}::text,
      ${input.origin}::text,
      ${input.totals.calories}::numeric,
      ${input.totals.proteinGrams}::numeric,
      ${input.totals.carbsGrams}::numeric,
      ${input.totals.fatGrams}::numeric,
      ${input.totals.fiberGrams}::numeric,
      ${input.estimateStatus}::text,
      ${input.estimateConfidence ?? null}::numeric,
      ${input.estimateSummary ?? null}::text,
      ${input.photoCount}::integer,
      ${provenanceJson}::jsonb,
      null
    )
    on conflict (user_id, origin, client_meal_id)
    where profile_id is null and client_meal_id is not null
    do update set
      idempotency_key = excluded.idempotency_key,
      occurred_at = excluded.occurred_at,
      timezone = excluded.timezone,
      description = excluded.description,
      title = excluded.title,
      meal_type = excluded.meal_type,
      note = excluded.note,
      calories = excluded.calories,
      protein_grams = excluded.protein_grams,
      carbs_grams = excluded.carbs_grams,
      fat_grams = excluded.fat_grams,
      fiber_grams = excluded.fiber_grams,
      estimate_status = excluded.estimate_status,
      estimate_confidence = excluded.estimate_confidence,
      estimate_summary = excluded.estimate_summary,
      photo_count = excluded.photo_count,
      provenance = excluded.provenance,
      deleted_at = null,
      updated_at = now()
    returning id::text
  `;

  return idColumn(rows[0]);
}

async function insertProfileMealByIdempotencyKey(
  sql: SqlQueryExecutor,
  input: MealLogInput,
): Promise<string> {
  const provenanceJson = JSON.stringify(input.provenance ?? {});
  const rows = await sql`
    with ensure_user as (
      insert into users (id)
      values (${input.userId}::text)
      on conflict (id) do nothing
    )
    insert into meals (
      user_id,
      profile_id,
      idempotency_key,
      client_meal_id,
      occurred_at,
      timezone,
      description,
      title,
      meal_type,
      note,
      origin,
      calories,
      protein_grams,
      carbs_grams,
      fat_grams,
      fiber_grams,
      estimate_status,
      estimate_confidence,
      estimate_summary,
      photo_count,
      provenance,
      deleted_at
    )
    values (
      ${input.userId}::text,
      ${input.profileId ?? null}::uuid,
      ${input.idempotencyKey}::text,
      null,
      ${input.occurredAt}::timestamptz,
      ${input.timezone}::text,
      ${input.note ?? input.title}::text,
      ${input.title}::text,
      ${input.mealType}::text,
      ${input.note ?? ""}::text,
      ${input.origin}::text,
      ${input.totals.calories}::numeric,
      ${input.totals.proteinGrams}::numeric,
      ${input.totals.carbsGrams}::numeric,
      ${input.totals.fatGrams}::numeric,
      ${input.totals.fiberGrams}::numeric,
      ${input.estimateStatus}::text,
      ${input.estimateConfidence ?? null}::numeric,
      ${input.estimateSummary ?? null}::text,
      ${input.photoCount}::integer,
      ${provenanceJson}::jsonb,
      null
    )
    on conflict (profile_id, idempotency_key)
    where profile_id is not null
    do nothing
    returning id::text
  `;

  if (rows[0] !== undefined) {
    return idColumn(rows[0]);
  }

  const replay = await selectMealByIdempotencyKey(sql, input);
  if (replay !== undefined) return replay.id;
  throw new Error("Meal insert conflicted but no idempotent row was found.");
}

async function insertLegacyMealByIdempotencyKey(
  sql: SqlQueryExecutor,
  input: MealLogInput,
): Promise<string> {
  const provenanceJson = JSON.stringify(input.provenance ?? {});
  const rows = await sql`
    with ensure_user as (
      insert into users (id)
      values (${input.userId}::text)
      on conflict (id) do nothing
    )
    insert into meals (
      user_id,
      profile_id,
      idempotency_key,
      client_meal_id,
      occurred_at,
      timezone,
      description,
      title,
      meal_type,
      note,
      origin,
      calories,
      protein_grams,
      carbs_grams,
      fat_grams,
      fiber_grams,
      estimate_status,
      estimate_confidence,
      estimate_summary,
      photo_count,
      provenance,
      deleted_at
    )
    values (
      ${input.userId}::text,
      null,
      ${input.idempotencyKey}::text,
      null,
      ${input.occurredAt}::timestamptz,
      ${input.timezone}::text,
      ${input.note ?? input.title}::text,
      ${input.title}::text,
      ${input.mealType}::text,
      ${input.note ?? ""}::text,
      ${input.origin}::text,
      ${input.totals.calories}::numeric,
      ${input.totals.proteinGrams}::numeric,
      ${input.totals.carbsGrams}::numeric,
      ${input.totals.fatGrams}::numeric,
      ${input.totals.fiberGrams}::numeric,
      ${input.estimateStatus}::text,
      ${input.estimateConfidence ?? null}::numeric,
      ${input.estimateSummary ?? null}::text,
      ${input.photoCount}::integer,
      ${provenanceJson}::jsonb,
      null
    )
    on conflict (user_id, idempotency_key)
    where profile_id is null
    do nothing
    returning id::text
  `;

  if (rows[0] !== undefined) {
    return idColumn(rows[0]);
  }

  const replay = await selectMealByIdempotencyKey(sql, input);
  if (replay !== undefined) return replay.id;
  throw new Error("Meal insert conflicted but no idempotent row was found.");
}

async function replaceMealIngredients(
  sql: SqlQueryExecutor,
  mealId: string,
  ingredientsJson: string,
): Promise<void> {
  await sql`
    with deleted_ingredients as (
      delete from meal_ingredients
      where meal_id = ${mealId}::uuid
    ),
    input_ingredients as (
      select *
      from jsonb_to_recordset(${ingredientsJson}::jsonb) as ingredient(
        ordinal integer,
        "clientIngredientId" text,
        name text,
        quantity numeric,
        unit text,
        grams numeric,
        totals jsonb
      )
    )
    insert into meal_ingredients (
      meal_id,
      client_ingredient_id,
      position,
      name,
      quantity,
      unit,
      grams,
      calories,
      protein_grams,
      carbs_grams,
      fat_grams,
      fiber_grams
    )
    select
      ${mealId}::uuid,
      "clientIngredientId",
      ordinal,
      name,
      quantity,
      unit,
      grams,
      (totals->>'calories')::numeric,
      (totals->>'proteinGrams')::numeric,
      (totals->>'carbsGrams')::numeric,
      (totals->>'fatGrams')::numeric,
      (totals->>'fiberGrams')::numeric
    from input_ingredients
  `;
}

function idColumn(row: Record<string, unknown> | undefined): string {
  if (row === undefined) {
    throw new Error("Meal repository did not return an id.");
  }

  return stringColumn(row, "id");
}

function rowToMealLogSnapshot(
  row: Record<string, unknown> | undefined,
): MealLogSnapshot {
  if (row === undefined) {
    throw new Error("Meal snapshot repository did not return a row.");
  }

  return {
    id: stringColumn(row, "id"),
    userId: stringColumn(row, "user_id"),
    profileId: optionalStringColumn(row, "profile_id"),
    operationType: stringColumn(row, "operation_type"),
    affectedLocalDate: dateColumn(row, "affected_local_date"),
    timezone: stringColumn(row, "timezone"),
    beforeState: snapshotStateColumn(row, "before_state"),
    afterState: optionalSnapshotStateColumn(row, "after_state"),
    source: snapshotSource(row, "source"),
    description: stringColumn(row, "description"),
    createdAt: timestampColumn(row, "created_at"),
    expiresAt: timestampColumn(row, "expires_at"),
  };
}

async function queryOrEmpty(
  query: Promise<readonly Record<string, unknown>[]>,
): Promise<readonly Record<string, unknown>[]> {
  try {
    return await query;
  } catch (error) {
    if (isMissingMealLogSnapshotsTable(error)) {
      return [];
    }

    throw error;
  }
}

function isMissingMealLogSnapshotsTable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };

  return (
    candidate.code === "42P01" ||
    (typeof candidate.message === "string" &&
      candidate.message.includes(
        'relation "meal_log_snapshots" does not exist',
      ))
  );
}

function ingredientsForJson(
  ingredients: readonly MealIngredientInput[],
): readonly MealIngredientJson[] {
  return ingredients.map((ingredient, ordinal) => ({
    ...ingredient,
    ordinal,
  }));
}

function rowToMealLog(row: Record<string, unknown> | undefined): MealLog {
  if (row === undefined) {
    throw new Error("Meal repository did not return a meal row.");
  }

  return {
    id: stringColumn(row, "id"),
    userId: stringColumn(row, "user_id"),
    profileId: optionalStringColumn(row, "profile_id"),
    idempotencyKey: stringColumn(row, "idempotency_key"),
    clientMealId: optionalStringColumn(row, "client_meal_id"),
    occurredAt: timestampColumn(row, "occurred_at"),
    timezone: stringColumn(row, "timezone"),
    title: optionalStringColumn(row, "title") ?? "Meal",
    mealType: optionalStringColumn(row, "meal_type") ?? "Meal",
    note:
      optionalStringColumn(row, "note") ??
      optionalStringColumn(row, "description") ??
      "",
    totals: {
      calories: optionalNumberColumn(row, "calories") ?? 0,
      proteinGrams: optionalNumberColumn(row, "protein_grams") ?? 0,
      carbsGrams: optionalNumberColumn(row, "carbs_grams") ?? 0,
      fatGrams: optionalNumberColumn(row, "fat_grams") ?? 0,
      fiberGrams: optionalNumberColumn(row, "fiber_grams") ?? 0,
    },
    ingredients: ingredientsColumn(row, "ingredients"),
    photoCount: numberColumn(row, "photo_count"),
    estimateStatus:
      (optionalStringColumn(row, "estimate_status") as
        | MealLog["estimateStatus"]
        | undefined) ?? "manual",
    estimateConfidence: optionalNumberColumn(row, "estimate_confidence"),
    estimateSummary: optionalStringColumn(row, "estimate_summary"),
    origin: stringColumn(row, "origin"),
    createdAt: timestampColumn(row, "created_at"),
    updatedAt: timestampColumn(row, "updated_at"),
  };
}

function rowToSavedMealTemplate(
  row: Record<string, unknown> | undefined,
): SavedMealTemplate {
  if (row === undefined) {
    throw new Error("Meal repository did not return a saved template row.");
  }

  return {
    id: stringColumn(row, "id"),
    userId: stringColumn(row, "user_id"),
    profileId: optionalStringColumn(row, "profile_id"),
    clientTemplateId: stringColumn(row, "client_template_id"),
    title: stringColumn(row, "title"),
    mealType: stringColumn(row, "meal_type"),
    note: optionalStringColumn(row, "note") ?? "",
    totals: {
      calories: numberColumn(row, "calories"),
      proteinGrams: numberColumn(row, "protein_grams"),
      carbsGrams: numberColumn(row, "carbs_grams"),
      fatGrams: numberColumn(row, "fat_grams"),
      fiberGrams: numberColumn(row, "fiber_grams"),
    },
    ingredients: templateIngredientsColumn(row, "ingredients"),
    usageCount: numberColumn(row, "usage_count"),
    lastUsedAt: timestampColumn(row, "last_used_at"),
    createdAt: timestampColumn(row, "created_at"),
    updatedAt: timestampColumn(row, "updated_at"),
  };
}

function ingredientsColumn(
  row: Record<string, unknown>,
  column: string,
): readonly MealIngredient[] {
  const value = jsonColumn(row, column);

  if (!Array.isArray(value)) {
    throw new Error(`Expected ${column} to be an array.`);
  }

  return value.map((ingredient) => {
    if (!isRecord(ingredient)) {
      throw new Error(`Expected ${column} ingredient rows to be objects.`);
    }

    return {
      id: stringColumn(ingredient, "id"),
      clientIngredientId: optionalStringColumn(
        ingredient,
        "clientIngredientId",
      ),
      position: numberColumn(ingredient, "position"),
      name: stringColumn(ingredient, "name"),
      quantity: numberColumn(ingredient, "quantity"),
      unit: stringColumn(ingredient, "unit"),
      grams: optionalNumberColumn(ingredient, "grams"),
      totals: {
        calories: numberColumn(ingredient, "calories"),
        proteinGrams: numberColumn(ingredient, "proteinGrams"),
        carbsGrams: numberColumn(ingredient, "carbsGrams"),
        fatGrams: numberColumn(ingredient, "fatGrams"),
        fiberGrams: numberColumn(ingredient, "fiberGrams"),
      },
    };
  });
}

function templateIngredientsColumn(
  row: Record<string, unknown>,
  column: string,
): readonly MealIngredientInput[] {
  const value = jsonColumn(row, column);

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((ingredient) => {
    if (!isRecord(ingredient) || !isRecord(ingredient.totals)) {
      return [];
    }

    return [
      {
        clientIngredientId: optionalStringColumn(
          ingredient,
          "clientIngredientId",
        ),
        name: stringColumn(ingredient, "name"),
        quantity: numberColumn(ingredient, "quantity"),
        unit: stringColumn(ingredient, "unit"),
        grams: optionalNumberColumn(ingredient, "grams"),
        totals: {
          calories: numberColumn(ingredient.totals, "calories"),
          proteinGrams: numberColumn(ingredient.totals, "proteinGrams"),
          carbsGrams: numberColumn(ingredient.totals, "carbsGrams"),
          fatGrams: numberColumn(ingredient.totals, "fatGrams"),
          fiberGrams: numberColumn(ingredient.totals, "fiberGrams"),
        },
      },
    ];
  });
}

function jsonColumn(row: Record<string, unknown>, column: string): unknown {
  const value = row[column];

  return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
}

function snapshotStateColumn(
  row: Record<string, unknown>,
  column: string,
): MealLogSnapshotState {
  const value = jsonColumn(row, column);

  if (!isRecord(value) || !Array.isArray(value.meals)) {
    throw new Error(`Expected ${column} to be a meal snapshot state.`);
  }

  const totals = value.totals;

  if (!isRecord(totals)) {
    throw new Error(`Expected ${column}.totals to be an object.`);
  }

  return {
    meals: value.meals.map(snapshotMeal),
    totals: {
      calories: numberColumn(totals, "calories"),
      proteinGrams: numberColumn(totals, "proteinGrams"),
      carbsGrams: numberColumn(totals, "carbsGrams"),
      fatGrams: numberColumn(totals, "fatGrams"),
      fiberGrams: numberColumn(totals, "fiberGrams"),
    },
  };
}

function optionalSnapshotStateColumn(
  row: Record<string, unknown>,
  column: string,
): MealLogSnapshotState | undefined {
  if (row[column] === null || row[column] === undefined) {
    return undefined;
  }

  return snapshotStateColumn(row, column);
}

function snapshotMeal(value: unknown): MealLog {
  if (!isRecord(value)) {
    throw new Error("Expected snapshot meal to be an object.");
  }

  const ingredients = value.ingredients;

  if (!Array.isArray(ingredients)) {
    throw new Error("Expected snapshot meal ingredients to be an array.");
  }

  return {
    id: stringColumn(value, "id"),
    userId: stringColumn(value, "userId"),
    profileId: optionalStringColumn(value, "profileId"),
    idempotencyKey: stringColumn(value, "idempotencyKey"),
    clientMealId: optionalStringColumn(value, "clientMealId"),
    occurredAt: timestampColumn(value, "occurredAt"),
    timezone: stringColumn(value, "timezone"),
    title: stringColumn(value, "title"),
    mealType: stringColumn(value, "mealType"),
    note: stringColumn(value, "note"),
    totals: {
      calories: numberColumn(recordColumn(value, "totals"), "calories"),
      proteinGrams: numberColumn(recordColumn(value, "totals"), "proteinGrams"),
      carbsGrams: numberColumn(recordColumn(value, "totals"), "carbsGrams"),
      fatGrams: numberColumn(recordColumn(value, "totals"), "fatGrams"),
      fiberGrams: numberColumn(recordColumn(value, "totals"), "fiberGrams"),
    },
    ingredients: ingredients.map(snapshotIngredient),
    photoCount: numberColumn(value, "photoCount"),
    estimateStatus: mealEstimateStatus(value, "estimateStatus"),
    estimateConfidence: optionalNumberColumn(value, "estimateConfidence"),
    estimateSummary: optionalStringColumn(value, "estimateSummary"),
    origin: stringColumn(value, "origin"),
    createdAt: timestampColumn(value, "createdAt"),
    updatedAt: timestampColumn(value, "updatedAt"),
  };
}

function snapshotIngredient(value: unknown): MealIngredient {
  if (!isRecord(value)) {
    throw new Error("Expected snapshot ingredient to be an object.");
  }

  return {
    id: stringColumn(value, "id"),
    clientIngredientId: optionalStringColumn(value, "clientIngredientId"),
    position: numberColumn(value, "position"),
    name: stringColumn(value, "name"),
    quantity: numberColumn(value, "quantity"),
    unit: stringColumn(value, "unit"),
    grams: optionalNumberColumn(value, "grams"),
    totals: {
      calories: numberColumn(recordColumn(value, "totals"), "calories"),
      proteinGrams: numberColumn(recordColumn(value, "totals"), "proteinGrams"),
      carbsGrams: numberColumn(recordColumn(value, "totals"), "carbsGrams"),
      fatGrams: numberColumn(recordColumn(value, "totals"), "fatGrams"),
      fiberGrams: numberColumn(recordColumn(value, "totals"), "fiberGrams"),
    },
  };
}

function recordColumn(
  row: Record<string, unknown>,
  column: string,
): Record<string, unknown> {
  const value = row[column];

  if (!isRecord(value)) {
    throw new Error(`Expected ${column} to be an object.`);
  }

  return value;
}

function snapshotSource(
  row: Record<string, unknown>,
  column: string,
): MealLogSnapshot["source"] {
  const value = stringColumn(row, column);

  if (
    value === "ios" ||
    value === "web" ||
    value === "mcp" ||
    value === "assistant" ||
    value === "telegram" ||
    value === "server"
  ) {
    return value;
  }

  throw new Error(`Unexpected meal snapshot source: ${value}.`);
}

function mealEstimateStatus(
  row: Record<string, unknown>,
  column: string,
): MealLog["estimateStatus"] {
  const value = stringColumn(row, column);

  if (
    value === "manual" ||
    value === "ai_estimated" ||
    value === "estimation_failed"
  ) {
    return value;
  }

  throw new Error(`Unexpected meal estimate status: ${value}.`);
}

function dateColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }

  throw new Error(`Expected ${column} to be a date.`);
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

function optionalNumberColumn(
  row: Record<string, unknown>,
  column: string,
): number | undefined {
  const value = row[column];

  if (value === null || value === undefined) {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected ${column} to be a finite number.`);
  }

  return parsed;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
