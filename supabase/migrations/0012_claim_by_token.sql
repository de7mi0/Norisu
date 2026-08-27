-- Saloni — the notification's link lands on the seat, not on the front door
--
-- waitlist_offers.claim_token has existed since 0009, described there as the
-- "single-use secret in the notification's deep link", and 0010 has been
-- putting it into every queued message as `?claim=<token>`. Nothing has ever
-- read it back. Tapping a notification opened Saloni, and the held seat was one
-- more tap away on the Bookings screen.
--
-- Two taps is not a rounding error here: the hold is fifteen minutes, the
-- notification arrives while somebody is doing something else, and every extra
-- step is a chance for the seat to pass to the next person while they are still
-- looking for it.
--
-- The security shape is deliberately unchanged. The token identifies the offer;
-- it does not authorise anything by itself. claim_waitlist_offer() still checks
-- the offer belongs to whoever is signed in, so a link forwarded to a friend is
-- useless to them — which is exactly what makes it safe to put in a message
-- that could be screenshotted or shared.

create function public.claim_offer_by_token(p_token uuid)
returns table (booking_id uuid, reference text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer uuid;
begin
  select id into v_offer from waitlist_offers where claim_token = p_token;

  -- A token that does not exist and a token belonging to somebody else are
  -- refused identically, and with the same message claim_waitlist_offer() uses
  -- for the same case. Otherwise this becomes an oracle for guessing which
  -- tokens are real.
  if v_offer is null then
    raise exception 'that offer is not yours' using errcode = '42501';
  end if;

  -- Everything else — is it yours, is it still open, is the hold still yours or
  -- has the slot opened to everyone, and the pricing and chair assignment of
  -- the booking itself — is 0009's, unchanged. This function resolves a token
  -- and nothing more.
  return query select * from claim_waitlist_offer(v_offer);
end;
$$;

revoke all on function public.claim_offer_by_token(uuid) from public;
revoke execute on function public.claim_offer_by_token(uuid) from anon;
grant execute on function public.claim_offer_by_token(uuid) to authenticated;

comment on function public.claim_offer_by_token(uuid) is
  'Claims the seat a notification was about, from the claim_token in its link. '
  'Ownership is still checked, so a forwarded link claims nothing.';
