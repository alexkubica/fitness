create table if not exists meal_log_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  operation_type text not null,
  affected_local_date date not null,
  timezone text not null,
  source text not null,
  description text not null,
  before_state jsonb not null,
  after_state jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists meal_log_snapshots_user_created_idx
  on meal_log_snapshots (user_id, created_at desc);

create index if not exists meal_log_snapshots_user_date_idx
  on meal_log_snapshots (user_id, affected_local_date, created_at desc);

create index if not exists meal_log_snapshots_expires_idx
  on meal_log_snapshots (expires_at);
