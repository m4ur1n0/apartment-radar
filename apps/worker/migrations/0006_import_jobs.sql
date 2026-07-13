create table if not exists crawl_import_jobs (
  id text primary key,
  source text not null,
  discovered_url_id text not null,
  listing_url text not null,
  canonical_url text not null,
  source_listing_id text,
  status text not null default 'pending',
  priority integer not null default 0,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  last_error text,
  locked_at text,
  locked_by text,
  next_attempt_at text,
  started_at text,
  completed_at text,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp,
  foreign key (discovered_url_id) references crawl_discovered_urls(id)
);

create unique index if not exists idx_crawl_import_jobs_source_canonical
on crawl_import_jobs(source, canonical_url);

create index if not exists idx_crawl_import_jobs_status_next_attempt
on crawl_import_jobs(status, next_attempt_at);

create index if not exists idx_crawl_import_jobs_source_status
on crawl_import_jobs(source, status);

create index if not exists idx_crawl_import_jobs_discovered_url
on crawl_import_jobs(discovered_url_id);
