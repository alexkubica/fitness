import type { MealMacroTotals, SqlQueryExecutor } from "./meals.js";

export const DAILY_MEAL_PLAN_STATUSES = [
  "draft",
  "active",
  "completed",
  "archived",
] as const;
export type DailyMealPlanStatus = (typeof DAILY_MEAL_PLAN_STATUSES)[number];

export const PLANNED_MEAL_STATUSES = [
  "planned",
  "confirmed",
  "partially_eaten",
  "replaced",
  "skipped",
  "unconfirmed",
] as const;
export type PlannedMealStatus = (typeof PLANNED_MEAL_STATUSES)[number];

export type PlannedMealIngredient = Readonly<{
  id: string;
  plannedMealId: string;
  foodReferenceType?: string | undefined;
  foodReferenceId?: string | undefined;
  displayName: string;
  quantity: number;
  unit: string;
  grams?: number | undefined;
  totals: MealMacroTotals;
  alternativeGroup?: string | undefined;
  notes?: string | undefined;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}>;

export type PlannedMeal = Readonly<{
  id: string;
  dailyMealPlanId: string;
  profileId: string;
  mealSlotId?: string | undefined;
  mealType: string;
  plannedTime?: string | undefined;
  title: string;
  description: string;
  instructions: string;
  status: PlannedMealStatus;
  linkedMealLogId?: string | undefined;
  replacementReason?: string | undefined;
  coachNote?: string | undefined;
  alternativeGroup?: string | undefined;
  sortOrder: number;
  ingredients: readonly PlannedMealIngredient[];
  createdAt: string;
  updatedAt: string;
  version: number;
}>;

export type DailyMealPlan = Readonly<{
  id: string;
  profileId: string;
  localFoodDate: string;
  timezone: string;
  status: DailyMealPlanStatus;
  title?: string | undefined;
  note?: string | undefined;
  createdByUserId: string;
  idempotencyKey: string;
  meals: readonly PlannedMeal[];
  createdAt: string;
  updatedAt: string;
  version: number;
}>;

export type DailyMealPlanListInput = Readonly<{
  profileId: string;
  fromLocalFoodDate: string;
  toLocalFoodDate: string;
  includeArchived?: boolean | undefined;
}>;

export type DailyMealPlanSaveInput = Readonly<{
  plan: DailyMealPlan;
  expectedVersion?: number | undefined;
}>;

export type DailyMealPlanRepository = Readonly<{
  getPlan(
    profileId: string,
    localFoodDate: string,
  ): Promise<DailyMealPlan | undefined>;
  getPlanById(
    profileId: string,
    planId: string,
  ): Promise<DailyMealPlan | undefined>;
  getPlanByIdempotencyKey(
    profileId: string,
    idempotencyKey: string,
  ): Promise<DailyMealPlan | undefined>;
  listPlans(input: DailyMealPlanListInput): Promise<readonly DailyMealPlan[]>;
  savePlan(input: DailyMealPlanSaveInput): Promise<DailyMealPlan>;
  deleteDraftPlan(input: {
    profileId: string;
    planId: string;
    expectedVersion: number;
  }): Promise<boolean>;
}>;

export class DailyMealPlanWriteConflictError extends Error {
  readonly code = "MEAL_PLAN_VERSION_CONFLICT" as const;

  constructor(
    readonly profileId: string,
    readonly planId: string,
    readonly expectedVersion: number | undefined,
  ) {
    super(`Meal plan ${planId} could not be saved at the expected version.`);
    this.name = "DailyMealPlanWriteConflictError";
  }
}

export function createNeonDailyMealPlanRepository(
  sql: SqlQueryExecutor,
): DailyMealPlanRepository {
  return {
    async getPlan(profileId, localFoodDate) {
      const rows = await selectPlans(sql, {
        profileId,
        localFoodDate,
        limit: 1,
      });
      return rows[0];
    },
    async getPlanById(profileId, planId) {
      const rows = await selectPlans(sql, { profileId, planId, limit: 1 });
      return rows[0];
    },
    async getPlanByIdempotencyKey(profileId, idempotencyKey) {
      const rows = await selectPlans(sql, {
        profileId,
        idempotencyKey,
        limit: 1,
      });
      return rows[0];
    },
    async listPlans(input) {
      const rows = await sql`
        select *
        from daily_meal_plan_documents
        where profile_id = ${input.profileId}::uuid
          and local_food_date >= ${input.fromLocalFoodDate}::date
          and local_food_date <= ${input.toLocalFoodDate}::date
          and (${input.includeArchived ?? false}::boolean or status <> 'archived')
        order by local_food_date, created_at
      `;
      return rows.map(rowToDailyMealPlan);
    },
    async savePlan(input) {
      const plan = input.plan;
      const mealsJson = JSON.stringify(plan.meals);
      const rows = await sql`
        with upserted_plan as (
          insert into daily_meal_plans (
            id,
            profile_id,
            local_food_date,
            timezone,
            status,
            title,
            note,
            created_by_user_id,
            idempotency_key,
            version,
            created_at,
            updated_at
          ) values (
            ${plan.id}::uuid,
            ${plan.profileId}::uuid,
            ${plan.localFoodDate}::date,
            ${plan.timezone}::text,
            ${plan.status}::text,
            ${plan.title ?? null}::text,
            ${plan.note ?? null}::text,
            ${plan.createdByUserId}::text,
            ${plan.idempotencyKey}::text,
            1,
            ${plan.createdAt}::timestamptz,
            ${plan.updatedAt}::timestamptz
          )
          on conflict (profile_id, local_food_date)
          do update set
            timezone = excluded.timezone,
            status = excluded.status,
            title = excluded.title,
            note = excluded.note,
            idempotency_key = excluded.idempotency_key,
            version = daily_meal_plans.version + 1,
            updated_at = excluded.updated_at
          where daily_meal_plans.id = excluded.id
            and daily_meal_plans.version = ${input.expectedVersion ?? null}::integer
          returning *
        ),
        removed_meals as (
          delete from planned_meals
          where daily_meal_plan_id = (select id from upserted_plan)
          returning id
        ),
        meal_input as (
          select *
          from jsonb_to_recordset(${mealsJson}::jsonb) as meal(
            id uuid,
            "mealSlotId" text,
            "mealType" text,
            "plannedTime" text,
            title text,
            description text,
            instructions text,
            status text,
            "linkedMealLogId" uuid,
            "replacementReason" text,
            "coachNote" text,
            "alternativeGroup" text,
            "sortOrder" integer,
            ingredients jsonb,
            "createdAt" timestamptz,
            "updatedAt" timestamptz,
            version integer
          )
        ),
        inserted_meals as (
          insert into planned_meals (
            id,
            daily_meal_plan_id,
            profile_id,
            meal_slot_id,
            meal_type,
            planned_time,
            title,
            description,
            instructions,
            status,
            linked_meal_log_id,
            replacement_reason,
            coach_note,
            alternative_group,
            sort_order,
            created_at,
            updated_at,
            version
          )
          select
            meal.id,
            upserted_plan.id,
            upserted_plan.profile_id,
            meal."mealSlotId",
            meal."mealType",
            nullif(meal."plannedTime", '')::time,
            meal.title,
            meal.description,
            meal.instructions,
            meal.status,
            meal."linkedMealLogId",
            meal."replacementReason",
            meal."coachNote",
            meal."alternativeGroup",
            meal."sortOrder",
            meal."createdAt",
            meal."updatedAt",
            meal.version
          from meal_input meal
          cross join upserted_plan
          cross join (select count(*) from removed_meals) removed_meal_count
          returning *
        ),
        ingredient_input as (
          select
            meal.id as planned_meal_id,
            ingredient.*
          from meal_input meal
          join inserted_meals inserted_meal on inserted_meal.id = meal.id
          cross join lateral jsonb_to_recordset(meal.ingredients) as ingredient(
            id uuid,
            "foodReferenceType" text,
            "foodReferenceId" text,
            "displayName" text,
            quantity numeric,
            unit text,
            grams numeric,
            totals jsonb,
            "alternativeGroup" text,
            notes text,
            "sortOrder" integer,
            "createdAt" timestamptz,
            "updatedAt" timestamptz
          )
        ),
        inserted_ingredients as (
          insert into planned_meal_ingredients (
            id,
            planned_meal_id,
            profile_id,
            food_reference_type,
            food_reference_id,
            display_name,
            quantity,
            unit,
            grams,
            calories,
            protein_grams,
            carbs_grams,
            fat_grams,
            fiber_grams,
            alternative_group,
            notes,
            sort_order,
            created_at,
            updated_at
          )
          select
            ingredient.id,
            ingredient.planned_meal_id,
            upserted_plan.profile_id,
            ingredient."foodReferenceType",
            ingredient."foodReferenceId",
            ingredient."displayName",
            ingredient.quantity,
            ingredient.unit,
            ingredient.grams,
            (ingredient.totals->>'calories')::numeric,
            (ingredient.totals->>'proteinGrams')::numeric,
            (ingredient.totals->>'carbsGrams')::numeric,
            (ingredient.totals->>'fatGrams')::numeric,
            (ingredient.totals->>'fiberGrams')::numeric,
            ingredient."alternativeGroup",
            ingredient.notes,
            ingredient."sortOrder",
            ingredient."createdAt",
            ingredient."updatedAt"
          from ingredient_input ingredient
          cross join upserted_plan
          returning *
        )
        select upserted_plan.*
        from upserted_plan
      `;

      if (rows[0] === undefined) {
        throw new DailyMealPlanWriteConflictError(
          plan.profileId,
          plan.id,
          input.expectedVersion,
        );
      }

      const saved = (
        await selectPlans(sql, {
          profileId: plan.profileId,
          planId: plan.id,
          limit: 1,
        })
      )[0];
      if (saved === undefined) {
        throw new Error("Saved meal plan could not be reloaded.");
      }
      return saved;
    },
    async deleteDraftPlan(input) {
      const rows = await sql`
        delete from daily_meal_plans
        where id = ${input.planId}::uuid
          and profile_id = ${input.profileId}::uuid
          and status = 'draft'
          and version = ${input.expectedVersion}::integer
        returning id
      `;
      return rows.length === 1;
    },
  };
}

async function selectPlans(
  sql: SqlQueryExecutor,
  input: {
    profileId: string;
    localFoodDate?: string | undefined;
    planId?: string | undefined;
    idempotencyKey?: string | undefined;
    limit: number;
  },
): Promise<readonly DailyMealPlan[]> {
  const rows = await sql`
    select *
    from daily_meal_plan_documents
    where profile_id = ${input.profileId}::uuid
      and (${input.localFoodDate ?? null}::date is null or local_food_date = ${input.localFoodDate ?? null}::date)
      and (${input.planId ?? null}::uuid is null or id = ${input.planId ?? null}::uuid)
      and (${input.idempotencyKey ?? null}::text is null or idempotency_key = ${input.idempotencyKey ?? null}::text)
    order by local_food_date, created_at
    limit ${input.limit}::integer
  `;
  return rows.map(rowToDailyMealPlan);
}

function rowToDailyMealPlan(row: Record<string, unknown>): DailyMealPlan {
  return {
    id: stringColumn(row, "id"),
    profileId: stringColumn(row, "profile_id"),
    localFoodDate: dateColumn(row, "local_food_date"),
    timezone: stringColumn(row, "timezone"),
    status: statusColumn(row, "status", DAILY_MEAL_PLAN_STATUSES),
    title: optionalStringColumn(row, "title"),
    note: optionalStringColumn(row, "note"),
    createdByUserId: stringColumn(row, "created_by_user_id"),
    idempotencyKey: stringColumn(row, "idempotency_key"),
    meals: plannedMealsColumn(row, "meals"),
    createdAt: timestampColumn(row, "created_at"),
    updatedAt: timestampColumn(row, "updated_at"),
    version: numberColumn(row, "version"),
  };
}

function plannedMealsColumn(
  row: Record<string, unknown>,
  column: string,
): readonly PlannedMeal[] {
  const value = jsonColumn(row, column);
  if (!Array.isArray(value)) return [];
  return value.map((meal) => {
    const record = recordValue(meal, column);
    return {
      id: stringColumn(record, "id"),
      dailyMealPlanId: stringColumn(record, "dailyMealPlanId"),
      profileId: stringColumn(record, "profileId"),
      mealSlotId: optionalStringColumn(record, "mealSlotId"),
      mealType: stringColumn(record, "mealType"),
      plannedTime: optionalStringColumn(record, "plannedTime"),
      title: stringColumn(record, "title"),
      description: stringColumn(record, "description"),
      instructions: stringColumn(record, "instructions"),
      status: statusColumn(record, "status", PLANNED_MEAL_STATUSES),
      linkedMealLogId: optionalStringColumn(record, "linkedMealLogId"),
      replacementReason: optionalStringColumn(record, "replacementReason"),
      coachNote: optionalStringColumn(record, "coachNote"),
      alternativeGroup: optionalStringColumn(record, "alternativeGroup"),
      sortOrder: numberColumn(record, "sortOrder"),
      ingredients: plannedIngredientsColumn(record, "ingredients"),
      createdAt: timestampColumn(record, "createdAt"),
      updatedAt: timestampColumn(record, "updatedAt"),
      version: numberColumn(record, "version"),
    };
  });
}

function plannedIngredientsColumn(
  row: Record<string, unknown>,
  column: string,
): readonly PlannedMealIngredient[] {
  const value = jsonColumn(row, column);
  if (!Array.isArray(value)) return [];
  return value.map((ingredient) => {
    const record = recordValue(ingredient, column);
    return {
      id: stringColumn(record, "id"),
      plannedMealId: stringColumn(record, "plannedMealId"),
      foodReferenceType: optionalStringColumn(record, "foodReferenceType"),
      foodReferenceId: optionalStringColumn(record, "foodReferenceId"),
      displayName: stringColumn(record, "displayName"),
      quantity: numberColumn(record, "quantity"),
      unit: stringColumn(record, "unit"),
      grams: optionalNumberColumn(record, "grams"),
      totals: {
        calories: numberColumn(record, "calories"),
        proteinGrams: numberColumn(record, "proteinGrams"),
        carbsGrams: numberColumn(record, "carbsGrams"),
        fatGrams: numberColumn(record, "fatGrams"),
        fiberGrams: numberColumn(record, "fiberGrams"),
      },
      alternativeGroup: optionalStringColumn(record, "alternativeGroup"),
      notes: optionalStringColumn(record, "notes"),
      sortOrder: numberColumn(record, "sortOrder"),
      createdAt: timestampColumn(record, "createdAt"),
      updatedAt: timestampColumn(record, "updatedAt"),
    };
  });
}

function statusColumn<const T extends readonly string[]>(
  row: Record<string, unknown>,
  column: string,
  statuses: T,
): T[number] {
  const value = stringColumn(row, column);
  if (!statuses.includes(value)) throw new Error(`Unexpected ${column}.`);
  return value;
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

function numberColumn(row: Record<string, unknown>, column: string): number {
  const value = row[column];
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed))
    throw new Error(`Expected ${column} to be numeric.`);
  return parsed;
}

function optionalNumberColumn(
  row: Record<string, unknown>,
  column: string,
): number | undefined {
  const value = row[column];
  return value === null || value === undefined
    ? undefined
    : numberColumn(row, column);
}

function dateColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function timestampColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string")
    throw new Error(`Expected ${column} to be a timestamp.`);
  return value;
}

function jsonColumn(row: Record<string, unknown>, column: string): unknown {
  const value = row[column];
  return typeof value === "string" ? JSON.parse(value) : value;
}

function recordValue(value: unknown, column: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${column} entries to be objects.`);
  }
  return value as Record<string, unknown>;
}
