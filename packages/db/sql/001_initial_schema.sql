create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'write_proposal_status') then
    create type write_proposal_status as enum (
      'pending',
      'approved',
      'rejected',
      'committed',
      'expired'
    );
  end if;
end $$;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists users (
  id text primary key,
  email text unique,
  name text,
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists users_deleted_at_idx on users (deleted_at);

create table if not exists health_metric_definitions (
  id uuid primary key default gen_random_uuid(),
  metric_name text not null,
  unit text not null,
  description text,
  source text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (metric_name, unit)
);

create index if not exists health_metric_definitions_metric_name_idx
  on health_metric_definitions (metric_name);

create table if not exists health_metric_samples (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  metric_name text not null,
  value numeric(14, 4) not null,
  unit text not null,
  source text not null,
  source_sample_id text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  timezone text not null,
  ingested_at timestamptz not null default now(),
  deleted_at timestamptz,
  metadata jsonb,
  unique (user_id, source, source_sample_id, metric_name),
  foreign key (metric_name, unit)
    references health_metric_definitions (metric_name, unit)
    on delete restrict,
  check (end_time >= start_time)
);

create index if not exists health_metric_samples_user_metric_start_idx
  on health_metric_samples (user_id, metric_name, start_time);
create index if not exists health_metric_samples_user_source_idx
  on health_metric_samples (user_id, source);
create index if not exists health_metric_samples_user_deleted_idx
  on health_metric_samples (user_id, deleted_at);

create table if not exists daily_health_aggregates (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  metric_name text not null,
  date date not null,
  timezone text not null,
  value numeric(14, 4) not null,
  unit text not null,
  sample_count integer not null default 0,
  computed_at timestamptz not null default now(),
  unique (user_id, metric_name, date, timezone),
  foreign key (metric_name, unit)
    references health_metric_definitions (metric_name, unit)
    on delete restrict
);

create index if not exists daily_health_aggregates_user_date_idx
  on daily_health_aggregates (user_id, date);
create index if not exists daily_health_aggregates_user_metric_date_idx
  on daily_health_aggregates (user_id, metric_name, date);

create table if not exists health_sync_cursors (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  source text not null,
  healthkit_type text not null,
  cursor text,
  anchor bytea,
  last_synced_at timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, healthkit_type)
);

create index if not exists health_sync_cursors_user_source_idx
  on health_sync_cursors (user_id, source);
create index if not exists health_sync_cursors_last_synced_idx
  on health_sync_cursors (last_synced_at);

create table if not exists health_sync_batches (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  idempotency_key text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists health_sync_batches_user_created_idx
  on health_sync_batches (user_id, created_at);

create table if not exists telegram_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  telegram_user_id text not null unique,
  telegram_chat_id text,
  username text,
  first_name text,
  last_name text,
  linked_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_accounts_user_revoked_idx
  on telegram_accounts (user_id, revoked_at);
create index if not exists telegram_accounts_chat_idx
  on telegram_accounts (telegram_chat_id);

create table if not exists telegram_link_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  token_hash text not null unique,
  nonce text not null,
  state text not null,
  intended_telegram_user_id text,
  consumed_by_telegram_user_id text,
  consumed_by_telegram_chat_id text,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (nonce, state)
);

create index if not exists telegram_link_tokens_user_expires_idx
  on telegram_link_tokens (user_id, expires_at);
create index if not exists telegram_link_tokens_used_expires_idx
  on telegram_link_tokens (used_at, expires_at);
create index if not exists telegram_link_tokens_revoked_idx
  on telegram_link_tokens (revoked_at);

create table if not exists telegram_processed_updates (
  id uuid primary key default gen_random_uuid(),
  telegram_update_id bigint not null unique,
  telegram_user_id text,
  telegram_chat_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz not null default now()
);

create index if not exists telegram_processed_updates_user_processed_idx
  on telegram_processed_updates (telegram_user_id, processed_at);

create table if not exists meals (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  idempotency_key text not null,
  occurred_at timestamptz not null,
  timezone text not null,
  description text,
  photo_storage_key text,
  origin text not null,
  provenance jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists meals_user_occurred_idx on meals (user_id, occurred_at);
create index if not exists meals_user_origin_idx on meals (user_id, origin);

create table if not exists meal_estimates (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references meals (id) on delete cascade,
  idempotency_key text not null,
  calories numeric(10, 2) not null,
  protein_grams numeric(10, 2) not null,
  carbs_grams numeric(10, 2) not null,
  fat_grams numeric(10, 2) not null,
  confidence numeric(5, 4) not null,
  provenance jsonb not null,
  model_name text,
  estimated_at timestamptz not null default now(),
  unique (meal_id, idempotency_key),
  check (confidence >= 0 and confidence <= 1)
);

create index if not exists meal_estimates_meal_estimated_idx
  on meal_estimates (meal_id, estimated_at);

create table if not exists meal_corrections (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references meals (id) on delete cascade,
  idempotency_key text not null,
  corrected_calories numeric(10, 2),
  corrected_protein_grams numeric(10, 2),
  corrected_carbs_grams numeric(10, 2),
  corrected_fat_grams numeric(10, 2),
  corrected_by_user_id text not null references users (id) on delete cascade,
  provenance jsonb,
  corrected_at timestamptz not null default now(),
  unique (meal_id, idempotency_key)
);

create index if not exists meal_corrections_meal_corrected_idx
  on meal_corrections (meal_id, corrected_at);
create index if not exists meal_corrections_user_corrected_idx
  on meal_corrections (corrected_by_user_id, corrected_at);

create table if not exists check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  idempotency_key text not null,
  checked_in_at timestamptz not null,
  timezone text not null,
  hunger integer,
  mood integer,
  energy integer,
  stress integer,
  cravings integer,
  notes text,
  origin text not null,
  provenance jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists check_ins_user_checked_idx
  on check_ins (user_id, checked_in_at);
create index if not exists check_ins_user_origin_idx
  on check_ins (user_id, origin);

create table if not exists coach_memories (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  kind text not null,
  key text not null,
  value jsonb not null,
  confidence numeric(5, 4),
  source text not null,
  provenance jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (user_id, key),
  check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create index if not exists coach_memories_user_kind_idx
  on coach_memories (user_id, kind);
create index if not exists coach_memories_user_archived_idx
  on coach_memories (user_id, archived_at);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  idempotency_key text not null,
  type text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  timezone text not null,
  summary text,
  payload jsonb not null,
  generated_by text not null,
  provenance jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  check (period_end >= period_start)
);

create index if not exists reports_user_type_period_idx
  on reports (user_id, type, period_start);
create index if not exists reports_user_created_idx
  on reports (user_id, created_at);

create table if not exists write_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  idempotency_key text not null,
  action text not null,
  type text not null,
  target_type text,
  target_id text,
  payload jsonb not null,
  status write_proposal_status not null default 'pending',
  proposed_by text not null,
  approved_at timestamptz,
  rejected_at timestamptz,
  committed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists write_proposals_user_status_expires_idx
  on write_proposals (user_id, status, expires_at);
create index if not exists write_proposals_target_idx
  on write_proposals (target_type, target_id);
create index if not exists write_proposals_proposed_created_idx
  on write_proposals (proposed_by, created_at);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id text references users (id) on delete set null,
  idempotency_key text,
  actor_type text not null,
  actor_id text,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists audit_events_idempotency_key_idx
  on audit_events (idempotency_key)
  where idempotency_key is not null;
create index if not exists audit_events_user_created_idx
  on audit_events (user_id, created_at);
create index if not exists audit_events_actor_idx
  on audit_events (actor_type, actor_id);
create index if not exists audit_events_target_idx
  on audit_events (target_type, target_id);
create index if not exists audit_events_action_created_idx
  on audit_events (action, created_at);

drop trigger if exists users_set_updated_at on users;
create trigger users_set_updated_at
before update on users
for each row execute function set_updated_at();

drop trigger if exists health_metric_definitions_set_updated_at on health_metric_definitions;
create trigger health_metric_definitions_set_updated_at
before update on health_metric_definitions
for each row execute function set_updated_at();

drop trigger if exists health_sync_cursors_set_updated_at on health_sync_cursors;
create trigger health_sync_cursors_set_updated_at
before update on health_sync_cursors
for each row execute function set_updated_at();

drop trigger if exists telegram_accounts_set_updated_at on telegram_accounts;
create trigger telegram_accounts_set_updated_at
before update on telegram_accounts
for each row execute function set_updated_at();

drop trigger if exists meals_set_updated_at on meals;
create trigger meals_set_updated_at
before update on meals
for each row execute function set_updated_at();

drop trigger if exists coach_memories_set_updated_at on coach_memories;
create trigger coach_memories_set_updated_at
before update on coach_memories
for each row execute function set_updated_at();

drop trigger if exists write_proposals_set_updated_at on write_proposals;
create trigger write_proposals_set_updated_at
before update on write_proposals
for each row execute function set_updated_at();
