-- 0023: the cities a salon serves, and where it is on a map.
--
-- Two things found by testing the app as a salon owner would:
--
--   * A salon could name one city, typed freehand in English. Saloni is meant
--     to cover the whole Kingdom, and a business with branches in Riyadh and
--     Jeddah had no way to say so. `cities` holds every city it serves;
--     `city` stays as the first of them so nothing that reads it breaks.
--     The values are the English city names from the app's own list
--     (src/data/cities.ts), which is what the customer's city filter compares
--     against — the Arabic is a display concern and lives in the app.
--
--   * A salon had no location a customer could follow. `latitude` and
--     `longitude` have existed since 0001 and nothing ever wrote them.
--     `maps_url` is the link an owner gets from Google Maps' Share button,
--     which is how a Saudi owner actually knows their own address; the
--     coordinates are filled when they use "my current location" instead.
--
-- Column privileges, because a policy sees whole rows (CLAUDE.md §7): each
-- new column is named in the SELECT, INSERT and UPDATE grants it belongs in,
-- and in no other. Both are the owner's to write and the public's to read —
-- a salon's address is the opposite of a secret.

alter table salons
  add column cities   text[] not null default '{}',
  add column maps_url text;

-- Every existing salon serves the one city it already named.
update salons set cities = array[city] where cardinality(cities) = 0;

alter table salons
  -- Bounded like every other owner-written text (0015): a backstop, not a style
  -- guide. Twenty cities and 600 characters is more than any real salon needs.
  add constraint salon_cities_shape check (
    cardinality(cities) <= 20
    and array_position(cities, null) is null
    and length(array_to_string(cities, ',')) <= 600
  ),
  -- The link is shown to every customer and opened on a tap, so it is held to
  -- Google Maps' own hosts. Without this an owner could point "Directions" at
  -- any page on the internet, and a link from inside the app is trusted in a
  -- way an unknown one is not.
  add constraint salon_maps_url_is_google_maps check (
    maps_url is null
    or (
      length(maps_url) <= 500
      -- The domain is spelled out to its end: google.com, google.com.sa,
      -- google.co.uk, google.de. A looser [a-z.]+ also matched
      -- maps.google.com.evil.example, which assertion 129b caught.
      and maps_url ~ '^https://((www\.)?google\.(com|com\.[a-z]{2}|co\.[a-z]{2}|[a-z]{2})/maps|maps\.google\.(com|com\.[a-z]{2}|co\.[a-z]{2}|[a-z]{2})/|maps\.app\.goo\.gl/|goo\.gl/maps/)'
    )
  ),
  add constraint salon_coordinates_in_range check (
    (latitude is null) = (longitude is null)
    and (latitude is null or latitude between -90 and 90)
    and (longitude is null or longitude between -180 and 180)
  );

comment on column salons.cities is
  'Every city the salon serves, English names from the app''s list. city is the first of them.';
comment on column salons.maps_url is
  'A Google Maps link the owner pasted. Restricted to Google Maps hosts by constraint.';

grant select (cities, maps_url) on salons to anon, authenticated;
grant insert (cities, maps_url) on salons to authenticated;
grant update (cities, maps_url) on salons to authenticated;
