create table if not exists crawl_target_state (
  target_id text primary key,
  source text not null,
  enabled integer not null default 1,
  priority integer not null default 0,
  last_discovery_at text,
  next_discovery_at text,
  last_discovery_status text,
  last_discovery_run_id text,
  consecutive_failures integer not null default 0,
  last_error text,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp
);
create index if not exists idx_crawl_target_state_due on crawl_target_state(enabled, next_discovery_at, priority);
create index if not exists idx_crawl_target_state_source on crawl_target_state(source, enabled);
