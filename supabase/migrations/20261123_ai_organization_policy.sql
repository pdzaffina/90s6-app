begin;
create table if not exists public.ai_organization_disabled (
 tenant_id uuid primary key references public.tenants(id) on delete cascade,
 updated_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id)
);
alter table public.ai_organization_disabled enable row level security;
revoke all on public.ai_organization_disabled from public,anon,authenticated;
create or replace function public.ai_organization_policy_get()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 return jsonb_build_object('disabled_tenants',coalesce((select jsonb_agg(tenant_id) from public.ai_organization_disabled),'[]'::jsonb));
end $$;
create or replace function public.ai_organization_policy_save(p_disabled_tenants uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 if p_disabled_tenants is null then raise exception 'Organization selection required'; end if;
 if exists(select 1 from unnest(p_disabled_tenants) t(id) where not exists(select 1 from public.tenants where id=t.id)) then raise exception 'Unknown organization'; end if;
 delete from public.ai_organization_disabled where tenant_id <> all(p_disabled_tenants);
 insert into public.ai_organization_disabled(tenant_id,updated_by)
 select distinct id,auth.uid() from unnest(p_disabled_tenants) t(id)
 on conflict(tenant_id) do update set updated_at=now(),updated_by=excluded.updated_by;
 return public.ai_organization_policy_get();
end $$;
create or replace function public.ai_organization_is_enabled(p_tenant uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select enabled from public.ainbox_ai_settings where id=1),false)
 and not exists(select 1 from public.ai_organization_disabled where tenant_id=p_tenant)
$$;
create or replace function public.ai_platform_authorized(p_tenant uuid,p_component text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.is_active()
 and (public.is_admin() or public.is_tenant_member(p_tenant))
 and public.ai_organization_is_enabled(p_tenant)
 and public.ainbox_ai_component_enabled(p_component)
 and (public.is_admin() or p_component in ('platform_portfolio','platform_workboard','platform_knowledge','platform_content')
 and exists(select 1 from public.tenant_feature_access t where t.tenant_id=p_tenant and t.enabled=true and t.feature=case p_component when 'platform_portfolio' then 'portfolio_management' when 'platform_workboard' then 'work_boards' when 'platform_knowledge' then 'knowledge_base' else 'content_studio' end));
$$;
create or replace function public.ai_platform_runtime_settings(p_tenant uuid,p_component text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ai_platform_authorized(p_tenant,p_component) then raise exception 'AI feature access required' using errcode='42501'; end if;
 select jsonb_build_object('model',coalesce(c.model_override,s.model),'timeout_ms',coalesce(c.timeout_override_ms,s.timeout_ms),'max_tokens',coalesce(c.tokens_override,s.max_tokens),'enabled',public.ai_organization_is_enabled(p_tenant)) into result from public.ainbox_ai_settings s join public.ainbox_ai_components c on c.component_key=p_component where s.id=1;
 return result;
end $$;
create or replace function public.ainbox_ai_runtime_settings(p_tenant uuid,p_component text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ainbox_authorized(p_tenant,false) then raise exception 'Action Inbox access required' using errcode='42501'; end if;
 if p_component not in ('assessment','communication','remediation_plan','history','verification','escalation') then raise exception 'Invalid component'; end if;
 select jsonb_build_object('model',coalesce(c.model_override,s.model),'timeout_ms',coalesce(c.timeout_override_ms,s.timeout_ms),'max_tokens',coalesce(c.tokens_override,s.max_tokens),'enabled',public.ai_organization_is_enabled(p_tenant)) into result from public.ainbox_ai_settings s join public.ainbox_ai_components c on c.component_key=p_component where s.id=1;
 return result;
end $$;
revoke all on function public.ai_organization_policy_get(),public.ai_organization_policy_save(uuid[]),public.ai_organization_is_enabled(uuid) from public,anon;
grant execute on function public.ai_organization_policy_get(),public.ai_organization_policy_save(uuid[]),public.ai_organization_is_enabled(uuid) to authenticated;
commit;