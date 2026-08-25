create table if not exists daily_meal_plans (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references health_profiles (id) on delete cascade,
  local_food_date date not null,
  timezone text not null,
  status text not null default 'draft',
  title text,
  note text,
  created_by_user_id text not null references users (id) on delete restrict,
  idempotency_key text not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, profile_id),
  unique (profile_id, local_food_date),
  unique (profile_id, idempotency_key),
  check (status in ('draft', 'active', 'completed', 'archived')),
  check (length(trim(timezone)) > 0),
  check (length(trim(idempotency_key)) > 0),
  check (version > 0)
);

create table if not exists planned_meals (
  id uuid primary key default gen_random_uuid(),
  daily_meal_plan_id uuid not null,
  profile_id uuid not null,
  meal_slot_id text,
  meal_type text not null,
  planned_time time,
  title text not null,
  description text not null default '',
  instructions text not null default '',
  status text not null default 'planned',
  linked_meal_log_id uuid references meals (id) on delete set null,
  replacement_reason text,
  coach_note text,
  alternative_group text,
  sort_order integer not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, profile_id),
  foreign key (daily_meal_plan_id, profile_id)
    references daily_meal_plans (id, profile_id) on delete cascade,
  check (
    status in (
      'planned',
      'confirmed',
      'partially_eaten',
      'replaced',
      'skipped',
      'unconfirmed'
    )
  ),
  check (length(trim(meal_type)) > 0),
  check (length(trim(title)) > 0),
  check (sort_order >= 0),
  check (version > 0)
);

create unique index if not exists planned_meals_linked_log_unique_idx
  on planned_meals (linked_meal_log_id)
  where linked_meal_log_id is not null;

create table if not exists planned_meal_ingredients (
  id uuid primary key default gen_random_uuid(),
  planned_meal_id uuid not null,
  profile_id uuid not null,
  food_reference_type text,
  food_reference_id text,
  display_name text not null,
  quantity numeric(12, 4) not null,
  unit text not null,
  grams numeric(12, 4),
  calories numeric(10, 2) not null,
  protein_grams numeric(10, 2) not null,
  carbs_grams numeric(10, 2) not null,
  fat_grams numeric(10, 2) not null,
  fiber_grams numeric(10, 2) not null,
  alternative_group text,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (planned_meal_id, profile_id)
    references planned_meals (id, profile_id) on delete cascade,
  check (length(trim(display_name)) > 0),
  check (length(trim(unit)) > 0),
  check (quantity >= 0),
  check (grams is null or grams >= 0),
  check (calories >= 0),
  check (protein_grams >= 0),
  check (carbs_grams >= 0),
  check (fat_grams >= 0),
  check (fiber_grams >= 0),
  check (sort_order >= 0)
);

create index if not exists daily_meal_plans_profile_date_idx
  on daily_meal_plans (profile_id, local_food_date);

create index if not exists daily_meal_plans_profile_status_date_idx
  on daily_meal_plans (profile_id, status, local_food_date);

create index if not exists planned_meals_plan_sort_idx
  on planned_meals (daily_meal_plan_id, sort_order);

create index if not exists planned_meals_profile_status_idx
  on planned_meals (profile_id, status);

create index if not exists planned_meal_ingredients_meal_sort_idx
  on planned_meal_ingredients (planned_meal_id, sort_order);

create or replace view daily_meal_plan_documents as
select
  plan.*,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', meal.id::text,
          'dailyMealPlanId', meal.daily_meal_plan_id::text,
          'profileId', meal.profile_id::text,
          'mealSlotId', meal.meal_slot_id,
          'mealType', meal.meal_type,
          'plannedTime', case
            when meal.planned_time is null then null
            else to_char(meal.planned_time, 'HH24:MI')
          end,
          'title', meal.title,
          'description', meal.description,
          'instructions', meal.instructions,
          'status', meal.status,
          'linkedMealLogId', meal.linked_meal_log_id::text,
          'replacementReason', meal.replacement_reason,
          'coachNote', meal.coach_note,
          'alternativeGroup', meal.alternative_group,
          'sortOrder', meal.sort_order,
          'version', meal.version,
          'createdAt', meal.created_at,
          'updatedAt', meal.updated_at,
          'ingredients', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'id', ingredient.id::text,
                  'plannedMealId', ingredient.planned_meal_id::text,
                  'foodReferenceType', ingredient.food_reference_type,
                  'foodReferenceId', ingredient.food_reference_id,
                  'displayName', ingredient.display_name,
                  'quantity', ingredient.quantity,
                  'unit', ingredient.unit,
                  'grams', ingredient.grams,
                  'calories', ingredient.calories,
                  'proteinGrams', ingredient.protein_grams,
                  'carbsGrams', ingredient.carbs_grams,
                  'fatGrams', ingredient.fat_grams,
                  'fiberGrams', ingredient.fiber_grams,
                  'alternativeGroup', ingredient.alternative_group,
                  'notes', ingredient.notes,
                  'sortOrder', ingredient.sort_order,
                  'createdAt', ingredient.created_at,
                  'updatedAt', ingredient.updated_at
                )
                order by ingredient.sort_order, ingredient.created_at
              )
              from planned_meal_ingredients ingredient
              where ingredient.planned_meal_id = meal.id
            ),
            '[]'::jsonb
          )
        )
        order by meal.sort_order, meal.created_at
      )
      from planned_meals meal
      where meal.daily_meal_plan_id = plan.id
    ),
    '[]'::jsonb
  ) as meals
from daily_meal_plans plan;

drop trigger if exists daily_meal_plans_set_updated_at on daily_meal_plans;
create trigger daily_meal_plans_set_updated_at
before update on daily_meal_plans
for each row execute function set_updated_at();

drop trigger if exists planned_meals_set_updated_at on planned_meals;
create trigger planned_meals_set_updated_at
before update on planned_meals
for each row execute function set_updated_at();

drop trigger if exists planned_meal_ingredients_set_updated_at on planned_meal_ingredients;
create trigger planned_meal_ingredients_set_updated_at
before update on planned_meal_ingredients
for each row execute function set_updated_at();
