-- Saloni — a salon answers a review
--
-- 0006 revoked UPDATE on reviews from authenticated outright, and granted
-- nothing back. That was deliberate rather than lazy: the customer owns the
-- rating and the body, the salon owns the reply, and a grant applies per role
-- rather than per row — so there is no column list that describes both. Before
-- it, a salon could rewrite a 1.0 "Terrible" into a 5.0 rave in the customer's
-- own name.
--
-- So replying arrives the way that migration said it would have to: as one
-- narrow security definer function that can write exactly two columns and
-- nothing else, guarded like the 0005 functions are.

-- The longest reply the salon may leave. Long enough to answer a complaint
-- properly, short enough that the review list stays readable and a paste of
-- something else cannot take over the page.
create function public.reply_to_review(
  p_review_id uuid,
  p_reply     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_salon uuid;
  v_reply text := left(coalesce(p_reply, ''), 1000);
begin
  select salon_id into v_salon from reviews where id = p_review_id;

  -- A missing review and someone else's review answer identically on purpose:
  -- probing this function must not reveal which reviews exist.
  if v_salon is null or not is_salon_owner(v_salon) then
    raise exception 'not the owner of the salon this review is about'
      using errcode = '42501';
  end if;

  -- Only these two columns. The rating and the body belong to the customer and
  -- this function cannot reach them, which is the whole point of it existing.
  update reviews
     set reply      = btrim(v_reply),
         -- Clearing the reply clears the timestamp too, so "replied" and "has
         -- a reply" can never disagree.
         replied_at = case when btrim(v_reply) = '' then null else now() end
   where id = p_review_id;
end;
$$;

comment on function public.reply_to_review(uuid, text) is
  'Lets a salon answer a review of itself. security definer because 0006 revoked UPDATE on reviews '
  'from authenticated — the customer owns rating and body, the salon owns reply, and a column grant '
  'cannot express that split. Writes reply and replied_at only.';

revoke all on function public.reply_to_review(uuid, text) from public;
grant execute on function public.reply_to_review(uuid, text) to authenticated;
