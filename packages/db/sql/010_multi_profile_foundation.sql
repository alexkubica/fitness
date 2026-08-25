create table if not exists health_profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  avatar_url text,
  linked_user_id text references users (id) on delete set null,
  owner_user_id text not null references users (id) on delete cascade,
  profile_type text not null default 'self',
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (profile_type in ('self', 'managed')),
  check (length(trim(display_name)) > 0),
  check (length(trim(timezone)) > 0)
);

create unique index if not exists health_profiles_linked_user_id_unique_idx
  on health_profiles (linked_user_id)
  where linked_user_id is not null;

create index if not exists health_profiles_owner_type_idx
  on health_profiles (owner_user_id, profile_type);

create table if not exists profile_access (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  profile_id uuid not null references health_profiles (id) on delete cascade,
  relationship text not null default 'self',
  role_identifier text not null default 'owner',
  status text not null default 'active',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, profile_id),
  check (status in ('active', 'pending', 'revoked', 'expired')),
  check (length(trim(relationship)) > 0),
  check (length(trim(role_identifier)) > 0)
);

create index if not exists profile_access_user_status_idx
  on profile_access (user_id, status, expires_at);

create index if not exists profile_access_profile_status_idx
  on profile_access (profile_id, status);

drop trigger if exists health_profiles_set_updated_at on health_profiles;
create trigger health_profiles_set_updated_at
before update on health_profiles
for each row execute function set_updated_at();

drop trigger if exists profile_access_set_updated_at on profile_access;
create trigger profile_access_set_updated_at
before update on profile_access
for each row execute function set_updated_at();

with self_profile_input as (
  select
    users.id as user_id,
    coalesce(nullif(users.name, ''), nullif(users.email, ''), users.id) as display_name,
    coalesce(nullif(users.timezone, ''), 'UTC') as timezone,
    users.created_at
  from users
),
upserted_profiles as (
  insert into health_profiles (
    display_name,
    linked_user_id,
    owner_user_id,
    profile_type,
    timezone,
    created_at
  )
  select
    display_name,
    user_id,
    user_id,
    'self',
    timezone,
    created_at
  from self_profile_input
  on conflict (linked_user_id) where linked_user_id is not null
  do update set
    owner_user_id = excluded.owner_user_id,
    profile_type = 'self',
    timezone = coalesce(nullif(health_profiles.timezone, ''), excluded.timezone)
  returning id, linked_user_id, created_at
)
insert into profile_access (
  user_id,
  profile_id,
  relationship,
  role_identifier,
  status,
  created_at
)
select
  linked_user_id,
  id,
  'self',
  'owner',
  'active',
  created_at
from upserted_profiles
where linked_user_id is not null
on conflict (user_id, profile_id) do nothing;

alter table health_metric_samples
  add column if not exists profile_id uuid references health_profiles (id) on delete cascade;

alter table daily_health_aggregates
  add column if not exists profile_id uuid references health_profiles (id) on delete cascade;

alter table health_sync_cursors
  add column if not exists profile_id uuid references health_profiles (id) on delete cascade;

alter table health_sync_batches
  add column if not exists profile_id uuid references health_profiles (id) on delete cascade;

alter table meals
  add column if not exists profile_id uuid references health_profiles (id) on delete cascade;

alter table check_ins
  add column if not exists profile_id uuid references health_profiles (id) on delete cascade;

alter table coach_memories
  add column if not exists profile_id uuid references health_profiles (id) on delete cascade;

alter table reports
  add column if not exists profile_id uuid references health_profiles (id) on delete cascade;

alter table write_proposals
  add column if not exists profile_id uuid references health_profiles (id) on delete cascade;

alter table saved_meal_templates
  add column if not exists profile_id uuid references health_profiles (id) on delete cascade;

alter table coach_profiles
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists profile_id uuid references health_profiles (id) on delete cascade;

alter table nutrition_daily_plans
  add column if not exists profile_id uuid references health_profiles (id) on delete cascade;

alter table meal_log_snapshots
  add column if not exists profile_id uuid references health_profiles (id) on delete cascade;

alter table audit_events
  add column if not exists profile_id uuid references health_profiles (id) on delete set null;

update health_metric_samples
set profile_id = health_profiles.id
from health_profiles
where health_metric_samples.profile_id is null
  and health_profiles.linked_user_id = health_metric_samples.user_id;

update daily_health_aggregates
set profile_id = health_profiles.id
from health_profiles
where daily_health_aggregates.profile_id is null
  and health_profiles.linked_user_id = daily_health_aggregates.user_id;

update health_sync_cursors
set profile_id = health_profiles.id
from health_profiles
where health_sync_cursors.profile_id is null
  and health_profiles.linked_user_id = health_sync_cursors.user_id;

update health_sync_batches
set profile_id = health_profiles.id
from health_profiles
where health_sync_batches.profile_id is null
  and health_profiles.linked_user_id = health_sync_batches.user_id;

update meals
set profile_id = health_profiles.id
from health_profiles
where meals.profile_id is null
  and health_profiles.linked_user_id = meals.user_id;

update check_ins
set profile_id = health_profiles.id
from health_profiles
where check_ins.profile_id is null
  and health_profiles.linked_user_id = check_ins.user_id;

update coach_memories
set profile_id = health_profiles.id
from health_profiles
where coach_memories.profile_id is null
  and health_profiles.linked_user_id = coach_memories.user_id;

update reports
set profile_id = health_profiles.id
from health_profiles
where reports.profile_id is null
  and health_profiles.linked_user_id = reports.user_id;

update write_proposals
set profile_id = health_profiles.id
from health_profiles
where write_proposals.profile_id is null
  and health_profiles.linked_user_id = write_proposals.user_id;

update saved_meal_templates
set profile_id = health_profiles.id
from health_profiles
where saved_meal_templates.profile_id is null
  and health_profiles.linked_user_id = saved_meal_templates.user_id;

update coach_profiles
set profile_id = health_profiles.id
from health_profiles
where coach_profiles.profile_id is null
  and health_profiles.linked_user_id = coach_profiles.user_id;

update nutrition_daily_plans
set profile_id = health_profiles.id
from health_profiles
where nutrition_daily_plans.profile_id is null
  and health_profiles.linked_user_id = nutrition_daily_plans.user_id;

update meal_log_snapshots
set profile_id = health_profiles.id
from health_profiles
where meal_log_snapshots.profile_id is null
  and health_profiles.linked_user_id = meal_log_snapshots.user_id;

update audit_events
set profile_id = health_profiles.id
from health_profiles
where audit_events.profile_id is null
  and health_profiles.linked_user_id = audit_events.user_id;

alter table health_metric_samples
  drop constraint if exists health_metric_samples_user_id_source_source_sample_id_metric_name_key;

create unique index if not exists health_metric_samples_profile_source_sample_metric_idx
  on health_metric_samples (profile_id, source, source_sample_id, metric_name)
  where profile_id is not null;

create unique index if not exists health_metric_samples_legacy_user_source_sample_metric_idx
  on health_metric_samples (user_id, source, source_sample_id, metric_name)
  where profile_id is null;

alter table daily_health_aggregates
  drop constraint if exists daily_health_aggregates_user_id_metric_name_date_timezone_key;

create unique index if not exists daily_health_aggregates_profile_metric_date_idx
  on daily_health_aggregates (profile_id, metric_name, date, timezone)
  where profile_id is not null;

create unique index if not exists daily_health_aggregates_legacy_user_metric_date_idx
  on daily_health_aggregates (user_id, metric_name, date, timezone)
  where profile_id is null;

alter table health_sync_cursors
  drop constraint if exists health_sync_cursors_user_id_source_healthkit_type_key;

create unique index if not exists health_sync_cursors_profile_source_type_idx
  on health_sync_cursors (profile_id, source, healthkit_type)
  where profile_id is not null;

create unique index if not exists health_sync_cursors_legacy_user_source_type_idx
  on health_sync_cursors (user_id, source, healthkit_type)
  where profile_id is null;

alter table health_sync_batches
  drop constraint if exists health_sync_batches_user_id_idempotency_key_key;

create unique index if not exists health_sync_batches_profile_idempotency_key_idx
  on health_sync_batches (profile_id, idempotency_key)
  where profile_id is not null;

create unique index if not exists health_sync_batches_legacy_user_idempotency_key_idx
  on health_sync_batches (user_id, idempotency_key)
  where profile_id is null;

alter table meals
  drop constraint if exists meals_user_id_idempotency_key_key;

drop index if exists meals_user_origin_client_meal_idx;

create unique index if not exists meals_profile_idempotency_key_idx
  on meals (profile_id, idempotency_key)
  where profile_id is not null;

create unique index if not exists meals_legacy_user_idempotency_key_idx
  on meals (user_id, idempotency_key)
  where profile_id is null;

create unique index if not exists meals_profile_origin_client_meal_idx
  on meals (profile_id, origin, client_meal_id)
  where profile_id is not null and client_meal_id is not null;

create unique index if not exists meals_legacy_user_origin_client_meal_idx
  on meals (user_id, origin, client_meal_id)
  where profile_id is null and client_meal_id is not null;

alter table check_ins
  drop constraint if exists check_ins_user_id_idempotency_key_key;

create unique index if not exists check_ins_profile_idempotency_key_idx
  on check_ins (profile_id, idempotency_key)
  where profile_id is not null;

create unique index if not exists check_ins_legacy_user_idempotency_key_idx
  on check_ins (user_id, idempotency_key)
  where profile_id is null;

alter table coach_memories
  drop constraint if exists coach_memories_user_id_key_key;

create unique index if not exists coach_memories_profile_key_idx
  on coach_memories (profile_id, key)
  where profile_id is not null;

create unique index if not exists coach_memories_legacy_user_key_idx
  on coach_memories (user_id, key)
  where profile_id is null;

alter table reports
  drop constraint if exists reports_user_id_idempotency_key_key;

create unique index if not exists reports_profile_idempotency_key_idx
  on reports (profile_id, idempotency_key)
  where profile_id is not null;

create unique index if not exists reports_legacy_user_idempotency_key_idx
  on reports (user_id, idempotency_key)
  where profile_id is null;

alter table write_proposals
  drop constraint if exists write_proposals_user_id_idempotency_key_key;

create unique index if not exists write_proposals_profile_idempotency_key_idx
  on write_proposals (profile_id, idempotency_key)
  where profile_id is not null;

create unique index if not exists write_proposals_legacy_user_idempotency_key_idx
  on write_proposals (user_id, idempotency_key)
  where profile_id is null;

alter table saved_meal_templates
  drop constraint if exists saved_meal_templates_user_id_client_template_id_key;

create unique index if not exists saved_meal_templates_profile_client_template_idx
  on saved_meal_templates (profile_id, client_template_id)
  where profile_id is not null;

create unique index if not exists saved_meal_templates_legacy_user_client_template_idx
  on saved_meal_templates (user_id, client_template_id)
  where profile_id is null;

update coach_profiles
set id = gen_random_uuid()
where id is null;

alter table coach_profiles
  alter column id set not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'coach_profiles'::regclass
      and conname = 'coach_profiles_pkey'
      and pg_get_constraintdef(oid) like '%(user_id)%'
  ) then
    alter table coach_profiles drop constraint coach_profiles_pkey;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'coach_profiles'::regclass
      and conname = 'coach_profiles_pkey'
  ) then
    alter table coach_profiles add constraint coach_profiles_pkey primary key (id);
  end if;
end $$;

create unique index if not exists coach_profiles_profile_id_unique_idx
  on coach_profiles (profile_id)
  where profile_id is not null;

create unique index if not exists coach_profiles_legacy_user_id_unique_idx
  on coach_profiles (user_id)
  where profile_id is null;

alter table nutrition_daily_plans
  drop constraint if exists nutrition_daily_plans_user_id_plan_date_key;

create unique index if not exists nutrition_daily_plans_profile_plan_date_idx
  on nutrition_daily_plans (profile_id, plan_date)
  where profile_id is not null;

create unique index if not exists nutrition_daily_plans_legacy_user_plan_date_idx
  on nutrition_daily_plans (user_id, plan_date)
  where profile_id is null;

create index if not exists health_metric_samples_profile_metric_start_idx
  on health_metric_samples (profile_id, metric_name, start_time);

create index if not exists health_metric_samples_profile_deleted_idx
  on health_metric_samples (profile_id, deleted_at);

create index if not exists meals_profile_deleted_occurred_idx
  on meals (profile_id, deleted_at, occurred_at);

create index if not exists saved_meal_templates_profile_last_used_idx
  on saved_meal_templates (profile_id, last_used_at desc);

create index if not exists coach_profiles_profile_updated_idx
  on coach_profiles (profile_id, updated_at desc);

create index if not exists meal_log_snapshots_profile_created_idx
  on meal_log_snapshots (profile_id, created_at desc);

create index if not exists audit_events_profile_created_idx
  on audit_events (profile_id, created_at);
