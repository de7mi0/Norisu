-- 0024: a salon's reviews, as a customer browsing it sees them.
--
-- Customers could not write a review, and the salon page's reviews were the
-- bundled sample ones even for a real salon. Writing needs nothing new here:
-- reviews_insert_after_visit (0002) already admits a review of your own
-- completed booking, and 0015 granted exactly the five columns a customer
-- fills in. Reading is what needs this function.
--
-- The rows themselves are readable — reviews_select shows published reviews
-- of a public salon to anybody. The reviewer's name is not: profiles_select_own
-- lets nobody read a profile but their own, which is right. The privacy policy
-- tells customers a review is "shown on the salon's page ... with your name
-- beside it", so the page needs a name, and this function crosses that
-- boundary as narrowly as 0005's do for the salon: a shortened display name —
-- first name and an initial, "Nora A." — and nothing else about the person.
-- No id, no e-mail, no phone, no full surname.
--
-- Open to anon on purpose, like available_slots(): browsing is ungated. The
-- guard is inside: a salon that is not public answers nothing, and an
-- unpublished review is never returned.

create function public.public_reviews(p_salon_id uuid)
returns table (
  review_id   uuid,
  rating      numeric,
  body        text,
  reply       text,
  replied_at  timestamptz,
  created_at  timestamptz,
  author      text,
  services_en text,
  services_ar text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not salon_is_public(p_salon_id) then
    return;
  end if;

  return query
  select
    r.id,
    r.rating,
    r.body,
    r.reply,
    r.replied_at,
    r.created_at,
    -- First word, then the first letter of the second if there is one.
    -- Null when the customer gave no name; the app says "Verified visit".
    nullif(
      trim(
        split_part(trim(p.full_name), ' ', 1)
        || coalesce(' ' || nullif(left(split_part(trim(p.full_name), ' ', 2), 1), '') || '.', '')
      ),
      ''
    ),
    -- What the visit was for, from the price snapshot rather than the live
    -- services, so a renamed service does not rewrite an old review.
    (select string_agg(bi.name_en, ' · ' order by bi.name_en)
       from booking_items bi where bi.booking_id = r.booking_id),
    (select string_agg(bi.name_ar, ' · ' order by bi.name_en)
       from booking_items bi where bi.booking_id = r.booking_id)
  from reviews r
  left join profiles p on p.id = r.customer_id
  where r.salon_id = p_salon_id
    and r.is_published
  order by r.created_at desc
  limit 200;
end;
$$;

comment on function public.public_reviews(uuid) is
  'Published reviews of a public salon, with a shortened reviewer name (first name and initial) '
  'and nothing else about the reviewer. Open to anon because browsing is ungated.';

-- Both lines, every time: revoking from PUBLIC leaves Supabase's named grants,
-- and the named revoke leaves PUBLIC (CLAUDE.md §10, 0022). Then granted back
-- to exactly the two roles that browse.
revoke all on function public.public_reviews(uuid) from public;
revoke execute on function public.public_reviews(uuid) from anon, authenticated;
grant execute on function public.public_reviews(uuid) to anon, authenticated;
