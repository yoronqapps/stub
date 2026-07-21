-- Clipticket schema
-- Run this in Supabase → SQL Editor (paste the whole file, click Run).

-- 1) Rooms table: one row per ticket code, holds the shared text.
create table if not exists public.rooms (
  code text primary key,
  text_content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);

-- 2) Files metadata table: one row per uploaded file, per room.
create table if not exists public.room_files (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.rooms(code) on delete cascade,
  file_name text not null,
  storage_path text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists room_files_room_code_idx on public.room_files(room_code);

-- 3) Enable Realtime on both tables (Database → Replication in the
--    dashboard does the same thing; this is the SQL equivalent).
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.room_files;

-- 4) Row Level Security.
-- This app is intentionally "no login, code = capability" — anyone who
-- knows a room code can read/write it. That means RLS just needs to
-- allow anonymous access; it does NOT provide privacy on its own.
-- Treat the room code itself as the secret.
alter table public.rooms enable row level security;
alter table public.room_files enable row level security;

drop policy if exists "rooms are readable by anyone" on public.rooms;
create policy "rooms are readable by anyone"
  on public.rooms for select
  using (true);

drop policy if exists "rooms are insertable by anyone" on public.rooms;
create policy "rooms are insertable by anyone"
  on public.rooms for insert
  with check (true);

drop policy if exists "rooms are updatable by anyone" on public.rooms;
create policy "rooms are updatable by anyone"
  on public.rooms for update
  using (true);

drop policy if exists "room_files are readable by anyone" on public.room_files;
create policy "room_files are readable by anyone"
  on public.room_files for select
  using (true);

drop policy if exists "room_files are insertable by anyone" on public.room_files;
create policy "room_files are insertable by anyone"
  on public.room_files for insert
  with check (true);

drop policy if exists "room_files are deletable by anyone" on public.room_files;
create policy "room_files are deletable by anyone"
  on public.room_files for delete
  using (true);

-- 5) Storage bucket for uploaded files (public read, so download links
--    work without signed URLs; writes still go through the app).
insert into storage.buckets (id, name, public)
values ('clipticket-files', 'clipticket-files', true)
on conflict (id) do nothing;

drop policy if exists "clipticket files are publicly readable" on storage.objects;
create policy "clipticket files are publicly readable"
  on storage.objects for select
  using (bucket_id = 'clipticket-files');

drop policy if exists "clipticket files are uploadable by anyone" on storage.objects;
create policy "clipticket files are uploadable by anyone"
  on storage.objects for insert
  with check (bucket_id = 'clipticket-files');

drop policy if exists "clipticket files are deletable by anyone" on storage.objects;
create policy "clipticket files are deletable by anyone"
  on storage.objects for delete
  using (bucket_id = 'clipticket-files');

-- 6) Cleanup: delete expired rooms (cascades to room_files rows;
--    storage objects are cleaned up separately, see README).
create or replace function public.purge_expired_rooms()
returns void
language sql
security definer
as $$
  delete from public.rooms
  where expires_at is not null and expires_at < now();
$$;

-- Schedule it to run hourly. Requires the pg_cron extension, which is
-- available on all Supabase projects (Database → Extensions → pg_cron).
-- Enable pg_cron first, then run:
--
--   select cron.schedule(
--     'purge-expired-rooms',
--     '0 * * * *',
--     $$select public.purge_expired_rooms();$$
--   );
--
-- Left commented out here because pg_cron must be enabled via the
-- dashboard before this call will succeed — see README step 4.
