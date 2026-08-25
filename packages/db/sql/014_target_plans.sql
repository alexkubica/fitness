create table if not exists target_plans (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references health_profiles (id) on delete cascade,
  version integer not null,
  goal text not null,
  status text not null,
  calculation_mode text not null,
  effective_from date not null,
  effective_until date,
  created_by_user_id text not null references users (id),
  creator_relationship text,
  source text not null,
  reason text not null,
  owner_response text,
  targets jsonb not null,
  activated_at timestamptz,
  activated_by_user_id text references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint target_plans_profile_version_unique unique (profile_id, version),
  constraint target_plans_version_check check (version >= 1),
  constraint target_plans_goal_check
    check (goal in ('lose_weight', 'maintain', 'gain_mass')),
  constraint target_plans_status_check
    check (status in ('draft', 'proposed', 'active', 'rejected', 'superseded', 'archived')),
  constraint target_plans_calculation_mode_check
    check (calculation_mode in ('automatic', 'manual', 'coach_manual', 'imported_legacy')),
  constraint target_plans_effective_range_check
    check (effective_until is null or effective_until > effective_from),
  constraint target_plans_reason_check check (length(trim(reason)) > 0),
  constraint target_plans_targets_object_check
    check (jsonb_typeof(targets) = 'object')
);

create unique index if not exists target_plans_one_active_idx
  on target_plans (profile_id)
  where status = 'active';

create index if not exists target_plans_profile_history_idx
  on target_plans (profile_id, version desc);

create index if not exists target_plans_effective_range_idx
  on target_plans (profile_id, effective_from, effective_until)
  where status in ('active', 'superseded');

create table if not exists target_plan_events (
  id uuid primary key default gen_random_uuid(),
  target_plan_id uuid not null references target_plans (id) on delete cascade,
  profile_id uuid not null references health_profiles (id) on delete cascade,
  action text not null,
  actor_user_id text not null references users (id),
  reason text,
  owner_response text,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint target_plan_events_action_check
    check (action in ('created', 'proposed', 'approved', 'rejected', 'activated', 'superseded', 'archived', 'administrative_correction')),
  constraint target_plan_events_idempotency_key_check
    check (idempotency_key is null or length(trim(idempotency_key)) > 0)
);

create unique index if not exists target_plan_events_idempotency_idx
  on target_plan_events (profile_id, actor_user_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists target_plan_events_plan_created_idx
  on target_plan_events (target_plan_id, created_at);

drop trigger if exists target_plans_set_updated_at on target_plans;
create trigger target_plans_set_updated_at
before update on target_plans
for each row execute function set_updated_at();

insert into target_plans (
  profile_id,
  version,
  goal,
  status,
  calculation_mode,
  effective_from,
  created_by_user_id,
  creator_relationship,
  source,
  reason,
  targets,
  activated_at,
  activated_by_user_id,
  created_at,
  updated_at
)
select
  coach.profile_id,
  1,
  coach.goal,
  'active',
  'imported_legacy',
  (coach.created_at at time zone profile.timezone)::date,
  coach.user_id,
  'owner',
  'migration',
  'Imported from the legacy coach profile target configuration.',
  jsonb_strip_nulls(jsonb_build_object(
    'maintenanceCalories', coach.targets -> 'maintenanceCalories',
    'selectedCalories', coach.targets -> 'selectedCalories',
    'proteinGrams', coach.targets -> 'proteinGrams',
    'carbohydratesGrams', coach.targets -> 'carbsGrams',
    'fatGrams', coach.targets -> 'fatGrams',
    'fiberGrams', coach.targets -> 'fiberGrams',
    'steps', coach.estimated_steps_per_day
  )),
  coach.updated_at,
  coach.user_id,
  coach.created_at,
  coach.updated_at
from coach_profiles coach
join health_profiles profile on profile.id = coach.profile_id
where coach.profile_id is not null
  and not exists (
    select 1
    from target_plans existing
    where existing.profile_id = coach.profile_id
  );

insert into target_plan_events (
  target_plan_id,
  profile_id,
  action,
  actor_user_id,
  reason,
  metadata,
  created_at
)
select
  plan.id,
  plan.profile_id,
  'activated',
  plan.created_by_user_id,
  plan.reason,
  jsonb_build_object('source', 'migration', 'version', plan.version),
  plan.created_at
from target_plans plan
where plan.source = 'migration'
  and not exists (
    select 1
    from target_plan_events event
    where event.target_plan_id = plan.id
      and event.action = 'activated'
  );
