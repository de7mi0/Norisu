-- Saloni — saved salons, on the account
--
-- The heart on a salon page has been there since the prototype and remembered
-- nothing: it lived in the browser's memory and was gone on the next refresh,
-- and no screen ever listed what had been saved. A control that looks like it
-- did something and did not is a small dark pattern, so it is real now — kept
-- on the account, so it follows the customer to another phone.
--
-- What is stored is a pair of ids and a time. A salon learns nothing from
-- being saved: there is no count, no list of who saved it, and no function
-- that crosses this table for anybody but its own account.

create table saved_salons (
  profile_id uuid not null references profiles (id) on delete cascade,
  salon_id   uuid not null references salons (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, salon_id)
);

alter table saved_salons enable row level security;

-- Named, not table-wide: a row is the account and the salon, and the account
-- is not something the caller gets to choose — the policy pins it to them.
revoke all on saved_salons from anon, authenticated;
grant select, delete on saved_salons to authenticated;
grant insert (profile_id, salon_id) on saved_salons to authenticated;

-- Your own, and only a salon customers can see: saving an unpublished salon
-- would let an account probe for ids that are not in the catalogue.
create policy saved_salons_own on saved_salons
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and salon_is_public(salon_id));

-- A list somebody reads, not a store: two hundred is more than anybody keeps,
-- and a cap means one account cannot fill the table.
create function public.saved_salons_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select count(*) from saved_salons where profile_id = new.profile_id) >= 200 then
    raise exception 'too many saved salons' using errcode = 'SL050';
  end if;
  return new;
end;
$$;

revoke all on function public.saved_salons_cap() from public;
revoke execute on function public.saved_salons_cap() from anon, authenticated;

create trigger saved_salons_cap
  before insert on saved_salons
  for each row execute function public.saved_salons_cap();
