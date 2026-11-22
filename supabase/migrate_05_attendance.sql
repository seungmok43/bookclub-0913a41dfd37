-- BooKLove migrate_05 — attendance (출석체크).  (2026-11-22)
-- Paste into Supabase → SQL Editor → Run. Safe to run again. Needs schema.sql and migrate_01..04 first.
--
-- One row per member per meeting. Meeting key = book slug + meeting date (e.g. 'what-we-believe', 2026-11-20).
-- The table is private: no direct select for anon/authenticated. A member reads only their own rows
-- through m_my_attendance(token). Writes only through m_check_in / m_undo_check_in (login token checked
-- server-side, same _mid/_wgate gates as reviews and comments).
-- Limits: meeting date from 60 days ago to tomorrow (Korea time); undo only on the day of the check-in;
-- member write gate _wgate (20 per 10 minutes, 100 per day per member, 300 per hour site-wide).
-- Nothing existing is changed or dropped.

create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  book_slug   text not null check (book_slug ~ '^[a-z0-9-]{1,40}$'),
  meet_date   date not null,
  created_at  timestamptz not null default now(),
  unique (member_id, book_slug, meet_date)
);
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
  return json_build_object('ok', true, 'rows', coalesce((
    select json_agg(json_build_object('book_slug', a.book_slug, 'date', a.meet_date, 'created_at', a.created_at,
             'undo_ok', (a.created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date)
           order by a.meet_date desc, a.created_at desc)
    from public.attendance a where a.member_id = v_mid), '[]'::json));
end $$;

revoke all on function public.m_check_in(text, text, date)      from public;
revoke all on function public.m_undo_check_in(text, text, date) from public;
revoke all on function public.m_my_attendance(text)             from public;
grant execute on function public.m_check_in(text, text, date)      to anon, authenticated;
grant execute on function public.m_undo_check_in(text, text, date) to anon, authenticated;
grant execute on function public.m_my_attendance(text)             to anon, authenticated;

notify pgrst, 'reload schema';
