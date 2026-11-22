-- Tenant-aware board and portfolio authorization cutover.
create or replace function public.tenant_role(p_tenant uuid) returns text language sql stable security definer set search_path='' as $$
 select m.role from public.tenant_members m join public.tenants t on t.id=m.tenant_id join public.profiles p on p.id=m.user_id
 where m.tenant_id=p_tenant and m.user_id=(select auth.uid()) and m.status='active' and t.status='active' and not p.disabled limit 1 $$;
revoke all on function public.tenant_role(uuid) from public,anon;
grant execute on function public.tenant_role(uuid) to authenticated;
create or replace function public.can_manage_board(bid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active() and exists(select 1 from public.boards b where b.id=bid and
 (public.is_admin() or (public.is_tenant_admin(b.tenant_id)) or (b.owner_id=(select auth.uid()) and public.tenant_role(b.tenant_id)='superuser'))) $$;
create or replace function public.can_edit(bid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active() and exists(select 1 from public.boards b where b.id=bid and
 (public.is_admin() or public.is_tenant_admin(b.tenant_id) or
 (public.is_tenant_member(b.tenant_id) and (b.owner_id=(select auth.uid()) and public.tenant_role(b.tenant_id)='superuser'
 or exists(select 1 from public.board_members m where m.board_id=b.id and m.user_id=(select auth.uid()) and m.role='editor'))))) $$;
create or replace function public.is_member(bid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active() and exists(select 1 from public.boards b join public.board_members m on m.board_id=b.id
 where b.id=bid and m.user_id=(select auth.uid()) and public.is_tenant_member(b.tenant_id)) $$;
create or replace function public.pm_access(pid uuid,minimum_role text default 'viewer') returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active() and exists(select 1 from public.pm_portfolios p where p.id=pid and
 (public.is_admin() or public.is_tenant_admin(p.tenant_id) or
 (public.is_tenant_member(p.tenant_id) and
 (p.created_by=(select auth.uid()) and public.tenant_role(p.tenant_id)='superuser'
 or exists(select 1 from public.pm_portfolio_members m where m.portfolio_id=p.id and m.user_id=(select auth.uid())
 and (minimum_role='viewer' or minimum_role='editor' and m.role in ('manager','editor') or minimum_role='manager' and m.role='manager')))))) $$;
drop policy if exists boards_select on public.boards;
create policy boards_select on public.boards for select to authenticated using(public.has_feature('work_board') and public.is_active() and
 (public.is_admin() or public.is_tenant_admin(tenant_id) or
 (public.is_tenant_member(tenant_id) and (owner_id=(select auth.uid()) and public.tenant_role(tenant_id)='superuser' or public.is_member(id)))));
drop policy if exists boards_insert on public.boards;
create policy boards_insert on public.boards for insert to authenticated with check(owner_id=(select auth.uid()) and public.has_feature('work_board') and public.is_active() and
 (public.is_admin() or public.tenant_role(tenant_id) in ('tenant_admin','superuser')));
drop policy if exists pm_portfolio_insert on public.pm_portfolios;
create policy pm_portfolio_insert on public.pm_portfolios for insert to authenticated with check(created_by=(select auth.uid()) and public.is_active() and
 (public.is_admin() or public.tenant_role(tenant_id) in ('tenant_admin','superuser')));
drop policy if exists members_select on public.board_members;
create policy members_select on public.board_members for select to authenticated using(user_id=(select auth.uid()) and public.is_member(board_id) or public.can_manage_board(board_id));
drop policy if exists members_delete on public.board_members;
create policy members_delete on public.board_members for delete to authenticated using(user_id=(select auth.uid()) or public.can_manage_board(board_id));
create policy members_insert_tenant on public.board_members for insert to authenticated with check(public.can_manage_board(board_id) and exists(select 1 from public.boards b where b.id=board_id and (public.is_admin() or public.is_tenant_member(b.tenant_id)) and exists(select 1 from public.tenant_members m where m.tenant_id=b.tenant_id and m.user_id=board_members.user_id and m.status='active')));
create policy members_update_tenant on public.board_members for update to authenticated using(public.can_manage_board(board_id)) with check(public.can_manage_board(board_id) and exists(select 1 from public.boards b join public.tenant_members m on m.tenant_id=b.tenant_id where b.id=board_id and m.user_id=board_members.user_id and m.status='active'));
