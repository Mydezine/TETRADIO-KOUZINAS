-- Ειδοποιήσεις μέσα στην εφαρμογή και στο κινητό (Web Push). Τρέχει ξανά χωρίς πρόβλημα.
-- Χρειάζεται πρώτα τα schema.sql, admin.sql, profiles.sql, kitchen.sql και την Edge Function send-push.

create extension if not exists pg_net;

-- Ιδιωτικός χώρος για κλειδιά: δεν φαίνεται από το API.
create schema if not exists private;
create table if not exists private.app_secrets (name text primary key, value text not null);

-- ---------- Πίνακες ----------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  params jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  lang text not null default 'el',
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'own notifications read') then
    create policy "own notifications read" on public.notifications for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'own notifications mark read') then
    create policy "own notifications mark read" on public.notifications for update to authenticated
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' and policyname = 'own push subscriptions') then
    create policy "own push subscriptions" on public.push_subscriptions for all to authenticated
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;

-- Ζωντανή ενημέρωση του καμπανακιού.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- Το δημόσιο κλειδί για την εγγραφή του κινητού (το ιδιωτικό μένει κρυφό).
create or replace function public.vapid_public_key()
returns text language sql stable security definer set search_path = ''
as $$ select value from private.app_secrets where name = 'vapid_public' $$;
grant execute on function public.vapid_public_key() to anon, authenticated;

-- ---------- Αποστολή στο κινητό ----------
create or replace function private.push_notification()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare subs jsonb; pub text; priv text;
begin
  select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'lang', s.lang))
    into subs from public.push_subscriptions s where s.user_id = new.user_id;
  select value into pub from private.app_secrets where name = 'vapid_public';
  select value into priv from private.app_secrets where name = 'vapid_private';
  if subs is null or pub is null or priv is null then return new; end if;
  perform net.http_post(
    url := 'https://uunbbysygubdgqpwuopa.supabase.co/functions/v1/send-push',
    body := jsonb_build_object('send', true, 'kind', new.kind, 'params', new.params,
      'vapid', jsonb_build_object('pub', pub, 'priv', priv), 'subs', subs),
    headers := '{"Content-Type": "application/json"}'::jsonb);
  return new;
end $$;
create or replace trigger notifications_push after insert on public.notifications
  for each row execute function private.push_notification();

-- ---------- Πότε δημιουργούνται ειδοποιήσεις ----------
-- 1. Κάποιος μπήκε στην ομάδα σου.
create or replace function private.on_team_join()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare t public.teams; who text;
begin
  select * into t from public.teams where id = new.team_id;
  select coalesce(nullif(p.full_name, ''), u.email) into who
    from auth.users u left join public.profiles p on p.user_id = u.id where u.id = new.user_id;
  insert into public.notifications (user_id, kind, params)
    values (t.owner_id, 'team_join', jsonb_build_object('team', t.name, 'team_id', t.id, 'restaurant_id', t.restaurant_id, 'name', who));
  return new;
end $$;
create or replace trigger team_members_notify after insert on public.team_members
  for each row execute function private.on_team_join();

-- 2. Νέα συνταγή σε εστιατόριο με ομάδα: ειδοποιούνται τα μέλη.
create or replace function private.on_team_recipe()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.restaurant_id is null then return new; end if;
  insert into public.notifications (user_id, kind, params)
    select m.user_id, 'team_recipe', jsonb_build_object('team', t.name, 'team_id', t.id, 'title', new.title)
    from public.teams t join public.team_members m on m.team_id = t.id
    where t.restaurant_id = new.restaurant_id;
  return new;
end $$;
create or replace trigger recipes_team_notify after insert on public.recipes
  for each row execute function private.on_team_recipe();

-- 3. Νέος μάγειρας γράφτηκε: ειδοποιείται ο διαχειριστής.
create or replace function private.on_new_chef()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (user_id, kind, params)
    select a.user_id, 'new_chef', jsonb_build_object('email', new.email, 'chef_id', new.id) from public.admins a;
  return new;
end $$;
create or replace trigger auth_users_new_chef after insert on auth.users
  for each row execute function private.on_new_chef();

-- ---------- Δραστηριότητα μαγείρων (για τον διαχειριστή) ----------
create table if not exists public.user_activity (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
alter table public.user_activity enable row level security;

-- Η εφαρμογή το καλεί κάθε λίγα λεπτά όσο είναι ανοιχτή. Ειδοποιεί τον διαχειριστή
-- όταν ένας μάγειρας ανοίγει την εφαρμογή μετά από 3+ ώρες.
create or replace function public.touch_activity()
returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid()); prev timestamptz; who text; mail text;
begin
  if uid is null then return; end if;
  select last_seen_at into prev from public.user_activity where user_id = uid;
  insert into public.user_activity (user_id, last_seen_at) values (uid, now())
    on conflict (user_id) do update set last_seen_at = now();
  if (prev is null or prev < now() - interval '3 hours') and not exists (select 1 from public.admins where user_id = uid) then
    select u.email, coalesce(nullif(p.full_name, ''), u.email) into mail, who
      from auth.users u left join public.profiles p on p.user_id = u.id where u.id = uid;
    insert into public.notifications (user_id, kind, params)
      select a.user_id, 'chef_active', jsonb_build_object('name', who, 'email', mail, 'chef_id', uid) from public.admins a;
  end if;
end $$;
grant execute on function public.touch_activity() to authenticated;

create or replace function public.admin_activity()
returns table (user_id uuid, last_seen_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query select a.user_id, a.last_seen_at from public.user_activity a;
end $$;
grant execute on function public.admin_activity() to authenticated;

-- Τα κλειδιά VAPID φτιάχνονται μία φορά από την Edge Function send-push ({"generate": true})
-- και μπαίνουν στο private.app_secrets ως vapid_public / vapid_private.
