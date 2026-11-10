-- Προφίλ μαγείρων: όνομα και φωτογραφία. Τρέχει ξανά χωρίς πρόβλημα.
-- Χρειάζεται πρώτα τα schema.sql και admin.sql.
-- Οι φωτογραφίες προφίλ μπαίνουν στο bucket recipe-photos, στο <user id>/avatar/.

create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  full_name text not null default '',
  avatar_path text,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'own profile') then
    create policy "own profile" on public.profiles for all to authenticated
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'admin reads profiles') then
    create policy "admin reads profiles" on public.profiles for select to authenticated using ((select public.is_admin()));
  end if;
end $$;

-- Λίστα μαγείρων με όνομα και φωτογραφία, μόνο για τον διαχειριστή.
create or replace function public.admin_chef_list()
returns table (id uuid, email text, full_name text, avatar_path text, created_at timestamptz, last_sign_in_at timestamptz, recipes bigint, restaurants bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, coalesce(p.full_name, ''), p.avatar_path, u.created_at, u.last_sign_in_at,
      (select count(*) from public.recipes r where r.user_id = u.id),
      (select count(*) from public.restaurants r where r.user_id = u.id)
    from auth.users u left join public.profiles p on p.user_id = u.id
    order by u.created_at;
end $$;

-- Κοστολόγηση: εμφανίζεται μόνο σε όποιον μάγειρα την ενεργοποιήσει.
alter table public.profiles add column if not exists show_costing boolean not null default false;
