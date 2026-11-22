-- BooKLove migrate_05 — attendance (출석체크).  (2026-11-22)
-- Paste into Supabase → SQL Editor → Run. Safe to run again. Needs schema.sql and migrate_01..04 first.
--
-- One row per member per meeting. Meeting key = book slug + meeting date (e.g. 'what-we-believe', 2026-11-20).
-- The table is private: no direct select for anon/authenticated. A member reads only their own rows
-- through m_my_attendance(token). Writes only through m_check_in / m_undo_check_in (login token checked
-- server-side, same _mid/_wgate gates as reviews and comments).
-- Limits: meeting date from 60 days ago to tomorrow (Korea time); undo only on the day of the check-in;
-- member write gate _wgate (20 per 10 minutes, 100 per day per member, 300 per hour site-wide).
-- Hosts (진행자·반장): members.is_host = true. A host can mark or unmark any member for a meeting
-- on that meeting's page (m_host_roster / m_host_mark). Members only ever see their own rows and a
-- gentle yearly count; no rankings, streaks or absence counts are computed anywhere.
-- Nothing existing is dropped. One column is added to members (is_host, default false).
--
-- After running this file, make the host accounts (exact sign-up names) with, for example:
--   update public.members set is_host = true where name in ('이름1', '이름2');

alter table public.members add column if not exists is_host boolean not null default false;

create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  book_slug   text not null check (book_slug ~ '^[a-z0-9-]{1,40}$'),
  meet_date   date not null,
  created_at  timestamptz not null default now(),
  marked_by   uuid references public.members(id) on delete set null,   -- null = the member checked in; else the host
  unique (member_id, book_slug, meet_date)
);
alter table public.attendance add column if not exists marked_by uuid references public.members(id) on delete set null;
create index if not exists attendance_member_idx on public.attendance (member_id, meet_date desc);

alter table public.attendance enable row level security;
revoke all on public.attendance from anon, authenticated;   -- no policies: rows reachable only via the functions below

create or replace function public.m_check_in(p_token text, p_book_slug text, p_date date)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_mid uuid := public._mid(p_token); v_err text; v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if v_mid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  if coalesce(p_book_slug, '') !~ '^[a-z0-9-]{1,40}$' or p_date is null
     or p_date < v_today - 60 or p_date > v_today + 1 then
    return json_build_object('ok', false, 'error', 'invalid_input');
  end if;
  if exists (select 1 from public.attendance where member_id = v_mid and book_slug = p_book_slug and meet_date = p_date) then
    return json_build_object('ok', true, 'already', true);
  end if;
  v_err := public._wgate(v_mid);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  insert into public.attendance (member_id, book_slug, meet_date) values (v_mid, p_book_slug, p_date)
  on conflict (member_id, book_slug, meet_date) do nothing;
  return json_build_object('ok', true);
end $$;

create or replace function public.m_undo_check_in(p_token text, p_book_slug text, p_date date)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_mid uuid := public._mid(p_token); v_err text; v_at timestamptz;
begin
  if v_mid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  select created_at into v_at from public.attendance where member_id = v_mid and book_slug = p_book_slug and meet_date = p_date;
  if v_at is null then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if (v_at at time zone 'Asia/Seoul')::date <> (now() at time zone 'Asia/Seoul')::date then
    return json_build_object('ok', false, 'error', 'too_late');
  end if;
  v_err := public._wgate(v_mid);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  delete from public.attendance where member_id = v_mid and book_slug = p_book_slug and meet_date = p_date;
  return json_build_object('ok', true);
end $$;

-- Read-only: the caller's own attendance, newest meeting first. undo_ok = checked in today (Korea time).
create or replace function public.m_my_attendance(p_token text)
returns json language plpgsql stable security definer
set search_path = public, extensions as $$
declare v_mid uuid := public._mid(p_token);
begin
  if v_mid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  return json_build_object('ok', true,
    'is_host', coalesce((select is_host from public.members where id = v_mid), false),
    'rows', coalesce((
    select json_agg(json_build_object('book_slug', a.book_slug, 'date', a.meet_date, 'created_at', a.created_at,
             'undo_ok', (a.created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date)
           order by a.meet_date desc, a.created_at desc)
    from public.attendance a where a.member_id = v_mid), '[]'::json));
end $$;

-- Host: every active member with present = true/false for one meeting (names only, sorted by name).
create or replace function public.m_host_roster(p_token text, p_book_slug text, p_date date)
returns json language plpgsql stable security definer
set search_path = public, extensions as $$
declare v_mid uuid := public._mid(p_token);
begin
  if v_mid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  if not coalesce((select is_host from public.members where id = v_mid), false) then
    return json_build_object('ok', false, 'error', 'not_host');
  end if;
  return json_build_object('ok', true, 'rows', coalesce((
    select json_agg(json_build_object('id', m.id, 'name', m.name, 'present', a.id is not null) order by m.name)
    from public.members m
    left join public.attendance a on a.member_id = m.id and a.book_slug = p_book_slug and a.meet_date = p_date
    where not m.disabled), '[]'::json));
end $$;

-- Host: mark (p_present = true) or unmark (false) one member for one meeting. Same date window as m_check_in.
create or replace function public.m_host_mark(p_token text, p_member uuid, p_book_slug text, p_date date, p_present boolean)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_mid uuid := public._mid(p_token); v_err text; v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if v_mid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  if not coalesce((select is_host from public.members where id = v_mid), false) then
    return json_build_object('ok', false, 'error', 'not_host');
  end if;
  if coalesce(p_book_slug, '') !~ '^[a-z0-9-]{1,40}$' or p_date is null or p_present is null
     or p_date < v_today - 60 or p_date > v_today + 1
     or not exists (select 1 from public.members where id = p_member and not disabled) then
    return json_build_object('ok', false, 'error', 'invalid_input');
  end if;
  v_err := public._wgate(v_mid);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  if p_present then
    insert into public.attendance (member_id, book_slug, meet_date, marked_by) values (p_member, p_book_slug, p_date, v_mid)
    on conflict (member_id, book_slug, meet_date) do nothing;
  else
    delete from public.attendance where member_id = p_member and book_slug = p_book_slug and meet_date = p_date;
  end if;
  return json_build_object('ok', true);
end $$;

revoke all on function public.m_host_roster(text, text, date)                  from public;
revoke all on function public.m_host_mark(text, uuid, text, date, boolean)     from public;
grant execute on function public.m_host_roster(text, text, date)              to anon, authenticated;
grant execute on function public.m_host_mark(text, uuid, text, date, boolean) to anon, authenticated;
revoke all on function public.m_check_in(text, text, date)      from public;
revoke all on function public.m_undo_check_in(text, text, date) from public;
revoke all on function public.m_my_attendance(text)             from public;
grant execute on function public.m_check_in(text, text, date)      to anon, authenticated;
grant execute on function public.m_undo_check_in(text, text, date) to anon, authenticated;
grant execute on function public.m_my_attendance(text)             to anon, authenticated;

notify pgrst, 'reload schema';
