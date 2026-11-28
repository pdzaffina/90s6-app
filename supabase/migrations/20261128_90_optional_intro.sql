alter table public.profiles add column if not exists intro_presentation_enabled boolean not null default false;
create or replace function public.set_intro_presentation(p_user uuid,p_enabled boolean,p_tenant uuid default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 if p_enabled is null or not exists(select 1 from profiles where id=auth.uid() and not disabled) then raise exception 'Access denied'; end if;
 if not exists(select 1 from profiles where id=auth.uid() and is_admin) then
 if not exists(select 1 from tenant_members where tenant_id=p_tenant and user_id=auth.uid() and role='tenant_admin' and status='active') or not exists(select 1 from tenant_members where tenant_id=p_tenant and user_id=p_user and status='active') or not exists(select 1 from profiles where id=p_user and not is_admin and not disabled) then raise exception 'Access denied'; end if;
 end if;
 update profiles set intro_presentation_enabled=p_enabled where id=p_user;
 if not found then raise exception 'User not found'; end if;
 insert into audit_log(actor_id,actor_email,action,target,detail) select auth.uid(),email,'admin.set_intro_presentation',p_user::text,jsonb_build_object('enabled',p_enabled,'tenant',p_tenant) from profiles where id=auth.uid();
end $$;
revoke all on function public.set_intro_presentation(uuid,boolean,uuid) from public,anon;
grant execute on function public.set_intro_presentation(uuid,boolean,uuid) to authenticated;
