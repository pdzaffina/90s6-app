insert into public.tenants(name,slug) values ('90s6','90s6') on conflict(slug) do nothing;
insert into public.tenant_members(tenant_id,user_id,role)
select t.id,p.id,case when p.is_admin then 'tenant_admin' when p.is_superuser then 'superuser' else 'user' end
from public.tenants t cross join public.profiles p where t.slug='90s6'
on conflict(tenant_id,user_id) do nothing;
update public.boards b set tenant_id=t.id from public.tenants t where t.slug='90s6' and b.tenant_id is null;
update public.pm_portfolios p set tenant_id=t.id from public.tenants t where t.slug='90s6' and p.tenant_id is null;
alter table public.boards alter column tenant_id set not null;
alter table public.pm_portfolios alter column tenant_id set not null;
create or replace function public.is_tenant_member(p_tenant uuid) returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.tenant_members m join public.tenants t on t.id=m.tenant_id join public.profiles p on p.id=m.user_id where m.tenant_id=p_tenant and m.user_id=(select auth.uid()) and m.status='active' and t.status='active' and not p.disabled) $$;
create or replace function public.is_tenant_admin(p_tenant uuid) returns boolean language sql stable security definer set search_path='' as $$
select public.is_admin() or exists(select 1 from public.tenant_members m join public.tenants t on t.id=m.tenant_id join public.profiles p on p.id=m.user_id where m.tenant_id=p_tenant and m.user_id=(select auth.uid()) and m.role='tenant_admin' and m.status='active' and t.status='active' and not p.disabled) $$;
revoke all on function public.is_tenant_member(uuid),public.is_tenant_admin(uuid) from public,anon;
grant execute on function public.is_tenant_member(uuid),public.is_tenant_admin(uuid) to authenticated;
create policy tenants_read on public.tenants for select to authenticated using(public.is_tenant_member(id) or public.is_admin());
create policy tenant_members_read on public.tenant_members for select to authenticated using(public.is_tenant_member(tenant_id) or public.is_admin());
