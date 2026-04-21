-- Token usage table
create table token_usage (
  id uuid primary key default gen_random_uuid(),
  req_id text not null unique,
  user_id text not null,
  cwd text not null,
  session_id text not null,
  model text not null,
  provider text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  created_at timestamptz not null default now()
);

-- Indexes
create index idx_token_usage_created_at on token_usage (created_at);
create index idx_token_usage_user on token_usage (user_id, created_at);
create index idx_token_usage_cwd on token_usage (cwd);
create index idx_token_usage_model on token_usage (model);

-- Enable RLS
alter table token_usage enable row level security;

-- Only service_role can INSERT
create policy "service_role_insert" on token_usage
  for insert with check (true);
