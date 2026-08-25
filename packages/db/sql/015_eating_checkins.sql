alter table planned_meals
  drop constraint if exists planned_meals_status_check;

update planned_meals
set status = 'confirmed'
where status = 'eaten_as_planned';

update planned_meals
set status = 'unconfirmed'
where status = 'not_confirmed';

alter table planned_meals
  add constraint planned_meals_status_check
  check (
    status in (
      'planned',
      'confirmed',
      'partially_eaten',
      'replaced',
      'skipped',
      'unconfirmed'
    )
  );

create table if not exists eating_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  profile_id uuid references health_profiles (id) on delete cascade,
  idempotency_key text,
  occurred_at timestamptz not null,
  timezone text not null,
  linked_meal_id uuid references meals (id) on delete set null,
  linked_planned_meal_id uuid references planned_meals (id) on delete set null,
  hunger_before integer,
  fullness_after integer,
  urge_intensity integer,
  emotion_intensity integer,
  emotions text[] not null default '{}',
  triggers text[] not null default '{}',
  automatic_thought text,
  balanced_response text,
  eating_context text,
  loss_of_control boolean,
  ate_until_pain boolean,
  ate_with_screen boolean,
  ate_from_package boolean,
  took_second_serving boolean,
  coping_action text,
  urge_delay_minutes integer,
  outcome text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(timezone)) > 0),
  check (idempotency_key is null or length(trim(idempotency_key)) > 0),
  check (hunger_before is null or hunger_before between 0 and 10),
  check (fullness_after is null or fullness_after between 0 and 10),
  check (urge_intensity is null or urge_intensity between 0 and 10),
  check (emotion_intensity is null or emotion_intensity between 0 and 10),
  check (urge_delay_minutes is null or urge_delay_minutes >= 0),
  check (
    eating_context is null or eating_context in (
      'physical_hunger',
      'emotional_eating',
      'habit',
      'social',
      'boredom',
      'stress',
      'fatigue',
      'screen_eating',
      'unknown'
    )
  )
);

create unique index if not exists eating_checkins_profile_idempotency_key_idx
  on eating_checkins (profile_id, idempotency_key)
  where profile_id is not null and idempotency_key is not null;

create unique index if not exists eating_checkins_legacy_user_idempotency_key_idx
  on eating_checkins (user_id, idempotency_key)
  where profile_id is null and idempotency_key is not null;

create index if not exists eating_checkins_profile_occurred_idx
  on eating_checkins (profile_id, occurred_at desc);

create index if not exists eating_checkins_user_occurred_idx
  on eating_checkins (user_id, occurred_at desc);

create index if not exists eating_checkins_profile_meal_idx
  on eating_checkins (profile_id, linked_meal_id)
  where linked_meal_id is not null;

create index if not exists eating_checkins_profile_planned_meal_idx
  on eating_checkins (profile_id, linked_planned_meal_id)
  where linked_planned_meal_id is not null;

drop trigger if exists eating_checkins_set_updated_at on eating_checkins;
create trigger eating_checkins_set_updated_at
before update on eating_checkins
for each row execute function set_updated_at();
