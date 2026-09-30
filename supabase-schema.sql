create extension if not exists pgcrypto;

create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 160),
  email text not null check (char_length(email) between 3 and 320),
  phone text check (phone is null or char_length(phone) <= 60),
  message text not null default '' check (char_length(message) <= 5000),
  status text not null default 'new' check (status in ('new', 'in_progress', 'closed')),
  created_at timestamptz not null default now()
);

alter table public.contact_requests enable row level security;

grant insert on public.contact_requests to anon, authenticated;
grant select, update, delete on public.contact_requests to authenticated;

drop policy if exists "Public can submit contact requests" on public.contact_requests;
create policy "Public can submit contact requests"
  on public.contact_requests for insert to anon, authenticated
  with check (true);

drop policy if exists "Admins can read contact requests" on public.contact_requests;
create policy "Admins can read contact requests"
  on public.contact_requests for select to authenticated
  using ((auth.jwt()->'app_metadata'->>'role') = 'admin');

drop policy if exists "Admins can update contact requests" on public.contact_requests;
create policy "Admins can update contact requests"
  on public.contact_requests for update to authenticated
  using ((auth.jwt()->'app_metadata'->>'role') = 'admin')
  with check ((auth.jwt()->'app_metadata'->>'role') = 'admin');

drop policy if exists "Admins can delete contact requests" on public.contact_requests;
create policy "Admins can delete contact requests"
  on public.contact_requests for delete to authenticated
  using ((auth.jwt()->'app_metadata'->>'role') = 'admin');
