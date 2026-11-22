create or replace function public.tenant_member_feature_matrix(p_tenant uuid)
returns table(user_id uuid,feature text,enabled boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if not (public.is_admin() or public.is_tenant_admin(p_tenant)) then
  raise exception 'Organization administrator required' using errcode='42501';
 end if;
 return query
 select f.user_id,f.feature,f.enabled
 from public.tenant_user_feature_access f
 join public.tenant_members m on m.tenant_id=f.tenant_id and m.user_id=f.user_id
 join public.profiles p on p.id=f.user_id
 where f.tenant_id=p_tenant and (public.is_admin() or not p.is_admin);
end $$;
revoke all on function public.tenant_member_feature_matrix(uuid) from public,anon;
grant execute on function public.tenant_member_feature_matrix(uuid) to authenticated;