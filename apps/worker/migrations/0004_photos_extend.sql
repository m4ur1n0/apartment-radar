alter table listing_photos add column source text;
alter table listing_photos add column width integer;
alter table listing_photos add column height integer;
alter table listing_photos add column alt_text text;
create index if not exists idx_listing_photos_listing_id on listing_photos(listing_id);
create unique index if not exists idx_listing_photos_unique on listing_photos(listing_id, source_url);
