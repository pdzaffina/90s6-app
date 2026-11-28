create table if not exists public.user_app_tours(user_id uuid not null references public.profiles(id) on delete cascade, tour_key text not null check(tour_key in ('workspace','action_inbox','work_board','portfolio_management','crm','news_watch','training','prompt_library','knowledge_base','content_studio')), enabled boolean not null default false, completed_at timestamptz, primary key(user_id,tour_key));
alter table public.user_app_tours enable row level security;
revoke all on public.user_app_tours from anon,authenticated;
grant select on public.user_app_tours to authenticated;
create policy tour_read on public.user_app_tours for select to authenticated using (user_id=auth.uid() or public.can_view_profile(user_id));
create or replace function public.set_app_tour(p_user uuid,p_enabled boolean,p_tenant uuid default null,p_key text default 'workspace',p_reset boolean default false)
returns void language plpgsql security definer set search_path=public as $$
begin
 if p_enabled is null or not exists(select 1 from profiles where id=auth.uid() and not disabled) then raise exception 'Access denied'; end if;
 if not exists(select 1 from profiles where id=auth.uid() and is_admin) then
 if not exists(select 1 from tenant_members where tenant_id=p_tenant and user_id=auth.uid() and role='tenant_admin' and status='active') or not exists(select 1 from tenant_members where tenant_id=p_tenant and user_id=p_user and status='active') or not exists(select 1 from profiles where id=p_user and not is_admin and not disabled) then raise exception 'Access denied'; end if;
 end if;
 insert into user_app_tours(user_id,tour_key,enabled) values(p_user,p_key,p_enabled) on conflict(user_id,tour_key) do update set enabled=excluded.enabled,completed_at=case when p_reset then null else user_app_tours.completed_at end;
 insert into audit_log(actor_id,actor_email,action,target,detail) select auth.uid(),email,'admin.set_app_tour',p_user::text,jsonb_build_object('enabled',p_enabled,'tenant',p_tenant,'tour',p_key,'reset',p_reset) from profiles where id=auth.uid();
end $$;
revoke all on function public.set_app_tour(uuid,boolean,uuid,text,boolean) from public,anon;
grant execute on function public.set_app_tour(uuid,boolean,uuid,text,boolean) to authenticated;

create or replace function public.complete_app_tour(p_key text) returns void language sql security definer set search_path=public as $$ update user_app_tours set completed_at=now() where user_id=auth.uid() and tour_key=p_key and enabled and exists(select 1 from profiles where id=auth.uid() and not disabled) $$;
revoke all on function public.complete_app_tour(text) from public,anon;
grant execute on function public.complete_app_tour(text) to authenticated;
