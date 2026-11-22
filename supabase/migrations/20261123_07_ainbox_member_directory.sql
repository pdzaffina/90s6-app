create or replace function public.ainbox_member_directory(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not (public.is_active() and (public.is_admin() or public.is_tenant_member(p_tenant)) and public.has_feature('work_board')) then
  raise exception 'Access denied' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(nullif(p.full_name,''),p.email)) order by coalesce(nullif(p.full_name,''),p.email)),'[]'::jsonb)
 into result from public.tenant_members m join public.profiles p on p.id=m.user_id
 where m.tenant_id=p_tenant and m.status='active' and not p.disabled;
 return result;
end $$;
revoke all on function public.ainbox_member_directory(uuid) from public,anon;
grant execute on function public.ainbox_member_directory(uuid) to authenticated;