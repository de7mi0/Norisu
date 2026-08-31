-- Saloni — somewhere to put a photograph
--
-- Every salon, service and stylist in the app is a coloured placeholder tile.
-- It is the most visible thing missing and the last TODO(roadmap) marker in the
-- code: the Gallery screen's upload button has never had a handler.
--
-- This migration is only the place the files go and the rules about who may put
-- them there. Resizing, size limits and stripping the GPS coordinates out of a
-- phone photo happen in the browser before the upload, because they have to
-- happen before the bytes leave the device to be worth anything.
--
-- THE PATH IS THE PERMISSION. Every object is stored as
--
--     <salon id>/<kind>/<file>          e.g. 3f9a…/cover/8c21….jpg
--
-- so `(storage.foldername(name))[1]` is the salon, and a policy can ask
-- is_salon_owner() about it. Get that layout wrong and the rules below stop
-- meaning anything, which is why the app builds the path in one place.

-- ---------------------------------------------------------------------------
-- 1. The bucket
-- ---------------------------------------------------------------------------

-- Public to read: these are photographs a salon wants customers to see, and
-- gating them behind a signed URL would mean the catalogue could not render for
-- somebody who is not signed in — which is most visitors.
--
-- The limits are enforced by the storage service itself, so they hold even if a
-- caller skips the app entirely. The browser also resizes well below them; this
-- is the backstop, not the mechanism.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'salon-photos',
  'salon-photos',
  true,
  3 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Who may write into it
-- ---------------------------------------------------------------------------

-- Anyone may look. The bucket is public, and this makes that explicit rather
-- than relying on the flag alone.
drop policy if exists salon_photos_read on storage.objects;
create policy salon_photos_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'salon-photos');

-- An owner may add files, and only inside their own salon's folder. The path's
-- first segment has to be a salon they own, which is the whole rule.
drop policy if exists salon_photos_insert on storage.objects;
create policy salon_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'salon-photos'
    and is_salon_owner(((storage.foldername(name))[1])::uuid)
  );

-- Replacing one is the same permission as adding one. Both sides are checked:
-- `using` for the file being overwritten, `with check` for what it becomes, so
-- a file cannot be moved out of its own salon's folder into somebody else's.
drop policy if exists salon_photos_update on storage.objects;
create policy salon_photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'salon-photos'
    and is_salon_owner(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'salon-photos'
    and is_salon_owner(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists salon_photos_delete on storage.objects;
create policy salon_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'salon-photos'
    and is_salon_owner(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------------
-- 3. What is deliberately not here
-- ---------------------------------------------------------------------------
--
-- salon_media already carries everything needed to say which photograph is
-- which — storage_path, is_cover, sort_order, alt_text — with a unique index
-- enforcing one cover per salon and policies (0002) that let an owner write
-- only their own. It has simply never had a row. No change was needed, and
-- adding columns that duplicate what is there would have been the easiest way
-- to make this worse.
--
-- One real gap left standing: alt_text is a single string in an app that is
-- otherwise bilingual throughout. Worth an alt_ar beside it, but that is a
-- decision about editing rather than about storage, and this migration is
-- about where the bytes live.
