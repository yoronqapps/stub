-- Clipticket schema (secure mode)
-- Run this in Supabase -> SQL Editor (paste the whole file, click Run).

-- 1) Rooms table: one row per ticket code, holds the shared text.
create table if not exists public.rooms (
  code text primary key,
  access_key text not null,
  text_content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);

-- Migration safety for existing installs.
alter table public.rooms add column if not exists access_key text;
update public.rooms
set access_key = encode(gen_random_bytes(12), 'hex')
where access_key is null or access_key = '';
alter table public.rooms alter column access_key set not null;

create index if not exists rooms_code_access_key_idx
  on public.rooms(code, access_key);

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

-- 3) Enable Realtime on both tables (SQL equivalent of dashboard toggle).
do $$
begin
  alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.room_files;
exception when duplicate_object then
  null;
end $$;

-- 4) Header helpers used by RLS policies.
create or replace function public.request_room_code()
returns text
language sql
stable
as $$
  select coalesce(current_setting('request.headers', true)::jsonb ->> 'x-room-code', '');
$$;

create or replace function public.request_room_key()
returns text
language sql
stable
as $$
  select coalesce(current_setting('request.headers', true)::jsonb ->> 'x-room-key', '');
$$;

-- 5) Row Level Security for ticket-key scoped access.
alter table public.rooms enable row level security;
alter table public.room_files enable row level security;

-- Remove legacy permissive policies.
drop policy if exists "rooms are readable by anyone" on public.rooms;
drop policy if exists "rooms are insertable by anyone" on public.rooms;
drop policy if exists "rooms are updatable by anyone" on public.rooms;
drop policy if exists "room_files are readable by anyone" on public.room_files;
drop policy if exists "room_files are insertable by anyone" on public.room_files;
drop policy if exists "room_files are deletable by anyone" on public.room_files;

create policy "rooms are readable by anyone"
  on public.rooms for select
  using (
    code = public.request_room_code()
    and access_key = public.request_room_key()
  );

create policy "rooms are insertable by anyone"
  on public.rooms for insert
  with check (
    code = public.request_room_code()
    and access_key = public.request_room_key()
  );

create policy "rooms are updatable by anyone"
  on public.rooms for update
  using (
    code = public.request_room_code()
    and access_key = public.request_room_key()
  )
  with check (
    code = public.request_room_code()
    and access_key = public.request_room_key()
  );

create policy "room_files are readable by anyone"
  on public.room_files for select
  using (
    room_code = public.request_room_code()
    and exists (
      select 1
      from public.rooms r
      where r.code = room_files.room_code
        and r.access_key = public.request_room_key()
    )
  );

create policy "room_files are insertable by anyone"
  on public.room_files for insert
  with check (
    room_code = public.request_room_code()
    and exists (
      select 1
      from public.rooms r
      where r.code = room_files.room_code
        and r.access_key = public.request_room_key()
    )
  );

create policy "room_files are deletable by anyone"
  on public.room_files for delete
  using (
    room_code = public.request_room_code()
    and exists (
      select 1
      from public.rooms r
      where r.code = room_files.room_code
        and r.access_key = public.request_room_key()
    )
  );

-- 6) Storage bucket for uploaded files (private read + signed URLs).
insert into storage.buckets (id, name, public)
values ('clipticket-files', 'clipticket-files', false)
on conflict (id) do update set public = excluded.public;

-- Replace legacy storage policies.
drop policy if exists "clipticket files are publicly readable" on storage.objects;
drop policy if exists "clipticket files are uploadable by anyone" on storage.objects;
drop policy if exists "clipticket files are deletable by anyone" on storage.objects;

create policy "clipticket files are publicly readable"
  on storage.objects for select
  using (
    bucket_id = 'clipticket-files'
    and split_part(name, '/', 1) = public.request_room_code()
    and exists (
      select 1
      from public.rooms r
      where r.code = public.request_room_code()
        and r.access_key = public.request_room_key()
    )
  );

create policy "clipticket files are uploadable by anyone"
  on storage.objects for insert
  with check (
    bucket_id = 'clipticket-files'
    and split_part(name, '/', 1) = public.request_room_code()
    and exists (
      select 1
      from public.rooms r
      where r.code = public.request_room_code()
        and r.access_key = public.request_room_key()
    )
  );

create policy "clipticket files are deletable by anyone"
  on storage.objects for delete
  using (
    bucket_id = 'clipticket-files'
    and split_part(name, '/', 1) = public.request_room_code()
    and exists (
      select 1
      from public.rooms r
      where r.code = public.request_room_code()
        and r.access_key = public.request_room_key()
    )
  );

-- 7) Cleanup: delete expired rooms (cascades to room_files rows;
--    storage objects are cleaned up separately, see README).
create or replace function public.purge_expired_rooms()
returns void
language sql
security definer
as $$
  delete from public.rooms
  where expires_at is not null and expires_at < now();
$$;

-- Schedule it to run hourly. Requires the pg_cron extension.
--
--   select cron.schedule(
--     'purge-expired-rooms',
--     '0 * * * *',
--     $$select public.purge_expired_rooms();$$
--   );
