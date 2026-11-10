-- Κοστολόγηση, κοινοποίηση συνταγών και ομάδες κουζίνας.
-- Τρέχει ξανά χωρίς πρόβλημα. Χρειάζεται πρώτα τα schema.sql, admin.sql, profiles.sql.

-- ---------- Κοστολόγηση ----------
alter table public.recipes add column if not exists sell_price numeric;

create table if not exists public.ingredient_prices (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name_key text not null,
  name text not null,
  price numeric not null check (price >= 0),
  unit text not null check (unit in ('kg', 'l', 'τεμ')),
  updated_at timestamptz not null default now(),
  primary key (user_id, name_key)
);
alter table public.ingredient_prices enable row level security;

-- ---------- Κοινοποίηση συνταγής με σύνδεσμο ----------
alter table public.recipes add column if not exists share_token text unique;

-- Ανάγνωση μίας κοινοποιημένης συνταγής από οποιονδήποτε έχει τον σύνδεσμο (χωρίς τιμές/κόστος).
create or replace function public.get_shared_recipe(tok text)
returns json language sql stable security definer set search_path = ''
as $$
  select json_build_object(
    'title', r.title, 'category', r.category, 'yield_qty', r.yield_qty, 'yield_unit', r.yield_unit,
    'prep_min', r.prep_min, 'cook_min', r.cook_min, 'ingredients', r.ingredients, 'steps', r.steps,
    'allergens', r.allergens, 'notes', r.notes, 'photo_path', r.photo_path,
    'chef_name', coalesce(p.full_name, ''), 'restaurant', coalesce(rs.name, ''))
  from public.recipes r
  left join public.profiles p on p.user_id = r.user_id
  left join public.restaurants rs on rs.id = r.restaurant_id
  where tok is not null and length(tok) >= 16 and r.share_token = tok
$$;
grant execute on function public.get_shared_recipe(text) to anon, authenticated;

-- ---------- Ομάδες κουζίνας (μία ομάδα ανά εστιατόριο) ----------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  restaurant_id uuid not null unique references public.restaurants (id) on delete cascade,
  name text not null,
  invite_code text not null unique,
  created_at timestamptz not null default now()
);
alter table public.teams enable row level security;

create table if not exists public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
alter table public.team_members enable row level security;

create or replace function public.is_team_member(tid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.team_members where team_id = tid and user_id = (select auth.uid())) $$;

create or replace function public.is_team_owner(tid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.teams where id = tid and owner_id = (select auth.uid())) $$;

create or replace function public.team_can_read_restaurant(rid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.teams t join public.team_members m on m.team_id = t.id
    where t.restaurant_id = rid and m.user_id = (select auth.uid()))
$$;

-- Φωτογραφίες: ορατές αν η συνταγή είναι κοινοποιημένη ή ανήκει σε ομάδα του χρήστη.
create or replace function public.photo_is_readable(obj text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.recipes r
    where r.photo_path is not null
      and (r.photo_path = obj or regexp_replace(r.photo_path, '\.jpg$', '_t.jpg') = obj)
      and (r.share_token is not null or (r.restaurant_id is not null and public.team_can_read_restaurant(r.restaurant_id))))
$$;

-- Είσοδος σε ομάδα με κωδικό.
create or replace function public.join_team(code text)
returns json language plpgsql security definer set search_path = ''
as $$
declare t public.teams;
begin
  if (select auth.uid()) is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into t from public.teams where invite_code = upper(trim(code));
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if t.owner_id = (select auth.uid()) then return json_build_object('ok', false, 'error', 'own_team'); end if;
  insert into public.team_members (team_id, user_id) values (t.id, (select auth.uid())) on conflict do nothing;
  return json_build_object('ok', true, 'team_id', t.id, 'name', t.name);
end $$;
grant execute on function public.join_team(text) to authenticated;

-- Οι ομάδες όπου είμαι μέλος.
create or replace function public.my_teams()
returns table (team_id uuid, team_name text, restaurant_id uuid, owner_name text, owner_email text)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.name, t.restaurant_id, coalesce(p.full_name, ''), u.email::text
  from public.team_members m
  join public.teams t on t.id = m.team_id
  join auth.users u on u.id = t.owner_id
  left join public.profiles p on p.user_id = t.owner_id
  where m.user_id = (select auth.uid())
  order by t.name
$$;
grant execute on function public.my_teams() to authenticated;

-- Τα μέλη μιας ομάδας, μόνο για τον σεφ που την έφτιαξε.
create or replace function public.team_member_list(tid uuid)
returns table (user_id uuid, full_name text, email text, joined_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_team_owner(tid) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select m.user_id, coalesce(p.full_name, ''), u.email::text, m.joined_at
    from public.team_members m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.user_id = m.user_id
    where m.team_id = tid order by m.joined_at;
end $$;
grant execute on function public.team_member_list(uuid) to authenticated;

-- ---------- Κανόνες πρόσβασης ----------
do $$
begin
  -- τιμές υλικών: μόνο ο ίδιος (και ο διαχειριστής για ανάγνωση)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ingredient_prices' and policyname = 'own prices') then
    create policy "own prices" on public.ingredient_prices for all to authenticated
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ingredient_prices' and policyname = 'admin reads prices') then
    create policy "admin reads prices" on public.ingredient_prices for select to authenticated using ((select public.is_admin()));
  end if;

  -- ομάδες: ο σεφ τις διαχειρίζεται, τα μέλη τις βλέπουν
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'teams' and policyname = 'own teams') then
    create policy "own teams" on public.teams for all to authenticated
      using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'teams' and policyname = 'members read teams') then
    create policy "members read teams" on public.teams for select to authenticated using ((select public.is_team_member(id)));
  end if;

  -- μέλη: ο σεφ προσθέτει/αφαιρεί, το μέλος βλέπει και μπορεί να αποχωρήσει (όχι να προσθέσει άλλους)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'team_members' and policyname = 'owner manages members') then
    create policy "owner manages members" on public.team_members for all to authenticated
      using ((select public.is_team_owner(team_id))) with check ((select public.is_team_owner(team_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'team_members' and policyname = 'own membership') then
    create policy "own membership" on public.team_members for all to authenticated
      using ((select auth.uid()) = user_id) with check (false);
  end if;

  -- τα μέλη της ομάδας διαβάζουν το εστιατόριο και τις συνταγές του
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'restaurants' and policyname = 'team reads restaurants') then
    create policy "team reads restaurants" on public.restaurants for select to authenticated
      using ((select public.team_can_read_restaurant(id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'recipes' and policyname = 'team reads recipes') then
    create policy "team reads recipes" on public.recipes for select to authenticated
      using (restaurant_id is not null and (select public.team_can_read_restaurant(restaurant_id)));
  end if;

  -- φωτογραφίες κοινοποιημένων συνταγών και συνταγών ομάδας
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'shared or team recipe photos') then
    create policy "shared or team recipe photos" on storage.objects for select to anon, authenticated
      using (bucket_id = 'recipe-photos' and (select public.photo_is_readable(name)));
  end if;
end $$;

-- ---------- Στήσιμο πιάτου ----------
alter table public.recipes add column if not exists plate text not null default '';
alter table public.recipes add column if not exists plating_steps jsonb not null default '[]'::jsonb;
alter table public.recipes add column if not exists plating_photo_path text;

create or replace function public.get_shared_recipe(tok text)
returns json language sql stable security definer set search_path = ''
as $$
  select json_build_object(
    'title', r.title, 'category', r.category, 'yield_qty', r.yield_qty, 'yield_unit', r.yield_unit,
    'prep_min', r.prep_min, 'cook_min', r.cook_min, 'ingredients', r.ingredients, 'steps', r.steps,
    'allergens', r.allergens, 'notes', r.notes, 'photo_path', r.photo_path,
    'plate', r.plate, 'plating_steps', r.plating_steps, 'plating_photo_path', r.plating_photo_path,
    'chef_name', coalesce(p.full_name, ''), 'restaurant', coalesce(rs.name, ''))
  from public.recipes r
  left join public.profiles p on p.user_id = r.user_id
  left join public.restaurants rs on rs.id = r.restaurant_id
  where tok is not null and length(tok) >= 16 and r.share_token = tok
$$;

create or replace function public.photo_is_readable(obj text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.recipes r
    where (
        (r.photo_path is not null and (r.photo_path = obj or regexp_replace(r.photo_path, '\.jpg$', '_t.jpg') = obj))
        or (r.plating_photo_path is not null and r.plating_photo_path = obj))
      and (r.share_token is not null or (r.restaurant_id is not null and public.team_can_read_restaurant(r.restaurant_id))))
$$;

-- ---------- Συνταγές συστατικών (π.χ. σάλτσες, γλάσα μέσα σε ένα πιάτο) ----------
alter table public.recipes add column if not exists components jsonb not null default '[]'::jsonb;

create or replace function public.get_shared_recipe(tok text)
returns json language sql stable security definer set search_path = ''
as $$
  select json_build_object(
    'title', r.title, 'category', r.category, 'yield_qty', r.yield_qty, 'yield_unit', r.yield_unit,
    'prep_min', r.prep_min, 'cook_min', r.cook_min, 'ingredients', r.ingredients, 'steps', r.steps,
    'allergens', r.allergens, 'notes', r.notes, 'photo_path', r.photo_path,
    'plate', r.plate, 'plating_steps', r.plating_steps, 'plating_photo_path', r.plating_photo_path,
    'components', r.components,
    'chef_name', coalesce(p.full_name, ''), 'restaurant', coalesce(rs.name, ''))
  from public.recipes r
  left join public.profiles p on p.user_id = r.user_id
  left join public.restaurants rs on rs.id = r.restaurant_id
  where tok is not null and length(tok) >= 16 and r.share_token = tok
$$;
