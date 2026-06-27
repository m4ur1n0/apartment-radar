-- sqlite alter table does not support if not exists; run once via migration tracking
alter table listings add column amenities_json text;
