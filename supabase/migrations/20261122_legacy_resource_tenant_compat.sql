-- Compatibility for legacy clients that do not yet supply tenant_id.
-- Only a single active membership may be inferred. Multi-tenant users must select explicitly.
create or replace function public.assign_resource_tenant() returns trigger language plpgsql security definer set search_path='' as $$
declare inferred uuid;
begin
 if new.tenant_id is null then
   select min(m.tenant_id) into inferred from public.tenant_members m join public.tenants t on t.id=m.tenant_id
   where m.user_id=(select auth.uid()) and m.status='active' and t.status='active'
   having count(*)=1;
   if inferred is null then raise exception 'An explicit active tenant is required' using errcode='42501'; end if;
   new.tenant_id:=inferred;
 end if;
 return new;
end $$;
drop trigger if exists board_tenant_assignment on public.boards;
create trigger board_tenant_assignment before insert on public.boards for each row execute function public.assign_resource_tenant();
drop trigger if exists portfolio_tenant_assignment on public.pm_portfolios;
create trigger portfolio_tenant_assignment before insert on public.pm_portfolios for each row execute function public.assign_resource_tenant();
revoke all on function public.assign_resource_tenant() from public,anon,authenticated;
