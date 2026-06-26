create table if not exists listings (
  id text primary key,
  canonical_url text not null unique,
  source text not null,
  source_listing_id text,
  title text,
  description text,

  address_text text,
  neighborhood text,
  borough text default 'Brooklyn',
  latitude real,
  longitude real,

  rent integer not null,
  beds real not null,
  baths real not null,
  sqft integer,
  available_date text,

  nearest_subway_station text,
  nearest_subway_lines text,
  subway_walk_minutes integer,
  manhattan_commute_minutes integer,

  fee_status text,
  laundry text,
  dishwasher integer,
  outdoor_space integer,
  pets text,
  floor_number integer,
  elevator integer,

  fit_score real default 0,
  deal_score real default 0,
  urgency_score real default 0,
  risk_score real default 0,

  status text not null default 'active',
  first_seen_at text not null default (datetime('now')),
  last_seen_at text not null default (datetime('now')),
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists listing_snapshots (
  id text primary key,
  listing_id text not null references listings(id) on delete cascade,
  rent integer,
  sqft integer,
  title text,
  description text,
  raw_json text,
  captured_at text not null default (datetime('now'))
);

create table if not exists listing_photos (
  id text primary key,
  listing_id text not null references listings(id) on delete cascade,
  source_url text not null,
  position integer,
  is_floorplan integer default 0,
  ai_notes text,
  human_verified integer default 0,
  created_at text not null default (datetime('now'))
);

create table if not exists user_ratings (
  id text primary key,
  listing_id text not null references listings(id) on delete cascade,
  user_name text not null,
  rating integer not null,
  decision text,
  notes text,
  created_at text not null default (datetime('now'))
);

create table if not exists search_runs (
  id integer primary key autoincrement,
  source text not null,
  status text not null,
  started_at text not null,
  finished_at text,
  listings_found integer default 0,
  listings_inserted integer default 0,
  listings_updated integer default 0,
  notes text
);

create index if not exists idx_listings_score
  on listings(status, urgency_score desc, fit_score desc);

create index if not exists idx_listings_location
  on listings(neighborhood, rent, beds, baths);

create index if not exists idx_ratings_listing
  on user_ratings(listing_id, user_name);
