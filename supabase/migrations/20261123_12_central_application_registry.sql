-- Central source of truth for organization-manageable application entitlements.
create table if not exists public.application_registry (
 feature_key text primary key,
 display_name text not null,
 sort_order integer not null default 100,
 active boolean not null default true
);
revoke all on public.application_registry from anon;
grant select on public.application_registry to authenticated;
alter table public.application_registry enable row level security;
create policy application_registry_read on public.application_registry for select to authenticated using (true);
insert into public.application_registry(feature_key,display_name,sort_order) values
('action_inbox','Action Inbox',10),('portfolio_management','Portfolio Management',20),('work_board','Work Boards',30),('training','Training',40),('prompt_library','Prompt Library',50),('content_studio','Content Studio',60),('studio_courses','Course editing',70),('studio_prompts','Prompt editing',80),('studio_knowledge','Knowledge editing',90),('knowledge_base','Knowledge Base',100),('use_case_curator','Create Custom Plan',110)
on conflict(feature_key) do update set display_name=excluded.display_name,sort_order=excluded.sort_order;
-- Retain existing Action Inbox opt-in: new tenants default disabled.
insert into public.tenant_feature_access(tenant_id,feature,enabled)
select id,'action_inbox',false from public.tenants on conflict do nothing;
create or replace function public.manage_tenant_features(p_tenant uuid,p_users uuid[],p_features text[],p_enabled boolean)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if not (public.is_admin() or public.is_tenant_admin(p_tenant)) then raise exception 'Organization admin required' using errcode='42501'; end if;
 if cardinality(p_users) not between 1 and 100 or cardinality(p_features) not between 1 and 100 then raise exception 'Invalid selection'; end if;
 if exists(select 1 from unnest(p_features) f where not exists(select 1 from public.application_registry r where r.feature_key=f and r.active)) then raise exception 'Invalid application'; end if;
 if exists(select 1 from unnest(p_users) u where not exists(select 1 from public.tenant_members m join public.profiles p on p.id=m.user_id where m.tenant_id=p_tenant and m.user_id=u and m.status='active' and not p.disabled and (public.is_admin() or not p.is_admin))) then raise exception 'A user is not an eligible active organization member'; end if;
 insert into public.tenant_user_feature_access(tenant_id,user_id,feature,enabled,updated_by)
 select p_tenant,u,f,p_enabled,auth.uid() from (select distinct unnest(p_users) u) a cross join (select distinct unnest(p_features) f) b
 on conflict(tenant_id,user_id,feature) do update set enabled=excluded.enabled,updated_at=now(),updated_by=excluded.updated_by;
 get diagnostics n=row_count;return n;
end $$;
create or replace function public.global_manage_organization_features(p_tenant uuid,p_features text[],p_enabled boolean)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if not public.is_admin() then raise exception 'Global administrator required' using errcode='42501'; end if;
 if not exists(select 1 from public.tenants where id=p_tenant and status='active') then raise exception 'Invalid organization'; end if;
 if cardinality(p_features) not between 1 and 100 or exists(select 1 from unnest(p_features) f where not exists(select 1 from public.application_registry r where r.feature_key=f and r.active)) then raise exception 'Invalid applications'; end if;
 insert into public.tenant_feature_access(tenant_id,feature,enabled,updated_by)
 select p_tenant,f,p_enabled,auth.uid() from (select distinct unnest(p_features) f) a
 on conflict(tenant_id,feature) do update set enabled=excluded.enabled,updated_at=now(),updated_by=excluded.updated_by;
 get diagnostics n=row_count;return n;
end $$;

