create or replace function public.global_bulk_manage_tenant_members(p_tenant uuid,p_users uuid[],p_action text,p_role text default 'user',p_active boolean default true)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer:=0;
begin
 if not public.is_admin() then raise exception 'Global administrator required' using errcode='42501'; end if;
 if coalesce(cardinality(p_users),0) not between 1 and 100 then raise exception 'Select 1 to 100 users'; end if;
 if p_action not in ('assign','remove') then raise exception 'Invalid action'; end if;
 if p_role not in ('user','superuser','tenant_admin') then raise exception 'Invalid role'; end if;
 if not exists(select 1 from public.tenants where id=p_tenant and status='active') then raise exception 'Organization unavailable'; end if;
 if exists(select 1 from unnest(p_users) u left join public.profiles p on p.id=u where p.id is null) then raise exception 'Unknown user'; end if;
 if p_action='assign' then
   insert into public.tenant_members(tenant_id,user_id,role,status)
   select p_tenant,u,p_role,case when p_active then 'active' else 'inactive' end from (select distinct unnest(p_users) u) x
   on conflict(tenant_id,user_id) do update set role=excluded.role,status=excluded.status;
 else
   update public.tenant_members set status='inactive' where tenant_id=p_tenant and user_id=any(p_users) and status<>'inactive';
 end if;
 get diagnostics n=row_count;return n;
end $$;
revoke all on function public.global_bulk_manage_tenant_members(uuid,uuid[],text,text,boolean) from public,anon;
grant execute on function public.global_bulk_manage_tenant_members(uuid,uuid[],text,text,boolean) to authenticated;