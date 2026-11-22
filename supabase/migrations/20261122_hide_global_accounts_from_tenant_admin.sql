-- Tenant administrators may see only organization accounts, never global administrator identities.
create or replace function public.can_view_profile(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
select public.is_admin() or p_user=(select auth.uid()) or
 (not exists(select 1 from public.profiles target where target.id=p_user and target.is_admin)
 and exists(
 select 1 from public.tenant_members mine
 join public.tenant_members theirs on theirs.tenant_id=mine.tenant_id
 join public.tenants t on t.id=mine.tenant_id
 where mine.user_id=(select auth.uid()) and theirs.user_id=p_user
 and mine.status='active' and theirs.status='active' and t.status='active'
 and exists(select 1 from public.profiles p where p.id=mine.user_id and not p.disabled)
 )) $$;
drop policy if exists tenant_members_read on public.tenant_members;
create policy tenant_members_read on public.tenant_members for select to authenticated
using (
 public.is_admin() or
 (public.is_tenant_member(tenant_id) and
 not exists(select 1 from public.profiles p where p.id=user_id and p.is_admin))
);
