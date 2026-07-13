create table if not exists crawl_runs (
  id text primary key,
  run_type text not null,
  source text,
  target_id text,
  status text not null,
  started_at text not null default (datetime('now')),
  finished_at text,
  targets_requested integer not null default 0,
  targets_completed integer not null default 0,
  candidates_found integer not null default 0,
  candidates_accepted integer not null default 0,
  candidates_rejected integer not null default 0,
  warnings_json text,
  debug_json text,
  error_message text,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists crawl_discovered_urls (
  id text primary key,
  source text not null,
  target_id text not null,
  crawl_run_id text not null,
  listing_url text not null,
  canonical_url text not null,
  source_listing_id text,
  title text,
  price integer,
  beds real,
  baths real,
  neighborhood text,
  address text,
  latitude real,
  longitude real,
  discovery_confidence text,
  first_seen_at text not null default (datetime('now')),
  last_seen_at text not null default (datetime('now')),
  times_seen integer not null default 1,
  status text not null default 'discovered',
  rejection_reason text,
  metadata_json text,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  foreign key (crawl_run_id) references crawl_runs(id)
);

create unique index if not exists idx_crawl_discovered_urls_source_canonical
on crawl_discovered_urls(source, canonical_url);

create unique index if not exists idx_crawl_discovered_urls_source_listing_id
on crawl_discovered_urls(source, source_listing_id)
where source_listing_id is not null;

create index if not exists idx_crawl_discovered_urls_source_status
on crawl_discovered_urls(source, status);

create index if not exists idx_crawl_discovered_urls_target_last_seen
on crawl_discovered_urls(target_id, last_seen_at);

create index if not exists idx_crawl_runs_started_at
on crawl_runs(started_at);
