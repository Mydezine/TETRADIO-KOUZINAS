-- Διαχειριστής: βλέπει (μόνο ανάγνωση) όλους τους μάγειρες και όλες τις συνταγές.
-- Τρέχει ξανά χωρίς πρόβλημα. Για να κάνεις κάποιον διαχειριστή, δες το τέλος.

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
-- Κανείς δεν διαβάζει τον πίνακα απευθείας· μόνο μέσω των παρακάτω functions.
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admins where user_id = (select auth.uid())) $$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Ανάγνωση όλων για τον διαχειριστή (οι αλλαγές μένουν μόνο στον κάθε μάγειρα).
drop policy if exists "admin reads restaurants" on public.restaurants;
create policy "admin reads restaurants" on public.restaurants
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "admin reads recipes" on public.recipes;
create policy "admin reads recipes" on public.recipes
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "admin reads recipe photos" on storage.objects;
create policy "admin reads recipe photos" on storage.objects
  for select to authenticated using (bucket_id = 'recipe-photos' and (select public.is_admin()));

-- Λίστα μαγείρων με στοιχεία, μόνο για τον διαχειριστή.
create or replace function public.admin_chefs()
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, recipes bigint, restaurants bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at,
      (select count(*) from public.recipes r where r.user_id = u.id),
      (select count(*) from public.restaurants r where r.user_id = u.id)
    from auth.users u
    order by u.created_at;
end $$;
revoke execute on function public.admin_chefs() from public, anon;
grant execute on function public.admin_chefs() to authenticated;

-- Για να κάνεις κάποιον διαχειριστή, τρέξε (με το email του λογαριασμού του):
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'EMAIL-ΕΔΩ'
--   on conflict do nothing;
