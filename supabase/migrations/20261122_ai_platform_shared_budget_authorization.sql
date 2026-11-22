create or replace function public.ainbox_ai_reserve(p_tenant uuid,p_component text,p_model text,p_estimate numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_budget numeric;v_used numeric;
begin
 if auth.uid() is null then raise exception 'Access denied' using errcode='42501'; end if;
 if p_component in ('replay','evaluation','platform_portfolio','platform_workboard','platform_knowledge','platform_content') then
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
revoke all on function public.ainbox_ai_reserve(uuid,text,text,numeric) from public,anon;
grant execute on function public.ainbox_ai_reserve(uuid,text,text,numeric) to authenticated;