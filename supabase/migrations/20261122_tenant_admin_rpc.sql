-- Tenant administration RPCs: explicit actor checks, no client-side role trust.
create or replace function public.tenant_set_member(p_tenant uuid,p_user uuid,p_role text,p_status text default 'active')
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid();
begin
 if actor is null or not public.is_active() then raise exception 'Authentication required' using errcode='42501'; end if;
 if not (public.is_admin() or public.is_tenant_admin(p_tenant)) then raise exception 'Tenant admin required' using errcode='42501'; end if;
 if p_role not in ('tenant_admin','superuser','user') or p_status not in ('active','inactive') then raise exception 'Invalid role or status' using errcode='22023'; end if;
 if not exists(select 1 from public.tenants where id=p_tenant and status='active') then raise exception 'Tenant inactive' using errcode='42501'; end if;
 if not exists(select 1 from public.profiles where id=p_user and not disabled) then raise exception 'User unavailable' using errcode='22023'; end if;
 if not public.is_admin() and exists(select 1 from public.profiles where id=p_user and is_admin) then raise exception 'Global admin membership managed by global admin' using errcode='42501'; end if;
 if p_user=actor and (p_role<>'tenant_admin' or p_status<>'active') and not public.is_admin() then raise exception 'Cannot demote or deactivate own tenant admin membership' using errcode='42501'; end if;
 insert into public.tenant_members(tenant_id,user_id,role,status) values(p_tenant,p_user,p_role,p_status)
 on conflict(tenant_id,user_id) do update set role=excluded.role,status=excluded.status;
end $$;
revoke all on function public.tenant_set_member(uuid,uuid,text,text) from public,anon;
grant execute on function public.tenant_set_member(uuid,uuid,text,text) to authenticated;
create or replace function public.global_create_tenant(p_name text,p_slug text,p_admin_user uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare created uuid;
begin
 if not public.is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 if length(trim(p_name)) not between 2 and 120 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_slug)>80 then raise exception 'Invalid tenant name or slug' using errcode='22023'; end if;
 if p_admin_user is not null and not exists(select 1 from public.profiles where id=p_admin_user and not disabled) then raise exception 'Admin user unavailable' using errcode='22023'; end if;
 insert into public.tenants(name,slug,status) values(trim(p_name),p_slug,'active') returning id into created;
 if p_admin_user is not null then insert into public.tenant_members(tenant_id,user_id,role,status) values(created,p_admin_user,'tenant_admin','active'); end if;
 return created;
end $$;
revoke all on function public.global_create_tenant(text,text,uuid) from public,anon;
grant execute on function public.global_create_tenant(text,text,uuid) to authenticated;
