create table if not exists subway_stations (
  id text primary key,
  name text not null,
  borough text,
  latitude real not null,
  longitude real not null,
  lines text not null,
  gtfs_stop_ids text,
  created_at text not null default (datetime('now'))
);

create table if not exists listing_subway_estimates (
  id text primary key,
  listing_id text not null references listings(id) on delete cascade,
  station_id text not null,
  station_name text not null,
  lines text not null,
  straight_line_miles real not null,
  estimated_walk_minutes integer not null,
  estimate_method text not null,
  confidence text not null,
  google_maps_directions_url text,
  created_at text not null default (datetime('now'))
);

create index if not exists idx_listing_subway_estimates_listing
  on listing_subway_estimates(listing_id);

create index if not exists idx_subway_stations_location
  on subway_stations(latitude, longitude);

-- sqlite alter table does not support if not exists; these run once via migration tracking
alter table listings add column subway_walk_source text;
alter table listings add column subway_walk_confidence text;
alter table listings add column google_maps_directions_url text;
