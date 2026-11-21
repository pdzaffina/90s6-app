-- Applied to Supabase project ohsrtfnlnlbipylyqpnh on 2026-11-21.
-- Board creation and management are limited to admins and superusers.
alter table public.profiles add column if not exists is_superuser boolean not null default false;
create or replace function public.is_board_manager()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((select (p.is_admin or p.is_superuser) and not p.disabled from public.profiles p where p.id = (select auth.uid())), false) $$;
revoke all on function public.is_board_manager() from public, anon;
grant execute on function public.is_board_manager() to authenticated;
create or replace function public.can_manage_board(bid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select public.is_board_manager() and public.is_owner(bid) $$;
revoke all on function public.can_manage_board(uuid) from public, anon;
grant execute on function public.can_manage_board(uuid) to authenticated;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (id = (select auth.uid()) or public.is_board_manager());
drop policy if exists boards_insert on public.boards;
create policy boards_insert on public.boards for insert to authenticated
with check (public.is_board_manager() and owner_id = (select auth.uid()));
drop policy if exists boards_delete on public.boards;
create policy boards_delete on public.boards for delete to authenticated
using (public.can_manage_board(id));
drop policy if exists invites_all on public.board_invites;
create policy invites_all on public.board_invites for all to authenticated
using (public.can_manage_board(board_id)) with check (public.can_manage_board(board_id));
drop policy if exists members_delete on public.board_members;
create policy members_delete on public.board_members for delete to authenticated
using (user_id = (select auth.uid()) or public.can_manage_board(board_id));
create or replace function public.guard_board_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null
    and (new.name is distinct from old.name or new.config is distinct from old.config)
    and not public.can_manage_board(old.id) then
    raise exception 'Only an admin or superuser who owns this board can change its name or layout' using errcode = '42501';
  end if;
  return new;
end $$;
