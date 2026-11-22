-- Claim invitations only for an active member of the invited board's tenant.
create or replace function public.claim_invites() returns void language sql security definer set search_path='' as $$
 with c as (
 delete from public.board_invites i
 where i.email=lower(auth.jwt()->>'email')
 and exists(select 1 from public.boards b join public.tenant_members m on m.tenant_id=b.tenant_id
 join public.tenants t on t.id=b.tenant_id
 where b.id=i.board_id and m.user_id=(select auth.uid()) and m.status='active' and t.status='active')
 returning board_id,role)
 insert into public.board_members(board_id,user_id,email,role)
 select board_id,(select auth.uid()),lower(auth.jwt()->>'email'),role from c
 on conflict(board_id,user_id) do update set role=excluded.role $$;
revoke all on function public.claim_invites() from public,anon;
grant execute on function public.claim_invites() to authenticated;
-- Portfolio member writes must remain inside the portfolio tenant.
drop policy if exists pm_members_manage on public.pm_portfolio_members;
create policy pm_members_manage on public.pm_portfolio_members for all to authenticated
 using(public.pm_access(portfolio_id,'manager'))
 with check(public.pm_access(portfolio_id,'manager') and exists(
 select 1 from public.pm_portfolios p join public.tenant_members m on m.tenant_id=p.tenant_id
 where p.id=portfolio_id and m.user_id=pm_portfolio_members.user_id and m.status='active'));
