create table if not exists telegram_reminder_preferences (
  user_id text primary key references users (id) on delete cascade,
  enabled boolean not null default false,
  timezone text not null default 'UTC',
  slots jsonb not null default '[]'::jsonb,
  quiet_hours jsonb,
  last_sent_at_by_slot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(slots) = 'array'),
  check (quiet_hours is null or jsonb_typeof(quiet_hours) = 'object'),
  check (jsonb_typeof(last_sent_at_by_slot) = 'object')
);

create index if not exists telegram_reminder_preferences_enabled_idx
  on telegram_reminder_preferences (enabled, updated_at);

drop trigger if exists telegram_reminder_preferences_set_updated_at
  on telegram_reminder_preferences;
create trigger telegram_reminder_preferences_set_updated_at
before update on telegram_reminder_preferences
for each row execute function set_updated_at();
