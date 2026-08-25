create table if not exists oauth_authorization_codes (
  code_hash text primary key,
  user_id text not null references users (id) on delete cascade,
  client_id text not null,
  redirect_uri text not null,
  resource text not null,
  scope text not null,
  code_challenge text not null,
  code_challenge_method text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists oauth_authorization_codes_user_idx
  on oauth_authorization_codes (user_id);

create index if not exists oauth_authorization_codes_expires_at_idx
  on oauth_authorization_codes (expires_at);

create table if not exists oauth_refresh_tokens (
  token_hash text primary key,
  family_id uuid not null,
  user_id text not null references users (id) on delete cascade,
  client_id text not null,
  resource text not null,
  scope text not null,
  expires_at timestamptz not null,
  rotated_at timestamptz,
  revoked_at timestamptz,
  replaced_by_token_hash text,
  created_at timestamptz not null default now()
);

create index if not exists oauth_refresh_tokens_user_idx
  on oauth_refresh_tokens (user_id);

create index if not exists oauth_refresh_tokens_family_idx
  on oauth_refresh_tokens (family_id);

create index if not exists oauth_refresh_tokens_expires_at_idx
  on oauth_refresh_tokens (expires_at);
