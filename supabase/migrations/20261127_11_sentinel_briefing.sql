begin;

insert into public.ainbox_ai_components(component_key,label,description,enabled) values
 ('sentinel_briefing','Sentinel Executive Briefing','Summarizes selected accessible assessments for executives',true),
 ('sentinel_risk_classification','Sentinel Risk Review','Provides a separate advisory review of risk and confidence',true)
on conflict(component_key) do nothing;

create or replace function public.ai_platform_authorized(p_tenant uuid,p_component text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.is_active()
 and (public.is_admin() or public.is_tenant_member(p_tenant))
 and public.ai_organization_is_enabled(p_tenant)
 and public.ainbox_ai_component_enabled(p_component)
 and (case when p_component in ('sentinel_briefing','sentinel_risk_classification')
 then public.news_watch_allowed(p_tenant)
 else (public.is_admin() or p_component in ('platform_portfolio','platform_workboard','platform_knowledge','platform_content')
 and exists(select 1 from public.tenant_feature_access t where t.tenant_id=p_tenant and t.enabled=true and t.feature=case p_component when 'platform_portfolio' then 'portfolio_management' when 'platform_workboard' then 'work_boards' when 'platform_knowledge' then 'knowledge_base' else 'content_studio' end)) end);
$$;

create or replace function public.ainbox_ai_reserve(p_tenant uuid,p_component text,p_model text,p_estimate numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_budget numeric;v_used numeric;
begin
 if auth.uid() is null then raise exception 'Access denied' using errcode='42501'; end if;
 if p_component in ('replay','evaluation','platform_portfolio','platform_workboard','platform_knowledge','platform_content','sentinel_briefing','sentinel_risk_classification') then
  if not public.ai_platform_authorized(p_tenant,p_component) then raise exception 'Access denied' using errcode='42501'; end if;
 else
  if not public.ainbox_authorized(p_tenant,false) then raise exception 'Access denied' using errcode='42501'; end if;
 end if;
 if not public.ainbox_ai_component_enabled(p_component) then raise exception 'AI component disabled' using errcode='42501'; end if;
 if p_estimate is null or p_estimate<=0 or p_estimate>10 then raise exception 'Invalid reservation'; end if;
 perform pg_advisory_xact_lock(90261122,1);
 select monthly_budget_usd into v_budget from public.ainbox_ai_settings where id=1;
 select coalesce(sum(case when status='reserved' then reserved_usd when status='completed' then estimated_usd else 0 end),0) into v_used from public.ainbox_ai_usage where created_at>=date_trunc('month',now());
 if v_used+p_estimate>v_budget then raise exception 'Monthly AI budget exhausted' using errcode='P0001'; end if;
 insert into public.ainbox_ai_usage(user_id,tenant_id,component_key,model,reserved_usd) values(auth.uid(),p_tenant,p_component,left(p_model,160),p_estimate) returning id into v_id;
 return v_id;
end $$;

commit;
