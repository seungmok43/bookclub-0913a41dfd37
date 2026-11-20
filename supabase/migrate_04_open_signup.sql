-- BooKLove migrate_04 — open sign-up (no club code) + long-lived logins.  (2026-11-20)
-- Paste into Supabase → SQL Editor → Run. Safe to run again. Needs schema.sql and migrate_01..03 first.
--
-- What changes:
--   * register() no longer checks the club code. The p_code argument stays in the signature
--     (ignored) so the site and older pages keep calling the same function.
--   * New sign-ups are throttled, because the code no longer filters them:
--       - 3 new accounts per connection per hour, 30 per day site-wide;
--       - name 1–20 chars (existing check), password 4–72 bytes (existing check);
--       - names stay unique case-insensitively (existing index members_name_uq).
--   * Logins last until the member presses 로그아웃: new sessions and every me() check
--     set expiry to 10 years ahead. Tokens are still checked server-side (sha256 hash in
--     public.sessions, member not disabled, not expired).
-- Nothing is dropped. Existing members, sessions, posts and comments are untouched.
-- check_code() stays (unused by the site now).

create or replace function public._signup_gate(p_client text)
returns text language plpgsql volatile security definer
set search_path = public, extensions as $$
begin
  delete from public.write_log where at < now() - interval '1 day';
  if (select count(*) from public.write_log where client = 'r:' || p_client and at > now() - interval '1 hour') >= 3
     or (select count(*) from public.write_log where client like 'r:%' and at > now() - interval '1 day') >= 30 then
    return 'rate_limited';
  end if;
  return null;
end $$;
revoke all on function public._signup_gate(text) from public, anon, authenticated;

create or replace function public._new_session(p_member uuid)
returns text language plpgsql volatile security definer
set search_path = public, extensions as $$
declare t text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  delete from public.sessions where expires_at < now();
  insert into public.sessions (token_hash, member_id, expires_at)
  values (public._tok_hash(t), p_member, now() + interval '10 years');
  return t;
end $$;
revoke all on function public._new_session(uuid) from public, anon, authenticated;

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
    insert into public.members (name, pw_hash)
    values (v_name, extensions.crypt(p_password, extensions.gen_salt('bf', 10))) returning id into v_id;
  exception when unique_violation then
    insert into public.write_log (client, ok) values (c, false);
    return json_build_object('ok', false, 'error', 'name_taken');
  end;
  insert into public.write_log (client, ok) values ('r:' || c, true);
  return json_build_object('ok', true, 'token', public._new_session(v_id), 'id', v_id, 'name', v_name);
end $$;
revoke all on function public.register(text, text, text) from public;
grant execute on function public.register(text, text, text) to anon, authenticated;

-- Checks a saved login and keeps it alive (10 years from now).
create or replace function public.me(p_token text)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_id uuid := public._mid(p_token); v_name text;
begin
  if v_id is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  update public.sessions set expires_at = now() + interval '10 years' where token_hash = public._tok_hash(p_token);
  select name into v_name from public.members where id = v_id;
  return json_build_object('ok', true, 'id', v_id, 'name', v_name);
end $$;
revoke all on function public.me(text) from public;
grant execute on function public.me(text) to anon, authenticated;

-- Existing sessions: extend to the new lifetime so nobody is logged out by the old 30-day limit.
update public.sessions set expires_at = now() + interval '10 years' where expires_at > now();
