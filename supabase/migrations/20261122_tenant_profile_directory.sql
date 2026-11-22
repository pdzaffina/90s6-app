-- Tenant-scoped profile directory: prevents disclosure across unrelated organizations.
create or replace function public.can_view_profile(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
select public.is_admin() or p_user=(select auth.uid()) or exists(
 select 1 from public.tenant_members mine join public.tenant_members theirs on theirs.tenant_id=mine.tenant_id
 join public.tenants t on t.id=mine.tenant_id
 where mine.user_id=(select auth.uid()) and theirs.user_id=p_user and mine.status='active' and theirs.status='active' and t.status='active'
 and exists(select 1 from public.profiles p where p.id=mine.user_id and not p.disabled)) $$;
revoke all on function public.can_view_profile(uuid) from public,anon;
grant execute on function public.can_view_profile(uuid) to authenticated;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using(public.can_view_profile(id));
-- Only the account owner may update their own non-privileged profile columns.
revoke update on public.profiles from authenticated;
grant update(full_name,last_seen_at,tour_completed_at,intro_presentation_completed_at) on public.profiles to authenticated;
