-- Saloni — an owner may edit their salon, but not approve it
--
-- salons_update_own lets an owner update their own row, and the blanket
-- `grant update on all tables ... to authenticated` in 0002 meant that covered
-- *every* column — including is_verified and is_published.
--
-- So any salon owner could run
--
--   update salons set is_verified = true, is_published = true where id = <mine>
--
-- and appear in the customer catalogue immediately, with nobody having checked
-- their commercial registration. published_salons_are_verified enforces the
-- *order* of those two flags, not who is allowed to set them, so it did not
-- help: setting both at once satisfies it.
--
-- Row-level security cannot express "this column is off limits" — a policy sees
-- whole rows. Column-level privileges can, and are the right tool here.
--
-- Approval stays a human act performed in the Supabase dashboard, which
-- connects as service_role and is unaffected by this. See supabase/README.md.

revoke update on salons from authenticated;

-- Everything an owner legitimately maintains about their own salon. Deliberately
-- enumerated rather than "all except": a column added later is not writable
-- until someone decides it should be, which is the safer way round for a
-- privilege boundary.
--
-- Left out on purpose:
--   id, created_at   — not the owner's to change
--   owner_id         — a salon is not transferable in the app
--   is_verified      — the approval itself
--   is_published     — going live follows approval, not the owner's say-so
grant update (
  slug,
  name_en,
  name_ar,
  tags_en,
  tags_ar,
  category_en,
  category_ar,
  area_en,
  area_ar,
  city,
  latitude,
  longitude,
  phone,
  cr_number,
  waitlist_enabled,
  updated_at,
  slot_step_minutes
) on salons to authenticated;

comment on column salons.is_verified is
  'Set only by an admin through the dashboard. authenticated has no UPDATE privilege on this column — see 0004.';

comment on column salons.is_published is
  'Follows verification, and like it is not writable by the salon owner. See 0004.';
