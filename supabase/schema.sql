-- BooKLove community — Supabase schema
-- Paste the whole file into Supabase → SQL Editor → Run. Safe to run again.
--
-- Model:
--   * reviews / posts / comments: anyone with the site's anon key can READ rows
--     that are not hidden. Nobody can insert/update/delete directly.
--   * Writes go only through add_review / add_post / add_comment (SECURITY DEFINER).
--     Each checks the member code against a bcrypt hash in members_code,
--     applies a simple rate limit, and inserts the row with a random nickname.
--   * members_code and write_log are private (no grants, RLS on, no policies).
--   * Moderation: set hidden = true on a row (Table Editor). It disappears from the site.
--
-- Set / change the member code (run in SQL Editor; replace the text in quotes):
--   select public.set_member_code('여기에-새-코드');
-- set_member_code is NOT callable from the website (execute revoked from anon).

create extension if not exists pgcrypto with schema extensions;

-- ---------- tables ----------
create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  book_slug   text not null check (book_slug ~ '^[a-z0-9-]{1,40}$'),
  rating      smallint not null check (rating between 1 and 5),
  one_liner   text not null check (char_length(btrim(one_liner)) between 1 and 100),
  body        text check (body is null or char_length(body) <= 3000),
  nickname    text not null,
  created_at  timestamptz not null default now(),
  hidden      boolean not null default false
);
create index if not exists reviews_book_idx on public.reviews (book_slug, created_at desc);

create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(btrim(title)) between 1 and 60),
  body        text not null check (char_length(btrim(body)) between 1 and 4000),
  nickname    text not null,
  created_at  timestamptz not null default now(),
  hidden      boolean not null default false
);
create index if not exists posts_created_idx on public.posts (created_at desc);

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 1000),
  nickname    text not null,
  created_at  timestamptz not null default now(),
  hidden      boolean not null default false
);
create index if not exists comments_post_idx on public.comments (post_id, created_at);

-- Only the bcrypt hash of the member code is stored. One row (id = 1).
create table if not exists public.members_code (
  id          smallint primary key default 1 check (id = 1),
  code_hash   text not null,
  updated_at  timestamptz not null default now()
);

-- Rate-limit log. Stores a salted hash of the client IP, never the IP itself.
-- Rows older than one day are deleted on every write.
create table if not exists public.write_log (
  id          bigint generated always as identity primary key,
  client      text not null,
  ok          boolean not null,
  at          timestamptz not null default now()
);
create index if not exists write_log_client_idx on public.write_log (client, at desc);

-- ---------- row level security ----------
alter table public.reviews      enable row level security;
alter table public.posts        enable row level security;
alter table public.comments     enable row level security;
alter table public.members_code enable row level security;
alter table public.write_log    enable row level security;

drop policy if exists reviews_read  on public.reviews;
drop policy if exists posts_read    on public.posts;
drop policy if exists comments_read on public.comments;
create policy reviews_read  on public.reviews  for select to anon, authenticated using (not hidden);
create policy posts_read    on public.posts    for select to anon, authenticated using (not hidden);
create policy comments_read on public.comments for select to anon, authenticated
  using (not hidden and exists (select 1 from public.posts p where p.id = post_id and not p.hidden));

revoke all on public.reviews, public.posts, public.comments from anon, authenticated;
grant select on public.reviews, public.posts, public.comments to anon, authenticated;
revoke all on public.members_code, public.write_log from anon, authenticated;

-- ---------- helpers (private) ----------
create or replace function public._client_key()
returns text language sql stable security definer
set search_path = public, extensions as $$
  select encode(extensions.digest(
    coalesce(split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1), 'unknown')
    || ':' || coalesce((select code_hash from public.members_code where id = 1), ''), 'sha256'), 'hex');
$$;

-- Returns null when allowed, or 'rate_limited'. Always logs the attempt.
create or replace function public._gate(p_code text)
returns text language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_client text := public._client_key();
  v_hash   text;
  v_ok     boolean;
begin
  delete from public.write_log where at < now() - interval '1 day';
  -- per client (one church Wi-Fi may be shared by many members):
  --   20 writes / 10 min, 100 / day; wrong codes: 10 / hour. Whole site: 300 / hour.
  if (select count(*) from public.write_log where client = v_client and at > now() - interval '10 minutes') >= 20
     or (select count(*) from public.write_log where client = v_client) >= 100
     or (select count(*) from public.write_log where client = v_client and not ok and at > now() - interval '1 hour') >= 10
     or (select count(*) from public.write_log where at > now() - interval '1 hour') >= 300 then
    return 'rate_limited';
  end if;
  select code_hash into v_hash from public.members_code where id = 1;
  v_ok := v_hash is not null and p_code is not null and length(p_code) between 1 and 100
          and extensions.crypt(p_code, v_hash) = v_hash;
  insert into public.write_log (client, ok) values (v_client, v_ok);
  if not v_ok then return 'invalid_code'; end if;
  return null;
end $$;

create or replace function public._nickname()
returns text language sql volatile as $$
  select (array['책갈피','연필','등불','찻잔','오솔길','들꽃','창가','담요','새벽빛','종이배','나무그늘','밤하늘'])
         [1 + floor(random() * 12)::int] || ' ' || (1 + floor(random() * 99)::int)::text;
$$;

-- ---------- write functions (called from the site) ----------
-- They return json instead of raising, so a failed code attempt is still logged.
create or replace function public.add_review(p_code text, p_book_slug text, p_rating int, p_one_liner text, p_body text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_err text; v_id uuid;
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
  values (p_book_slug, p_rating, btrim(p_one_liner), p_body, public._nickname()) returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.add_post(p_code text, p_title text, p_body text)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_err text; v_id uuid;
begin
  v_err := public._gate(p_code);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 60
     or char_length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then
    return json_build_object('ok', false, 'error', 'invalid_input');
  end if;
  insert into public.posts (title, body, nickname)
  values (btrim(p_title), btrim(p_body), public._nickname()) returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.add_comment(p_code text, p_post_id uuid, p_body text)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_err text; v_id uuid;
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
  values (p_post_id, btrim(p_body), public._nickname()) returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;

-- Owner-only: set or change the member code (stores bcrypt hash only).
create or replace function public.set_member_code(p_code text)
returns text language plpgsql volatile security definer
set search_path = public, extensions as $$
begin
  if p_code is null or length(btrim(p_code)) < 6 then
    raise exception 'member code must be at least 6 characters';
  end if;
  insert into public.members_code (id, code_hash, updated_at)
  values (1, extensions.crypt(btrim(p_code), extensions.gen_salt('bf', 10)), now())
  on conflict (id) do update set code_hash = excluded.code_hash, updated_at = now();
  delete from public.write_log;   -- old rate-limit keys were salted with the old hash
  return 'member code updated';
end $$;

-- ---------- execute permissions ----------
revoke all on function public._client_key()                         from public, anon, authenticated;
revoke all on function public._gate(text)                           from public, anon, authenticated;
revoke all on function public._nickname()                           from public, anon, authenticated;
revoke all on function public.set_member_code(text)                 from public, anon, authenticated;
revoke all on function public.add_review(text, text, int, text, text) from public;
revoke all on function public.add_post(text, text, text)            from public;
revoke all on function public.add_comment(text, uuid, text)         from public;
grant execute on function public.add_review(text, text, int, text, text) to anon, authenticated;
grant execute on function public.add_post(text, text, text)            to anon, authenticated;
grant execute on function public.add_comment(text, uuid, text)         to anon, authenticated;
