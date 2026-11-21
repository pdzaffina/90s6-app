-- 90S6 App: complete Supabase setup. Run this once in the SQL Editor on a new project.
-- Safe to re-run. Order: tables, helpers, access rules, storage, audit log, triggers.
-- Last step (bottom of file, commented): make yourself the first admin.

-- =====================================================================
-- 1. TABLES
-- =====================================================================

-- One row per person. Created automatically for every new sign up or invite.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  is_admin boolean not null default false,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

-- A board holds its tasks (data) and its column/swimlane layout (config)
create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My board',
  owner_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Who a board is shared with (the owner is implicit)
create table if not exists public.board_members (
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  role text not null check (role in ('editor', 'viewer')),
  primary key (board_id, user_id)
);

-- Invitations by email. Claimed automatically when that person signs in.
create table if not exists public.board_invites (
  board_id uuid not null references public.boards(id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null check (role in ('editor', 'viewer')),
  primary key (board_id, email)
);

-- Append-only history of who did what
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  action text not null,
  board_id uuid,
  target text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_id_idx on public.audit_log (id desc);
create index if not exists audit_log_board_idx on public.audit_log (board_id, id desc);

-- Profiles for anyone who already exists in this project
insert into public.profiles (id, email)
select id, lower(email) from auth.users on conflict (id) do nothing;

-- =====================================================================
-- 2. HELPER FUNCTIONS (used by the access rules)
-- =====================================================================

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select is_admin and not disabled from public.profiles
    where id = (select auth.uid())), false) $$;

-- Disabled accounts lose access to everything immediately
create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select not disabled from public.profiles
    where id = (select auth.uid())), false) $$;

create or replace function public.is_owner(bid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active() and exists (select 1 from public.boards
    where id = bid and owner_id = (select auth.uid())) $$;

create or replace function public.is_member(bid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active() and exists (select 1 from public.board_members
    where board_id = bid and user_id = (select auth.uid())) $$;

create or replace function public.can_edit(bid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active() and (
    exists (select 1 from public.boards where id = bid and owner_id = (select auth.uid()))
    or exists (select 1 from public.board_members
      where board_id = bid and user_id = (select auth.uid()) and role = 'editor')) $$;

-- Turns pending invites for the signed-in email into access
create or replace function public.claim_invites() returns void
language sql security definer set search_path = '' as $$
  with c as (
    delete from public.board_invites
    where email = lower(auth.jwt() ->> 'email')
    returning board_id, role)
  insert into public.board_members (board_id, user_id, email, role)
  select board_id, (select auth.uid()), lower(auth.jwt() ->> 'email'), role from c
  on conflict (board_id, user_id) do update set role = excluded.role $$;

-- Only signed-in users may call these through the API
revoke execute on function public.is_admin(), public.is_active(), public.is_owner(uuid),
  public.is_member(uuid), public.can_edit(uuid), public.claim_invites() from public, anon;
grant execute on function public.is_admin(), public.is_active(), public.is_owner(uuid),
  public.is_member(uuid), public.can_edit(uuid), public.claim_invites() to authenticated;

-- =====================================================================
-- 3. ACCESS RULES (row level security)
-- =====================================================================

alter table public.profiles enable row level security;
alter table public.boards enable row level security;
alter table public.board_members enable row level security;
alter table public.board_invites enable row level security;
alter table public.audit_log enable row level security;

-- Profiles: read your own (admins use the Edge Function to read all)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Boards: see what you own or were given; editors and owners can save; only owners create/delete
drop policy if exists boards_select on public.boards;
create policy boards_select on public.boards for select to authenticated
  using (public.is_active() and (owner_id = (select auth.uid()) or public.is_member(id)));
drop policy if exists boards_insert on public.boards;
create policy boards_insert on public.boards for insert to authenticated
  with check (public.is_active() and owner_id = (select auth.uid()));
drop policy if exists boards_update on public.boards;
create policy boards_update on public.boards for update to authenticated
  using (public.can_edit(id)) with check (public.can_edit(id));
drop policy if exists boards_delete on public.boards;
create policy boards_delete on public.boards for delete to authenticated
  using (public.is_active() and owner_id = (select auth.uid()));

-- Members: you see your own membership, owners see and remove their board's members
drop policy if exists members_select on public.board_members;
create policy members_select on public.board_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_owner(board_id));
drop policy if exists members_delete on public.board_members;
create policy members_delete on public.board_members for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_owner(board_id));

-- Invites: owners only
drop policy if exists invites_all on public.board_invites;
create policy invites_all on public.board_invites for all to authenticated
  using (public.is_owner(board_id)) with check (public.is_owner(board_id));

-- Audit log: board owners read their board's history (admins read via the Edge Function)
drop policy if exists audit_owner_read on public.audit_log;
create policy audit_owner_read on public.audit_log for select to authenticated
  using (board_id is not null and public.is_owner(board_id));

-- Column and table privileges: nothing for anonymous visitors, minimal for signed-in users
revoke all on public.profiles, public.boards, public.board_members, public.board_invites,
  public.audit_log from anon;
revoke update on public.profiles from authenticated;
grant update (full_name, last_seen_at) on public.profiles to authenticated;
revoke update on public.boards from authenticated;
grant update (name, data, config, updated_at) on public.boards to authenticated;   -- owner_id can never change
revoke all on public.audit_log from authenticated;
grant select on public.audit_log to authenticated;                                  -- no insert/update/delete

-- Only the owner may rename a board or change its layout (editors still edit tasks)
create or replace function public.guard_board_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null
     and (new.name is distinct from old.name or new.config is distinct from old.config)
     and not public.is_owner(old.id) then
    raise exception 'Only the board owner can change its name or layout' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists boards_guard on public.boards;
create trigger boards_guard before update on public.boards
  for each row execute function public.guard_board_update();

-- =====================================================================
-- 4. ATTACHMENTS (private storage bucket, 10 MB, safe file types only)
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 10485760, array[
  'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'text/plain', 'text/csv', 'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Files live under board_id/task_id/. Access follows board sharing.
drop policy if exists att_read on storage.objects;
create policy att_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (
    public.is_owner(((storage.foldername(name))[1])::uuid)
    or public.is_member(((storage.foldername(name))[1])::uuid)));
drop policy if exists att_write on storage.objects;
create policy att_write on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments'
    and public.can_edit(((storage.foldername(name))[1])::uuid));
drop policy if exists att_delete on storage.objects;
create policy att_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments'
    and public.can_edit(((storage.foldername(name))[1])::uuid));

-- =====================================================================
-- 5. NEW USERS GET A PROFILE
-- =====================================================================

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, lower(new.email))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- 6. AUDIT LOG (written by triggers, so the browser cannot skip or forge it)
-- =====================================================================

-- Nobody can edit, delete or truncate history (disable these triggers on purpose for retention jobs)
create or replace function public.audit_immutable() returns trigger
language plpgsql as $$ begin raise exception 'audit_log is append-only'; end $$;
drop trigger if exists audit_log_no_change on public.audit_log;
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function public.audit_immutable();
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_immutable();

create or replace function public.audit(p_action text, p_board uuid, p_target text, p_detail jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare em text;
begin
  select email into em from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_id, actor_email, action, board_id, target, detail)
  values (auth.uid(), coalesce(em, auth.jwt() ->> 'email'), p_action, p_board,
          left(p_target, 200), coalesce(p_detail, '{}'::jsonb));
end $$;
revoke execute on function public.audit(text, uuid, text, jsonb) from public, anon, authenticated;

-- Boards: create, rename, layout, delete, and every task-level change (diffed from the board data)
create or replace function public.audit_boards() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; fields text[]; n int := 0; od jsonb; nd jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.audit('board.created', new.id, new.name, '{}'::jsonb); return new;
  elsif tg_op = 'DELETE' then
    perform public.audit('board.deleted', old.id, old.name,
      jsonb_build_object('tasks', case when jsonb_typeof(old.data) = 'array' then jsonb_array_length(old.data) else 0 end));
    return old;
  end if;

  if new.name is distinct from old.name then
    perform public.audit('board.renamed', new.id, new.name, jsonb_build_object('from', old.name, 'to', new.name));
  end if;

  if new.config is distinct from old.config then
    perform public.audit('board.layout_changed', new.id, new.name, jsonb_build_object(
      'columns', (select coalesce(jsonb_agg(c ->> 'name'), '[]'::jsonb) from jsonb_array_elements(coalesce(new.config -> 'columns', '[]'::jsonb)) c),
      'lanes',   (select coalesce(jsonb_agg(c ->> 'name'), '[]'::jsonb) from jsonb_array_elements(coalesce(new.config -> 'lanes', '[]'::jsonb)) c)));
  end if;

  if new.data is distinct from old.data then
    od := case when jsonb_typeof(old.data) = 'array' then old.data else '[]'::jsonb end;
    nd := case when jsonb_typeof(new.data) = 'array' then new.data else '[]'::jsonb end;
    for r in
      with o as (select e ->> 'id' as id, e from jsonb_array_elements(od) e),
           nw as (select e ->> 'id' as id, e from jsonb_array_elements(nd) e)
      select coalesce(o.id, nw.id) as id, o.e as oe, nw.e as ne
      from o full join nw on o.id = nw.id
      where o.e is distinct from nw.e
    loop
      n := n + 1;
      if n > 100 then
        perform public.audit('task.bulk_changed', new.id, new.name, '{}'::jsonb); exit;
      end if;
      if r.oe is null then
        perform public.audit('task.created', new.id, r.id, jsonb_build_object(
          'title', r.ne ->> 'title', 'when', r.ne ->> 'when', 'kind', r.ne ->> 'kind'));
      elsif r.ne is null then
        perform public.audit('task.deleted', new.id, r.id, jsonb_build_object('title', r.oe ->> 'title'));
      else
        select coalesce(array_agg(k order by k), '{}') into fields from (
          select key as k from jsonb_each(r.ne) where (r.oe -> key) is distinct from value
          union
          select key from jsonb_each(r.oe) where not (r.ne ? key)) s
        where k <> 'order';
        if cardinality(fields) > 0 then
          perform public.audit('task.updated', new.id, r.id, jsonb_build_object(
            'title', r.ne ->> 'title',
            'fields', to_jsonb(fields),
            'when', case when 'when' = any(fields) then jsonb_build_array(r.oe ->> 'when', r.ne ->> 'when') end,
            'kind', case when 'kind' = any(fields) then jsonb_build_array(r.oe ->> 'kind', r.ne ->> 'kind') end));
        end if;
      end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists boards_audit on public.boards;
create trigger boards_audit after insert or delete or update of name, data, config on public.boards
  for each row execute function public.audit_boards();

-- Sharing: members and invites (skipped when a whole board is being deleted)
create or replace function public.audit_members() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit('member.added', new.board_id, new.email, jsonb_build_object('email', new.email, 'role', new.role));
    return new;
  elsif tg_op = 'DELETE' then
    if exists (select 1 from public.boards where id = old.board_id) then
      perform public.audit('member.removed', old.board_id, old.email, jsonb_build_object('email', old.email, 'role', old.role));
    end if;
    return old;
  end if;
  if new.role is distinct from old.role then
    perform public.audit('member.role_changed', new.board_id, new.email, jsonb_build_object('email', new.email, 'role', new.role));
  end if;
  return new;
end $$;
drop trigger if exists members_audit on public.board_members;
create trigger members_audit after insert or delete or update of role on public.board_members
  for each row execute function public.audit_members();

create or replace function public.audit_invites() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit('invite.created', new.board_id, new.email, jsonb_build_object('email', new.email, 'role', new.role));
    return new;
  end if;
  if exists (select 1 from public.boards where id = old.board_id) then
    perform public.audit(
      case when lower(coalesce(auth.jwt() ->> 'email', '')) = old.email then 'invite.claimed' else 'invite.revoked' end,
      old.board_id, old.email, jsonb_build_object('email', old.email, 'role', old.role));
  end if;
  return old;
end $$;
drop trigger if exists invites_audit on public.board_invites;
create trigger invites_audit after insert or delete on public.board_invites
  for each row execute function public.audit_invites();

-- Events the browser may report (whitelisted; the actor is always the signed-in user)
create or replace function public.log_event(p_action text, p_board uuid default null, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  if p_action not in ('auth.sign_in', 'file.opened') then raise exception 'Unknown event'; end if;
  if p_action = 'file.opened' and not (p_board is not null and (public.is_owner(p_board) or public.is_member(p_board))) then
    raise exception 'No access';
  end if;
  perform public.audit(p_action, p_board, null, jsonb_build_object('name', left(p_detail ->> 'name', 200)));
end $$;
revoke execute on function public.log_event(text, uuid, jsonb) from public, anon;
grant execute on function public.log_event(text, uuid, jsonb) to authenticated;

-- =====================================================================
-- 7. FIRST ADMIN (do this last)
-- =====================================================================
-- 1) Create your own account first: Authentication > Users > Add user (tick "Auto confirm").
-- 2) Put your email below, remove the leading dashes, and run just that line:
--
-- update public.profiles set is_admin = true where email = 'you@example.com';
