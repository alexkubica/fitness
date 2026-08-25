create table if not exists coach_profiles (
  user_id text primary key references users (id) on delete cascade,
  goal text not null,
  weight_kg numeric(6, 2) not null,
  estimated_steps_per_day integer not null,
  wake_time_minutes integer not null,
  sleep_time_minutes integer not null,
  meal_reminders_enabled boolean not null default true,
  meal_slots jsonb not null default '[]'::jsonb,
  targets jsonb not null,
  source text not null default 'unknown',
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (goal in ('lose_weight', 'maintain', 'gain_mass')),
  check (weight_kg >= 20 and weight_kg <= 400),
  check (estimated_steps_per_day >= 0 and estimated_steps_per_day <= 100000),
  check (wake_time_minutes >= 0 and wake_time_minutes < 1440),
  check (sleep_time_minutes >= 0 and sleep_time_minutes < 1440)
);

create index if not exists coach_profiles_updated_idx
  on coach_profiles (updated_at desc);

create table if not exists nutrition_daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  plan_date date not null,
  timezone text not null,
  title text not null,
  status text not null default 'draft',
  pantry_text text,
  notes text,
  target_totals jsonb not null,
  planned_totals jsonb not null,
  meals jsonb not null default '[]'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plan_date),
  check (status in ('draft', 'approved', 'archived'))
);

create index if not exists nutrition_daily_plans_user_date_idx
  on nutrition_daily_plans (user_id, plan_date desc);
