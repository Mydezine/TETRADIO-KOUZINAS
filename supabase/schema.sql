-- Τετράδιο Κουζίνας: πίνακες και κανόνες ασφαλείας.
-- Επικόλλησε όλο το αρχείο στο Supabase → SQL Editor → New query → Run.
-- Μπορεί να τρέξει ξανά χωρίς πρόβλημα.

create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  city text not null default '',
  years text not null default '',
  role text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  restaurant_id uuid references public.restaurants (id) on delete set null,
  title text not null,
  category text not null default 'Άλλο',
  yield_qty numeric,
  yield_unit text not null default '',
  prep_min integer,
  cook_min integer,
  ingredients jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  allergens jsonb not null default '[]'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists restaurants_user_idx on public.restaurants (user_id);
create index if not exists recipes_user_idx on public.recipes (user_id);
create index if not exists recipes_restaurant_idx on public.recipes (restaurant_id);

-- Κάθε χρήστης βλέπει και αλλάζει μόνο τα δικά του.
alter table public.restaurants enable row level security;
alter table public.recipes enable row level security;

drop policy if exists "own restaurants" on public.restaurants;
create policy "own restaurants" on public.restaurants
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own recipes" on public.recipes;
create policy "own recipes" on public.recipes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
