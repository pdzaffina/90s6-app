create table if not exists public.tenant_feature_access (
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 feature text not null check (feature in ('portfolio_management','work_board','training','prompt_library','content_studio','studio_courses','studio_prompts','studio_knowledge','knowledge_base','use_case_curator')),
 enabled boolean not null default true,
 updated_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id),
 primary key(tenant_id,feature)
);
create table if not exists public.tenant_user_feature_access (
 tenant_id uuid not null,
 user_id uuid not null,
 feature text not null check (feature in ('portfolio_management','work_board','training','prompt_library','content_studio','studio_courses','studio_prompts','studio_knowledge','knowledge_base','use_case_curator')),
 enabled boolean not null,
 updated_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id),
 primary key(tenant_id,user_id,feature),
 foreign key(tenant_id,user_id) references public.tenant_members(tenant_id,user_id) on delete cascade
);
alter table public.tenant_feature_access enable row level security;
alter table public.tenant_user_feature_access enable row level security;
revoke all on public.tenant_feature_access,public.tenant_user_feature_access from anon,authenticated;
create or replace function public.tenant_feature_snapshot(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not (public.is_admin() or public.is_tenant_member(p_tenant)) then raise exception 'Access denied' using errcode='42501'; end if;
 select jsonb_build_object(
  'organization',coalesce((select jsonb_object_agg(feature,enabled) from public.tenant_feature_access where tenant_id=p_tenant),'{}'::jsonb),
  'user',coalesce((select jsonb_object_agg(feature,enabled) from public.tenant_user_feature_access where tenant_id=p_tenant and user_id=auth.uid()),'{}'::jsonb)
 ) into result;
 return result;
end $$;
create or replace function public.manage_tenant_features(p_tenant uuid,p_users uuid[],p_features text[],p_enabled boolean)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if not (public.is_admin() or public.is_tenant_admin(p_tenant)) then raise exception 'Organization admin required' using errcode='42501'; end if;
 if cardinality(p_users) not between 1 and 100 or cardinality(p_features) not between 1 and 10 then raise exception 'Invalid selection'; end if;
 if exists(select 1 from unnest(p_features) f where f not in ('portfolio_management','work_board','training','prompt_library','content_studio','studio_courses','studio_prompts','studio_knowledge','knowledge_base','use_case_curator')) then raise exception 'Invalid application'; end if;
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
 if cardinality(p_features) not between 1 and 10 or exists(select 1 from unnest(p_features) f where f not in ('portfolio_management','work_board','training','prompt_library','content_studio','studio_courses','studio_prompts','studio_knowledge','knowledge_base','use_case_curator')) then raise exception 'Invalid applications'; end if;
 insert into public.tenant_feature_access(tenant_id,feature,enabled,updated_by)
 select p_tenant,f,p_enabled,auth.uid() from (select distinct unnest(p_features) f) a
 on conflict(tenant_id,feature) do update set enabled=excluded.enabled,updated_at=now(),updated_by=excluded.updated_by;
 get diagnostics n=row_count;return n;
end $$;
create or replace function public.global_organization_feature_snapshot(p_tenant uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select case when public.is_admin() then
 coalesce((select jsonb_object_agg(feature,enabled) from public.tenant_feature_access where tenant_id=p_tenant),'{}'::jsonb)
 else null end $$;
revoke all on function public.tenant_feature_snapshot(uuid),public.manage_tenant_features(uuid,uuid[],text[],boolean),public.global_manage_organization_features(uuid,text[],boolean),public.global_organization_feature_snapshot(uuid) from public,anon;
grant execute on function public.tenant_feature_snapshot(uuid),public.manage_tenant_features(uuid,uuid[],text[],boolean),public.global_manage_organization_features(uuid,text[],boolean),public.global_organization_feature_snapshot(uuid) to authenticated;