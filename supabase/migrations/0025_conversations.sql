-- Saloni — talking to a person
--
-- The app has had a "message the salon" screen and a "Saloni Assistant" since
-- the prototype, and both were theatre: the salon chat answered itself with a
-- canned "a team member will confirm shortly", and the assistant told a
-- customer "I've flagged this for the salon manager" when nothing had been
-- sent anywhere. A support channel that says it passed something on and did
-- not is worse than no support channel: the customer stops looking for help
-- because they think they already asked.
--
-- This is the real half. A conversation is between one customer and either
-- one salon (answered by its owner, in the vendor portal) or Saloni itself
-- (answered by an administrator, in the back office). The assistant stays in
-- the browser — it answers from a written FAQ and hands over to one of these
-- when it cannot help — so nothing here knows about it.
--
-- THE SHAPE OF THE BOUNDARY. Neither table is readable or writable by any
-- browser role, and neither has a row policy. Everything goes through the
-- functions below, for three reasons that each would have needed its own
-- workaround otherwise:
--
--   * Who may write depends on WHICH SIDE you are on, not on a column: the
--     customer writes as 'customer', the salon's owner as 'salon', an
--     administrator as 'saloni'. A grant cannot say that (CLAUDE.md §7), and a
--     side taken from the request would be a side the caller chose.
--   * The salon needs the customer's name and profiles_select_own forbids it,
--     the same boundary 0005 crosses for the calendar. These cross it the same
--     way: nullif(full_name, '') and nothing else — no e-mail, no phone.
--   * A customer must still see a conversation with a salon that has since
--     closed or been unpublished, which salons_select_published would hide.
--
-- Not built, deliberately: a salon cannot START a conversation with a
-- customer. Only answer one. Otherwise every account that ever booked becomes
-- a marketing list, and the policy promises a salon sees a name and nothing
-- else.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table conversations (
  id              uuid primary key default gen_random_uuid(),
  -- The person who asked. Their conversations go with them when they delete
  -- their account (0016): what they said is theirs, not the salon's record.
  customer_id     uuid not null references profiles (id) on delete cascade,
  -- Null means Saloni itself. A salon that is closed keeps its threads, so
  -- the customer can still read what was said; nobody can answer them.
  salon_id        uuid references salons (id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_side       text not null default 'customer',
  customer_read_at timestamptz not null default now(),
  staff_read_at   timestamptz,
  constraint conversations_last_side check (last_side in ('customer', 'salon', 'saloni'))
);

-- One thread per customer per salon, and one with Saloni — like a messaging
-- app, not a ticket queue. Asking again continues the same thread, so the
-- salon sees the history rather than five unrelated openings.
create unique index conversations_customer_salon_idx
  on conversations (customer_id, salon_id) where salon_id is not null;
create unique index conversations_customer_support_idx
  on conversations (customer_id) where salon_id is null;
create index conversations_salon_idx on conversations (salon_id, last_message_at desc);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  -- Who wrote it. Set null when a salon owner or administrator deletes their
  -- account, so the customer's thread keeps the reply and loses the person.
  sender_id       uuid references profiles (id) on delete set null,
  side            text not null,
  body            text not null,
  -- clock_timestamp(), not now(): now() is the start of the transaction, so
  -- two messages written in one would tie and their order would be a coin
  -- toss. Every time below that orders messages or decides "unread" uses it.
  created_at      timestamptz not null default clock_timestamp(),
  constraint messages_side check (side in ('customer', 'salon', 'saloni')),
  constraint messages_body_length check (length(btrim(body)) between 1 and 1000)
);

create index messages_conversation_idx on messages (conversation_id, created_at);
create index messages_sender_recent_idx on messages (sender_id, created_at desc);

alter table conversations enable row level security;
alter table messages      enable row level security;

-- No policies, and no grants. 0002 granted DML on ALL TABLES that existed
-- then; a later table inherits Supabase's default privileges instead, which
-- are just as broad. Say it explicitly rather than relying on either.
revoke all on conversations from anon, authenticated;
revoke all on messages      from anon, authenticated;

-- Whether a new message also queues a push. OFF until the worker is redeployed
-- with the version that knows what a message is: the old worker composes every
-- row as a waitlist offer, and would tell a salon owner "A seat has opened at"
-- when a customer had asked about parking. supabase/README.md has the order.
alter table notification_settings
  add column message_push boolean not null default false;

comment on column notification_settings.message_push is
  'Whether a new message in a conversation (0025) queues a push to the other side. Switch on '
  'only after deploying a send-notifications worker that understands kind = message.';

-- ---------------------------------------------------------------------------
-- 2. Queueing a push about a message
-- ---------------------------------------------------------------------------

-- One pending push per recipient per conversation: five messages in a row are
-- one buzz, not five, and the service worker's tag replaces rather than
-- stacks once it arrives. Same rules as an offer — switched on, allowed by the
-- person, and a device to send it to — or nothing is queued.
create function public.enqueue_message_notification(
  p_conversation_id uuid,
  p_recipient uuid,
  p_from_en text,
  p_from_ar text,
  p_body text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  p profiles%rowtype;
  s notification_settings%rowtype;
begin
  select * into s from notification_settings where id;
  if s.id is null or not s.message_push or not ('push' = any (s.channels)) then
    return;
  end if;

  select * into p from profiles where id = p_recipient;
  if p.id is null or not p.allow_push then
    return;
  end if;
  if not exists (select 1 from push_subscriptions where profile_id = p.id) then
    return;
  end if;

  if exists (
    select 1 from notifications n
    where n.profile_id = p.id
      and n.sent_at is null and n.failed_at is null
      and n.payload ->> 'conversation_id' = p_conversation_id::text
  ) then
    return;
  end if;

  insert into notifications (profile_id, channel, template, payload, locale, send_after)
  values (
    p.id, 'push', 'new_message',
    jsonb_build_object(
      'kind',            'message',
      'conversation_id', p_conversation_id,
      'from',            jsonb_build_object('en', p_from_en, 'ar', p_from_ar),
      -- A preview, as every messaging app shows. Capped so a long message is
      -- not a long lock-screen.
      'preview',         left(btrim(p_body), 140),
      -- An hour of retries at most; after that the unread mark in the app is
      -- how they find out.
      'expires_at',      now() + interval '1 hour',
      'url',             s.app_base_url
    ),
    p.locale,
    now()
  );
end;
$$;

revoke all on function public.enqueue_message_notification(uuid, uuid, text, text, text) from public;
revoke execute on function public.enqueue_message_notification(uuid, uuid, text, text, text)
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Writing
-- ---------------------------------------------------------------------------

-- The one place a message is inserted. Decides the caller's side from who they
-- are, caps how much one account can send, and tells the other side.
create function public.post_message(p_conversation_id uuid, p_body text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := auth.uid();
  c       conversations%rowtype;
  v_side  text;
  v_body  text := btrim(coalesce(p_body, ''));
  v_id    uuid;
  v_owner uuid;
  v_salon_en text;
  v_salon_ar text;
  v_name  text;
  r       record;
begin
  if v_me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  select * into c from conversations where id = p_conversation_id for update;
  if c.id is null then
    raise exception 'no such conversation' using errcode = '42501';
  end if;

  if c.customer_id = v_me then
    v_side := 'customer';
  elsif c.salon_id is not null and is_salon_owner(c.salon_id) then
    v_side := 'salon';
  elsif c.salon_id is null and is_admin() then
    v_side := 'saloni';
  else
    -- Indistinguishable from "does not exist", so an id is not an oracle.
    raise exception 'no such conversation' using errcode = '42501';
  end if;

  if length(v_body) < 1 or length(v_body) > 1000 then
    raise exception 'a message is 1 to 1000 characters' using errcode = 'SL042';
  end if;

  -- Thirty in ten minutes is a fast typist; more is somebody scripting it,
  -- and a salon owner's phone is the thing that would buzz.
  if (select count(*) from messages
       where sender_id = v_me and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'too many messages' using errcode = 'SL041';
  end if;

  if c.salon_id is not null then
    select owner_id, name_en, name_ar into v_owner, v_salon_en, v_salon_ar
    from salons where id = c.salon_id;
    -- A closed salon has nobody to answer. Saying so beats a message that
    -- sits unread forever while the customer waits on it.
    if v_owner is null then
      raise exception 'this salon is closed' using errcode = 'SL040';
    end if;
  end if;

  insert into messages (conversation_id, sender_id, side, body)
  values (c.id, v_me, v_side, v_body)
  returning id into v_id;

  update conversations
     set last_message_at  = clock_timestamp(),
         last_side        = v_side,
         customer_read_at = case when v_side = 'customer' then clock_timestamp() else customer_read_at end,
         staff_read_at    = case when v_side <> 'customer' then clock_timestamp() else staff_read_at end
   where id = c.id;

  -- Tell the other side.
  if v_side = 'customer' then
    select nullif(full_name, '') into v_name from profiles where id = v_me;
    if c.salon_id is not null then
      perform enqueue_message_notification(
        c.id, v_owner,
        coalesce(v_name, 'A customer'), coalesce(v_name, 'عميلة'), v_body);
    else
      for r in select id from profiles where role = 'admin' and id <> v_me loop
        perform enqueue_message_notification(
          c.id, r.id,
          coalesce(v_name, 'A customer') || ' · Saloni support',
          coalesce(v_name, 'عميلة') || ' · دعم صالوني', v_body);
      end loop;
    end if;
  elsif v_side = 'salon' then
    perform enqueue_message_notification(c.id, c.customer_id, v_salon_en, v_salon_ar, v_body);
  else
    perform enqueue_message_notification(c.id, c.customer_id, 'Saloni', 'صالوني', v_body);
  end if;

  return v_id;
end;
$$;

revoke all on function public.post_message(uuid, text) from public;
revoke execute on function public.post_message(uuid, text) from anon, authenticated;
grant execute on function public.post_message(uuid, text) to authenticated;

-- A customer opens (or continues) a conversation with a salon, or with Saloni
-- when p_salon_id is null, and says the first thing in it.
create function public.start_conversation(p_salon_id uuid, p_body text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_me  uuid := auth.uid();
  v_id  uuid;
  v_owner uuid;
  v_published boolean;
begin
  if v_me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  if p_salon_id is not null then
    select owner_id, is_published into v_owner, v_published from salons where id = p_salon_id;
    -- Reachable if customers can find it, or if this customer has been there:
    -- somebody whose salon went quiet still has a booking to ask about.
    if v_owner is null
       or not (v_published or exists (
         select 1 from bookings b where b.salon_id = p_salon_id and b.customer_id = v_me)) then
      raise exception 'this salon cannot be messaged' using errcode = 'SL040';
    end if;
    if v_owner = v_me then
      raise exception 'this is your own salon' using errcode = 'SL044';
    end if;
    select id into v_id from conversations where customer_id = v_me and salon_id = p_salon_id;
  else
    select id into v_id from conversations where customer_id = v_me and salon_id is null;
  end if;

  if v_id is null then
    -- Five new salons a day. Continuing a thread is not counted; opening a
    -- conversation with every salon in Riyadh is.
    if (select count(*) from conversations
         where customer_id = v_me and created_at > now() - interval '1 day') >= 5 then
      raise exception 'too many new conversations' using errcode = 'SL041';
    end if;
    insert into conversations (customer_id, salon_id) values (v_me, p_salon_id)
    returning id into v_id;
  end if;

  perform post_message(v_id, p_body);
  return v_id;
end;
$$;

revoke all on function public.start_conversation(uuid, text) from public;
revoke execute on function public.start_conversation(uuid, text) from anon, authenticated;
grant execute on function public.start_conversation(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reading
-- ---------------------------------------------------------------------------

-- The messages of one conversation the caller is part of, oldest first, and
-- marks it read for the caller's side. `mine` is computed here so the app
-- never has to know which side it is on to draw the bubbles.
create function public.conversation_messages(p_conversation_id uuid)
returns table (id uuid, side text, body text, created_at timestamptz, mine boolean)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := auth.uid();
  c      conversations%rowtype;
  v_side text;
begin
  select * into c from conversations where conversations.id = p_conversation_id;
  if v_me is null or c.id is null then
    raise exception 'no such conversation' using errcode = '42501';
  end if;

  if c.customer_id = v_me then
    v_side := 'customer';
    update conversations set customer_read_at = clock_timestamp() where conversations.id = c.id;
  elsif (c.salon_id is not null and is_salon_owner(c.salon_id))
     or (c.salon_id is null and is_admin()) then
    v_side := 'staff';
    update conversations set staff_read_at = clock_timestamp() where conversations.id = c.id;
  else
    raise exception 'no such conversation' using errcode = '42501';
  end if;

  return query
  select m.id, m.side, m.body, m.created_at,
         case when v_side = 'customer' then m.side = 'customer' else m.side <> 'customer' end
  from messages m
  where m.conversation_id = c.id
  order by m.created_at, m.id
  limit 500;
end;
$$;

revoke all on function public.conversation_messages(uuid) from public;
revoke execute on function public.conversation_messages(uuid) from anon, authenticated;
grant execute on function public.conversation_messages(uuid) to authenticated;

-- The customer's own conversations, with the salon's name even if it has
-- since closed — the thread is still theirs to read.
create function public.my_conversations()
returns table (
  conversation_id uuid,
  salon_id        uuid,
  name_en         text,
  name_ar         text,
  can_reply       boolean,
  last_body       text,
  last_side       text,
  last_message_at timestamptz,
  unread          boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.salon_id,
         coalesce(s.name_en, 'Saloni support'),
         coalesce(s.name_ar, 'دعم صالوني'),
         c.salon_id is null or s.owner_id is not null,
         (select m.body from messages m where m.conversation_id = c.id
           order by m.created_at desc, m.id desc limit 1),
         c.last_side, c.last_message_at,
         c.last_side <> 'customer' and c.last_message_at > c.customer_read_at
  from conversations c
  left join salons s on s.id = c.salon_id
  where c.customer_id = auth.uid()
  order by c.last_message_at desc
  limit 100;
$$;

revoke all on function public.my_conversations() from public;
revoke execute on function public.my_conversations() from anon, authenticated;
grant execute on function public.my_conversations() to authenticated;

-- Who is waiting on the people answering: a salon owner's threads, or Saloni's
-- support threads for an administrator. The customer's name and nothing else
-- about them, the same line 0005 draws for the calendar.
create function public.staff_inbox(p_support boolean)
returns table (
  conversation_id uuid,
  customer_name   text,
  last_body       text,
  last_side       text,
  last_message_at timestamptz,
  unread          boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or (p_support and not is_admin()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query
  select c.id,
         nullif(p.full_name, ''),
         (select m.body from messages m where m.conversation_id = c.id
           order by m.created_at desc, m.id desc limit 1),
         c.last_side, c.last_message_at,
         c.last_side = 'customer'
           and (c.staff_read_at is null or c.last_message_at > c.staff_read_at)
  from conversations c
  join profiles p on p.id = c.customer_id
  where case when p_support
             then c.salon_id is null
             else c.salon_id in (select s.id from salons s where s.owner_id = auth.uid())
        end
  order by c.last_message_at desc
  limit 200;
end;
$$;

revoke all on function public.staff_inbox(boolean) from public;
revoke execute on function public.staff_inbox(boolean) from anon, authenticated;
grant execute on function public.staff_inbox(boolean) to authenticated;
