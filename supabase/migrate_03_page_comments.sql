-- BooKLove migration 03 — comments under session pages (회차 기록 아래 댓글).
-- Paste into Supabase → SQL Editor → Run. Safe to run again. Needs migrate_02 first.
--
-- page = the session page path, e.g. 'waste/2026-08-19'. Members (logged in) write;
-- anyone with the site key can read rows that are not hidden. Moderation: hidden = true.

create table if not exists public.page_comments (
  id          uuid primary key default gen_random_uuid(),
  page        text not null check (page ~ '^[a-z0-9-]{1,40}(/[a-z0-9-]{1,40})?$'),
  body        text not null check (char_length(btrim(body)) between 1 and 1000),
  nickname    text not null,
  member_id   uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now(),
  hidden      boolean not null default false
);
create index if not exists page_comments_page_idx on public.page_comments (page, created_at);

alter table public.page_comments enable row level security;
drop policy if exists page_comments_read on public.page_comments;
create policy page_comments_read on public.page_comments for select to anon, authenticated using (not hidden);
revoke all on public.page_comments from anon, authenticated;
grant select on public.page_comments to anon, authenticated;

create or replace function public.m_add_page_comment(p_token text, p_page text, p_body text)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_mid uuid := public._mid(p_token); v_err text; v_id uuid;
begin
  if v_mid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  v_err := public._wgate(v_mid);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  if coalesce(p_page, '') !~ '^[a-z0-9-]{1,40}(/[a-z0-9-]{1,40})?$'
     or char_length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then
    return json_build_object('ok', false, 'error', 'invalid_input');
  end if;
  insert into public.page_comments (page, body, nickname, member_id)
  select p_page, btrim(p_body), m.name, m.id from public.members m where m.id = v_mid
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.m_delete_page_comment(p_token text, p_id uuid)
returns json language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_mid uuid := public._mid(p_token); v_err text;
begin
  if v_mid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  v_err := public._wgate(v_mid);
  if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
  delete from public.page_comments where id = p_id and member_id = v_mid;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true);
end $$;

revoke all on function public.m_add_page_comment(text, text, text) from public;
revoke all on function public.m_delete_page_comment(text, uuid)    from public;
grant execute on function public.m_add_page_comment(text, text, text) to anon, authenticated;
grant execute on function public.m_delete_page_comment(text, uuid)    to anon, authenticated;

notify pgrst, 'reload schema';
