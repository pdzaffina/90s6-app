create or replace function public.global_set_user_organization(p_user uuid,p_tenant uuid,p_active boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Global administrator required' using errcode='42501'; end if;
 if not exists(select 1 from public.profiles where id=p_user) then raise exception 'Unknown user' using errcode='22023'; end if;
 if not exists(select 1 from public.tenants where id=p_tenant and status='active') then raise exception 'Unknown or inactive organization' using errcode='22023'; end if;
 if p_active then
   insert into public.tenant_members(tenant_id,user_id,role,status)
   values(p_tenant,p_user,'user','active')
   on conflict(tenant_id,user_id) do update set status='active';
 else
   update public.tenant_members set status='inactive' where tenant_id=p_tenant and user_id=p_user;
 end if;
end $$;
revoke all on function public.global_set_user_organization(uuid,uuid,boolean) from public,anon;
grant execute on function public.global_set_user_organization(uuid,uuid,boolean) to authenticated;