-- BooKLove migration 01 — writers may give a name or nickname (optional).
-- Paste into Supabase → SQL Editor → Run. Safe to run again.
-- Empty name → random nickname as before. Max 20 characters.

create or replace function public._nick(p text)
returns text language sql immutable as $$
  select left(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'), 20);
$$;

drop function if exists public.add_review(text, text, int, text, text);
drop function if exists public.add_post(text, text, text);
drop function if exists public.add_comment(text, uuid, text);

create or replace function public.add_review(p_code text, p_book_slug text, p_rating int, p_one_liner text, p_body text default null, p_nickname text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_err text; v_id uuid; v_nick text := nullif(public._nick(p_nickname), '');
begin
  v_err := public._gate(p_code);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  p_body := nullif(btrim(coalesce(p_body, '')), '');
  if p_book_slug !~ '^[a-z0-9-]{1,40}$' or p_rating not between 1 and 5
     or char_length(btrim(coalesce(p_one_liner, ''))) not between 1 and 100
     or char_length(coalesce(p_body, '')) > 3000 then
    return json_build_object('ok', false, 'error', 'invalid_input');
  end if;
  insert into public.reviews (book_slug, rating, one_liner, body, nickname)
  values (p_book_slug, p_rating, btrim(p_one_liner), p_body, coalesce(v_nick, public._nickname())) returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.add_post(p_code text, p_title text, p_body text, p_nickname text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_err text; v_id uuid; v_nick text := nullif(public._nick(p_nickname), '');
begin
  v_err := public._gate(p_code);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 60
     or char_length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then
    return json_build_object('ok', false, 'error', 'invalid_input');
  end if;
  insert into public.posts (title, body, nickname)
  values (btrim(p_title), btrim(p_body), coalesce(v_nick, public._nickname())) returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.add_comment(p_code text, p_post_id uuid, p_body text, p_nickname text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_err text; v_id uuid; v_nick text := nullif(public._nick(p_nickname), '');
begin
  v_err := public._gate(p_code);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then
    return json_build_object('ok', false, 'error', 'invalid_input');
  end if;
  if not exists (select 1 from public.posts where id = p_post_id and not hidden) then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;
  insert into public.comments (post_id, body, nickname)
  values (p_post_id, btrim(p_body), coalesce(v_nick, public._nickname())) returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;

revoke all on function public._nick(text) from public, anon, authenticated;
revoke all on function public.add_review(text, text, int, text, text, text) from public;
revoke all on function public.add_post(text, text, text, text)            from public;
revoke all on function public.add_comment(text, uuid, text, text)         from public;
grant execute on function public.add_review(text, text, int, text, text, text) to anon, authenticated;
grant execute on function public.add_post(text, text, text, text)            to anon, authenticated;
grant execute on function public.add_comment(text, uuid, text, text)         to anon, authenticated;

notify pgrst, 'reload schema';
