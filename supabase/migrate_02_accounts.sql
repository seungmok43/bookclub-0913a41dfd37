-- BooKLove migration 02 — simple member accounts (name + personal password).
-- Paste into Supabase → SQL Editor → Run. Safe to run again. Needs schema.sql and migrate_01 first.
--
-- Model:
--   * The page asks for the club code once (check_code). Joining (register) needs the club code too,
--     so nobody can create an account without it.
--   * A member signs up once with a name and a password, then logs in. The site keeps a login token
--     for 30 days. Only a hash of the token and a bcrypt hash of the password are stored.
--   * Writes (review / post / comment) need a login. The writer's name is the account name.
--     A member can edit or delete their own reviews and posts and delete their own comments.
--   * The old code-only write functions are switched off for the website.
--
-- Owner-only (SQL Editor):
--   select public.set_member_code('새 코드');            -- change the club code
--   select public.reset_password('이름', '새 비밀번호');  -- a member forgot their password
--   update public.members set disabled = true where name = '이름';   -- block a member

-- ---------- tables ----------
create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 20),
  pw_hash     text not null,
  created_at  timestamptz not null default now(),
  disabled    boolean not null default false
);
create unique index if not exists members_name_uq on public.members (lower(name));

create table if not exists public.sessions (
  token_hash  text primary key,
  member_id   uuid not null references public.members(id) on delete cascade,
  expires_at  timestamptz not null
);
create index if not exists sessions_member_idx on public.sessions (member_id);

alter table public.members  enable row level security;
alter table public.sessions enable row level security;
revoke all on public.members, public.sessions from anon, authenticated;

alter table public.reviews  add column if not exists member_id uuid references public.members(id) on delete set null;
alter table public.posts    add column if not exists member_id uuid references public.members(id) on delete set null;
alter table public.comments add column if not exists member_id uuid references public.members(id) on delete set null;
alter table public.reviews  add column if not exists updated_at timestamptz;
alter table public.posts    add column if not exists updated_at timestamptz;

-- ---------- helpers (private) ----------
-- Failed guesses only (club code, login, password change): 20 per connection per hour,
-- 300 per hour site-wide. Successful entries are not counted, so a whole group on one
-- church Wi-Fi can come in together. Returns null or 'rate_limited'.
create or replace function public._throttle(p_client text)
returns text language plpgsql volatile security definer
set search_path = public, extensions as $$
begin
  delete from public.write_log where at < now() - interval '1 day';
  if (select count(*) from public.write_log where client = p_client and not ok and at > now() - interval '1 hour') >= 20
     or (select count(*) from public.write_log where not ok and at > now() - interval '1 hour') >= 300 then
    return 'rate_limited';
  end if;
  return null;
end $$;

-- Member writes: 20 per 10 minutes and 100 per day per member, 300 per hour site-wide.
create or replace function public._wgate(p_mid uuid)
returns text language plpgsql volatile security definer
set search_path = public, extensions as $$
declare c text := 'm:' || p_mid::text;
begin
  delete from public.write_log where at < now() - interval '1 day';
  if (select count(*) from public.write_log where client = c and at > now() - interval '10 minutes') >= 20
     or (select count(*) from public.write_log where client = c) >= 100
     or (select count(*) from public.write_log where ok and client like 'm:%' and at > now() - interval '1 hour') >= 300 then
    return 'rate_limited';
  end if;
  insert into public.write_log (client, ok) values (c, true);
  return null;
end $$;

-- Club code check without logging successes. Returns null, 'rate_limited' or 'invalid_code'.
create or replace function public._code_ok(p_code text)
returns text language plpgsql volatile security definer
set search_path = public, extensions as $$
declare c text := public._client_key(); v_hash text; e text;
begin
  e := public._throttle(c);
  if e is not null then return e; end if;
  select code_hash into v_hash from public.members_code where id = 1;
  if v_hash is not null and p_code is not null and length(p_code) between 1 and 100
     and extensions.crypt(p_code, v_hash) = v_hash then
    return null;
  end if;
  insert into public.write_log (client, ok) values (c, false);
  return 'invalid_code';
end $$;

create or replace function public._tok_hash(p_token text)
returns text language sql immutable
set search_path = public, extensions as $$
  select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- Member id for a valid, unexpired token of an active member; else null.
create or replace function public._mid(p_token text)
returns uuid language sql stable security definer
set search_path = public, extensions as $$
  select m.id from public.sessions s join public.members m on m.id = s.member_id
  where s.token_hash = public._tok_hash(p_token) and s.expires_at > now() and not m.disabled;
$$;

create or replace function public._new_session(p_member uuid)
returns text language plpgsql volatile security definer
set search_path = public, extensions as $$
declare t text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  delete from public.sessions where expires_at < now();
  insert into public.sessions (token_hash, member_id, expires_at)
  values (public._tok_hash(t), p_member, now() + interval '30 days');
  return t;
end $$;

-- ---------- entrance / account functions (called from the site) ----------
create or replace function public.check_code(p_code text)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_err text;
begin
  v_err := public._code_ok(p_code);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  return json_build_object('ok', true);
end $$;

create or replace function public.register(p_code text, p_name text, p_password text)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_err text; v_name text := public._nick(p_name); v_id uuid;
begin
  v_err := public._code_ok(p_code);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  if v_name = '' then return json_build_object('ok', false, 'error', 'invalid_name'); end if;
  if p_password is null or char_length(p_password) < 4 or octet_length(p_password) > 72 then
    return json_build_object('ok', false, 'error', 'weak_password');
  end if;
  begin
    insert into public.members (name, pw_hash)
    values (v_name, extensions.crypt(p_password, extensions.gen_salt('bf', 10))) returning id into v_id;
  exception when unique_violation then
    return json_build_object('ok', false, 'error', 'name_taken');
  end;
  return json_build_object('ok', true, 'token', public._new_session(v_id), 'id', v_id, 'name', v_name);
end $$;

create or replace function public.login(p_name text, p_password text)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare c text := public._client_key(); v_err text; v_id uuid; v_name text; v_hash text; v_ok boolean := false;
begin
  v_err := public._throttle(c);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  select id, name, pw_hash into v_id, v_name, v_hash from public.members
  where lower(name) = lower(public._nick(p_name)) and not disabled;
  if v_id is not null and p_password is not null and octet_length(p_password) <= 72 then
    v_ok := coalesce(extensions.crypt(p_password, v_hash) = v_hash, false);
  end if;
  if not v_ok then
    insert into public.write_log (client, ok) values (c, false);
    return json_build_object('ok', false, 'error', 'bad_login');
  end if;
  return json_build_object('ok', true, 'token', public._new_session(v_id), 'id', v_id, 'name', v_name);
end $$;

-- Checks a saved login and keeps it alive for another 30 days.
create or replace function public.me(p_token text)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_id uuid := public._mid(p_token); v_name text;
begin
  if v_id is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  update public.sessions set expires_at = now() + interval '30 days' where token_hash = public._tok_hash(p_token);
  select name into v_name from public.members where id = v_id;
  return json_build_object('ok', true, 'id', v_id, 'name', v_name);
end $$;

create or replace function public.logout(p_token text)
returns json language sql volatile security definer
set search_path = public, extensions as $$
  delete from public.sessions where token_hash = public._tok_hash(p_token);
  select json_build_object('ok', true);
$$;

create or replace function public.change_password(p_token text, p_old text, p_new text)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_id uuid := public._mid(p_token); v_hash text; c text := public._client_key(); v_err text;
begin
  if v_id is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  v_err := public._throttle(c);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  select pw_hash into v_hash from public.members where id = v_id;
  if p_old is null or octet_length(p_old) > 72 or extensions.crypt(p_old, v_hash) <> v_hash then
    insert into public.write_log (client, ok) values (c, false);
    return json_build_object('ok', false, 'error', 'bad_login');
  end if;
  if p_new is null or char_length(p_new) < 4 or octet_length(p_new) > 72 then
    return json_build_object('ok', false, 'error', 'weak_password');
  end if;
  update public.members set pw_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)) where id = v_id;
  delete from public.sessions where member_id = v_id and token_hash <> public._tok_hash(p_token);
  return json_build_object('ok', true);
end $$;

-- ---------- member writes ----------
create or replace function public.m_add_review(p_token text, p_book_slug text, p_rating int, p_one_liner text, p_body text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_mid uuid := public._mid(p_token); v_err text; v_id uuid;
begin
  if v_mid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  v_err := public._wgate(v_mid);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  p_body := nullif(btrim(coalesce(p_body, '')), '');
  if p_book_slug !~ '^[a-z0-9-]{1,40}$' or p_rating not between 1 and 5
     or char_length(btrim(coalesce(p_one_liner, ''))) not between 1 and 100
     or char_length(coalesce(p_body, '')) > 3000 then
    return json_build_object('ok', false, 'error', 'invalid_input');
  end if;
  insert into public.reviews (book_slug, rating, one_liner, body, nickname, member_id)
  select p_book_slug, p_rating, btrim(p_one_liner), p_body, m.name, m.id from public.members m where m.id = v_mid
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.m_add_post(p_token text, p_title text, p_body text)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_mid uuid := public._mid(p_token); v_err text; v_id uuid;
begin
  if v_mid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  v_err := public._wgate(v_mid);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 60
     or char_length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then
    return json_build_object('ok', false, 'error', 'invalid_input');
  end if;
  insert into public.posts (title, body, nickname, member_id)
  select btrim(p_title), btrim(p_body), m.name, m.id from public.members m where m.id = v_mid
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.m_add_comment(p_token text, p_post_id uuid, p_body text)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_mid uuid := public._mid(p_token); v_err text; v_id uuid;
begin
  if v_mid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  v_err := public._wgate(v_mid);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then
    return json_build_object('ok', false, 'error', 'invalid_input');
  end if;
  if not exists (select 1 from public.posts where id = p_post_id and not hidden) then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;
  insert into public.comments (post_id, body, nickname, member_id)
  select p_post_id, btrim(p_body), m.name, m.id from public.members m where m.id = v_mid
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.m_edit_review(p_token text, p_id uuid, p_rating int, p_one_liner text, p_body text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_mid uuid := public._mid(p_token); v_err text;
begin
  if v_mid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  v_err := public._wgate(v_mid);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  p_body := nullif(btrim(coalesce(p_body, '')), '');
  if p_rating not between 1 and 5 or char_length(btrim(coalesce(p_one_liner, ''))) not between 1 and 100
     or char_length(coalesce(p_body, '')) > 3000 then
    return json_build_object('ok', false, 'error', 'invalid_input');
  end if;
  update public.reviews set rating = p_rating, one_liner = btrim(p_one_liner), body = p_body, updated_at = now()
  where id = p_id and member_id = v_mid and not hidden;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true);
end $$;

create or replace function public.m_edit_post(p_token text, p_id uuid, p_title text, p_body text)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_mid uuid := public._mid(p_token); v_err text;
begin
  if v_mid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  v_err := public._wgate(v_mid);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 60
     or char_length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then
    return json_build_object('ok', false, 'error', 'invalid_input');
  end if;
  update public.posts set title = btrim(p_title), body = btrim(p_body), updated_at = now()
  where id = p_id and member_id = v_mid and not hidden;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true);
end $$;

-- p_kind: 'review' | 'post' | 'comment'. Deleting a post also deletes its comments.
create or replace function public.m_delete(p_token text, p_kind text, p_id uuid)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_mid uuid := public._mid(p_token); v_err text;
begin
  if v_mid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  v_err := public._wgate(v_mid);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  if p_kind = 'review' then delete from public.reviews where id = p_id and member_id = v_mid;
  elsif p_kind = 'post' then delete from public.posts where id = p_id and member_id = v_mid;
  elsif p_kind = 'comment' then delete from public.comments where id = p_id and member_id = v_mid;
  else return json_build_object('ok', false, 'error', 'invalid_input');
  end if;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true);
end $$;

-- Owner-only: set a new password for a member who forgot theirs (logs them out everywhere).
create or replace function public.reset_password(p_name text, p_new text)
returns text language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_id uuid;
begin
  if p_new is null or char_length(p_new) < 4 or octet_length(p_new) > 72 then
    raise exception 'password must be 4+ characters';
  end if;
  update public.members set pw_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10))
  where lower(name) = lower(public._nick(p_name)) returning id into v_id;
  if v_id is null then raise exception 'no member named %', p_name; end if;
  delete from public.sessions where member_id = v_id;
  return 'password reset';
end $$;

-- ---------- execute permissions ----------
revoke all on function public._throttle(text)    from public, anon, authenticated;
revoke all on function public._wgate(uuid)       from public, anon, authenticated;
revoke all on function public._code_ok(text)     from public, anon, authenticated;
revoke all on function public._tok_hash(text)    from public, anon, authenticated;
revoke all on function public._mid(text)         from public, anon, authenticated;
revoke all on function public._new_session(uuid) from public, anon, authenticated;
revoke all on function public.reset_password(text, text) from public, anon, authenticated;

revoke all on function public.check_code(text)                          from public;
revoke all on function public.register(text, text, text)                from public;
revoke all on function public.login(text, text)                         from public;
revoke all on function public.me(text)                                  from public;
revoke all on function public.logout(text)                              from public;
revoke all on function public.change_password(text, text, text)         from public;
revoke all on function public.m_add_review(text, text, int, text, text) from public;
revoke all on function public.m_add_post(text, text, text)              from public;
revoke all on function public.m_add_comment(text, uuid, text)           from public;
revoke all on function public.m_edit_review(text, uuid, int, text, text) from public;
revoke all on function public.m_edit_post(text, uuid, text, text)       from public;
revoke all on function public.m_delete(text, text, uuid)                from public;
grant execute on function public.check_code(text)                          to anon, authenticated;
grant execute on function public.register(text, text, text)                to anon, authenticated;
grant execute on function public.login(text, text)                         to anon, authenticated;
grant execute on function public.me(text)                                  to anon, authenticated;
grant execute on function public.logout(text)                              to anon, authenticated;
grant execute on function public.change_password(text, text, text)         to anon, authenticated;
grant execute on function public.m_add_review(text, text, int, text, text) to anon, authenticated;
grant execute on function public.m_add_post(text, text, text)              to anon, authenticated;
grant execute on function public.m_add_comment(text, uuid, text)           to anon, authenticated;
grant execute on function public.m_edit_review(text, uuid, int, text, text) to anon, authenticated;
grant execute on function public.m_edit_post(text, uuid, text, text)       to anon, authenticated;
grant execute on function public.m_delete(text, text, uuid)                to anon, authenticated;

-- The old code-only writes (anonymous with the club code) are switched off for the website.
revoke execute on function public.add_review(text, text, int, text, text, text) from anon, authenticated;
revoke execute on function public.add_post(text, text, text, text)            from anon, authenticated;
revoke execute on function public.add_comment(text, uuid, text, text)         from anon, authenticated;

notify pgrst, 'reload schema';
