alter table profile_access
  add column if not exists access_version bigint not null default 1;

alter table profile_access
  drop constraint if exists profile_access_status_check;
alter table profile_access
  add constraint profile_access_status_check
  check (status in ('active', 'inactive', 'pending', 'revoked', 'expired'));

alter table profile_access
  drop constraint if exists profile_access_access_version_check;
alter table profile_access
  add constraint profile_access_access_version_check
  check (access_version >= 1);

create table if not exists profile_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  profile_access_id uuid not null references profile_access (id) on delete cascade,
  permission_id text not null,
  effect text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_permission_overrides_permission_id_check
    check (length(trim(permission_id)) > 0),
  constraint profile_permission_overrides_effect_check
    check (effect in ('allow', 'deny')),
  constraint profile_permission_overrides_access_permission_unique
    unique (profile_access_id, permission_id)
);

create index if not exists profile_permission_overrides_profile_access_idx
  on profile_permission_overrides (profile_access_id);

drop trigger if exists profile_permission_overrides_set_updated_at
  on profile_permission_overrides;
create trigger profile_permission_overrides_set_updated_at
before update on profile_permission_overrides
for each row execute function set_updated_at();

create or replace function increment_profile_access_version()
returns trigger
language plpgsql
as $$
begin
  new.access_version := old.access_version + 1;
  return new;
end;
$$;

drop trigger if exists profile_access_increment_version on profile_access;
create trigger profile_access_increment_version
before update of role_identifier, status, expires_at on profile_access
for each row
when (
  old.role_identifier is distinct from new.role_identifier
  or old.status is distinct from new.status
  or old.expires_at is distinct from new.expires_at
)
execute function increment_profile_access_version();

create or replace function bump_profile_access_version_for_override()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    update profile_access
    set access_version = access_version + 1
    where id = old.profile_access_id;

    return old;
  end if;

  update profile_access
  set access_version = access_version + 1
  where id = new.profile_access_id;

  return new;
end;
$$;

drop trigger if exists profile_permission_overrides_bump_access_version
  on profile_permission_overrides;
create trigger profile_permission_overrides_bump_access_version
after insert or update or delete on profile_permission_overrides
for each row execute function bump_profile_access_version_for_override();
