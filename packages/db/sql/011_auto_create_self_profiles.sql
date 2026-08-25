create or replace function ensure_user_self_profile()
returns trigger
language plpgsql
as $$
declare
  self_profile_id uuid;
begin
  insert into health_profiles (
    display_name,
    linked_user_id,
    owner_user_id,
    profile_type,
    timezone,
    created_at
  )
  values (
    coalesce(nullif(new.name, ''), nullif(new.email, ''), new.id),
    new.id,
    new.id,
    'self',
    coalesce(nullif(new.timezone, ''), 'UTC'),
    new.created_at
  )
  on conflict (linked_user_id) where linked_user_id is not null
  do update set
    owner_user_id = excluded.owner_user_id,
    profile_type = 'self',
    timezone = coalesce(nullif(health_profiles.timezone, ''), excluded.timezone)
  returning id into self_profile_id;

  insert into profile_access (
    user_id,
    profile_id,
    relationship,
    role_identifier,
    status,
    created_at
  )
  values (
    new.id,
    self_profile_id,
    'self',
    'owner',
    'active',
    new.created_at
  )
  on conflict (user_id, profile_id) do nothing;

  return new;
end;
$$;

drop trigger if exists users_ensure_self_profile on users;
create trigger users_ensure_self_profile
after insert on users
for each row execute function ensure_user_self_profile();
