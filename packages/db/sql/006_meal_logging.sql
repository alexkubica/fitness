alter table meals
  add column if not exists client_meal_id text,
  add column if not exists title text,
  add column if not exists meal_type text,
  add column if not exists note text,
  add column if not exists calories numeric(10, 2),
  add column if not exists protein_grams numeric(10, 2),
  add column if not exists carbs_grams numeric(10, 2),
  add column if not exists fat_grams numeric(10, 2),
  add column if not exists fiber_grams numeric(10, 2),
  add column if not exists estimate_status text,
  add column if not exists estimate_confidence numeric(5, 4),
  add column if not exists estimate_summary text,
  add column if not exists photo_count integer not null default 0,
  add column if not exists deleted_at timestamptz;

create unique index if not exists meals_user_origin_client_meal_idx
  on meals (user_id, origin, client_meal_id)
  where client_meal_id is not null;

create index if not exists meals_user_deleted_occurred_idx
  on meals (user_id, deleted_at, occurred_at);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'meals_estimate_confidence_range_chk'
  ) then
    alter table meals
      add constraint meals_estimate_confidence_range_chk
      check (
        estimate_confidence is null
        or (estimate_confidence >= 0 and estimate_confidence <= 1)
      );
  end if;
end $$;

create table if not exists meal_ingredients (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references meals (id) on delete cascade,
  client_ingredient_id text,
  position integer not null default 0,
  name text not null,
  quantity numeric(12, 4) not null,
  unit text not null,
  grams numeric(12, 4),
  calories numeric(10, 2) not null,
  protein_grams numeric(10, 2) not null,
  carbs_grams numeric(10, 2) not null,
  fat_grams numeric(10, 2) not null,
  fiber_grams numeric(10, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meal_ingredients_meal_position_idx
  on meal_ingredients (meal_id, position);

create table if not exists saved_meal_templates (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  client_template_id text not null,
  title text not null,
  meal_type text not null,
  note text,
  calories numeric(10, 2) not null,
  protein_grams numeric(10, 2) not null,
  carbs_grams numeric(10, 2) not null,
  fat_grams numeric(10, 2) not null,
  fiber_grams numeric(10, 2) not null,
  ingredients jsonb not null default '[]'::jsonb,
  usage_count integer not null default 0,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_template_id)
);

create index if not exists saved_meal_templates_user_last_used_idx
  on saved_meal_templates (user_id, last_used_at desc);
