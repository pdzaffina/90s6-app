create or replace function public.global_assign_tenant_members(p_tenant uuid,p_users uuid[],p_role text)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if not public.is_admin() then raise exception 'Global administrator required' using errcode='42501'; end if;
 if p_role not in ('user','superuser','tenant_admin') then raise exception 'Invalid tenant role' using errcode='22023'; end if;
 if coalesce(array_length(p_users,1),0) not between 1 and 100 then raise exception 'Select 1 to 100 users' using errcode='22023'; end if;
 if not exists(select 1 from public.tenants where id=p_tenant and status='active') then raise exception 'Organization unavailable' using errcode='22023'; end if;
 if exists(select 1 from unnest(p_users) id left join public.profiles p on p.id=id where p.id is null or p.disabled) then raise exception 'A selected account is unavailable or disabled' using errcode='22023'; end if;
 insert into public.tenant_members(tenant_id,user_id,role,status)
 select p_tenant,id,p_role,'active' from (select distinct unnest(p_users) id) users
 on conflict(tenant_id,user_id) do update set role=excluded.role,status='active';
 get diagnostics n=row_count;
 return n;
end $$;
revoke all on function public.global_assign_tenant_members(uuid,uuid[],text) from public,anon;
grant execute on function public.global_assign_tenant_members(uuid,uuid[],text) to authenticated;