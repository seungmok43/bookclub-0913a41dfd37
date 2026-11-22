-- BooKLove migrate_06 — sign-up approval (가입 승인).  (2026-11-22)
-- Paste into Supabase → SQL Editor → Run. Safe to run again. Needs schema.sql and migrate_01..05 first
-- (it uses members.is_host from migrate_05).
--
-- What changes:
--   * members.status: 'approved' | 'pending' | 'rejected'.
--       - Every member that exists when this file runs becomes 'approved' (the column is added with
--         default 'approved', which fills existing rows), then the default switches to 'pending'.
--       - So every NEW sign-up starts as 'pending' (승인 대기).
--   * register() creates the member as 'pending' and returns {ok:true, pending:true, name} with no
--     login token. The site then shows 「가입 신청이 접수되었습니다. 목사님 승인 후 로그인할 수 있습니다.」
--   * login(): a correct name + password of a member who is not approved returns
--       {ok:false, error:'pending_approval'}  (still waiting)   or
--       {ok:false, error:'not_approved'}      (a host declined it).
--     A wrong password still returns 'bad_login' first, so the status is never shown to a stranger.
--   * _mid() (the token check every member function uses) also requires status = 'approved'.
--   * Hosts (members.is_host = true, as for attendance) get two functions:
--       m_host_pending(token)                     → pending sign-ups: id, name, created_at (oldest first)
--       m_host_approve(token, member, approve)    → approve = true → 'approved'; false → 'rejected'
--     Both refuse non-hosts with 'not_host'. m_host_roster (attendance) now lists approved members only. Nothing is deleted: a declined sign-up stays as a
--     'rejected' row (its name stays taken) and can be approved later with
--       update public.members set status = 'approved' where name = '이름';
-- Nothing existing is dropped. RLS stays as before: members has no direct read/write for anon;
-- all access goes through these security-definer functions.

alter table public.members add column if not exists status text not null default 'approved';
alter table public.members alter column status set default 'pending';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'members_status_chk') then
    alter table public.members add constraint members_status_chk check (status in ('approved', 'pending', 'rejected'));
  end if;
end $$;
alter table public.members add column if not exists reviewed_at timestamptz;
alter table public.members add column if not exists reviewed_by uuid references public.members(id) on delete set null;
create index if not exists members_pending_idx on public.members (created_at) where status = 'pending';

-- Token check: valid, unexpired session of an active, approved member.
create or replace function public._mid(p_token text)
returns uuid language sql stable security definer
set search_path = public, extensions as $$
  select m.id from public.sessions s join public.members m on m.id = s.member_id
  where s.token_hash = public._tok_hash(p_token) and s.expires_at > now() and not m.disabled and m.status = 'approved';
$$;
revoke all on function public._mid(text) from public, anon, authenticated;

-- Sign-up: same checks and throttles as migrate_04; the new member waits for a host. No session is made.
create or replace function public.register(p_code text, p_name text, p_password text)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare c text := public._client_key(); v_err text; v_name text := public._nick(p_name); v_id uuid;
begin
  v_err := coalesce(public._throttle(c), public._signup_gate(c));
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  if v_name = '' then return json_build_object('ok', false, 'error', 'invalid_name'); end if;
  if p_password is null or char_length(p_password) < 4 or octet_length(p_password) > 72 then
    return json_build_object('ok', false, 'error', 'weak_password');
  end if;
  begin
    insert into public.members (name, pw_hash, status)
    values (v_name, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), 'pending') returning id into v_id;
  exception when unique_violation then
    insert into public.write_log (client, ok) values (c, false);
    return json_build_object('ok', false, 'error', 'name_taken');
  end;
  insert into public.write_log (client, ok) values ('r:' || c, true);
  return json_build_object('ok', true, 'pending', true, 'name', v_name);
end $$;
revoke all on function public.register(text, text, text) from public;
grant execute on function public.register(text, text, text) to anon, authenticated;

create or replace function public.login(p_name text, p_password text)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare c text := public._client_key(); v_err text; v_id uuid; v_name text; v_hash text; v_status text; v_ok boolean := false;
begin
  v_err := public._throttle(c);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  select id, name, pw_hash, status into v_id, v_name, v_hash, v_status from public.members
  where lower(name) = lower(public._nick(p_name)) and not disabled;
  if v_id is not null and p_password is not null and octet_length(p_password) <= 72 then
    v_ok := coalesce(extensions.crypt(p_password, v_hash) = v_hash, false);
  end if;
  if not v_ok then
    insert into public.write_log (client, ok) values (c, false);
    return json_build_object('ok', false, 'error', 'bad_login');
  end if;
  if v_status = 'pending' then return json_build_object('ok', false, 'error', 'pending_approval'); end if;
  if v_status <> 'approved' then return json_build_object('ok', false, 'error', 'not_approved'); end if;
  return json_build_object('ok', true, 'token', public._new_session(v_id), 'id', v_id, 'name', v_name);
end $$;
revoke all on function public.login(text, text) from public;
grant execute on function public.login(text, text) to anon, authenticated;

-- Attendance roster (migrate_05) lists approved members only, so waiting sign-ups do not appear there.
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
    where not m.disabled and m.status = 'approved'), '[]'::json));
end $$;
revoke all on function public.m_host_roster(text, text, date) from public;
grant execute on function public.m_host_roster(text, text, date) to anon, authenticated;

-- Host: pending sign-ups, oldest first (names and dates only).
create or replace function public.m_host_pending(p_token text)
returns json language plpgsql stable security definer
set search_path = public, extensions as $$
declare v_mid uuid := public._mid(p_token);
begin
  if v_mid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  if not coalesce((select is_host from public.members where id = v_mid), false) then
    return json_build_object('ok', false, 'error', 'not_host');
  end if;
  return json_build_object('ok', true, 'rows', coalesce((
    select json_agg(json_build_object('id', m.id, 'name', m.name, 'created_at', m.created_at) order by m.created_at)
    from public.members m where m.status = 'pending' and not m.disabled), '[]'::json));
end $$;

-- Host: approve (true) or decline (false) one pending sign-up.
create or replace function public.m_host_approve(p_token text, p_member uuid, p_approve boolean)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_mid uuid := public._mid(p_token); v_err text;
begin
  if v_mid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  if not coalesce((select is_host from public.members where id = v_mid), false) then
    return json_build_object('ok', false, 'error', 'not_host');
  end if;
  if p_approve is null or not exists (select 1 from public.members where id = p_member and status = 'pending') then
    return json_build_object('ok', false, 'error', 'invalid_input');
  end if;
  v_err := public._wgate(v_mid);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  update public.members set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_at = now(), reviewed_by = v_mid
  where id = p_member and status = 'pending';
  return json_build_object('ok', true);
end $$;

revoke all on function public.m_host_pending(text)                  from public;
revoke all on function public.m_host_approve(text, uuid, boolean)   from public;
grant execute on function public.m_host_pending(text)               to anon, authenticated;
grant execute on function public.m_host_approve(text, uuid, boolean) to anon, authenticated;
