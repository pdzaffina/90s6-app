begin;
insert into public.ainbox_ai_components(component_key,label,description,enabled) values
('replay','Audit replay','Re-run previously audited prompts for diagnosis',true),
('evaluation','Model evaluation','Compare two models on the same audited prompt',true),
('platform_portfolio','Portfolio AI','Shared AI service for portfolio initiatives',true),
('platform_workboard','Work Boards AI','Shared AI service for work boards',true),
('platform_knowledge','Knowledge AI','Shared AI service for knowledge articles',true),
('platform_content','Content AI','Shared AI service for content creation',true)
on conflict(component_key) do nothing;
create or replace function public.ai_replay_source(p_usage uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 select jsonb_build_object('tenant_id',tenant_id,'payload',request_payload,'model',model) into v from public.ainbox_ai_request_audit
 where usage_id=p_usage and request_payload ? 'messages';
 if v is not null then insert into public.ai_audit_access_log(audit_id,actor_id,action) values(p_usage,auth.uid(),'replay_source'); end if;
 return v;
end $$;
create or replace function public.ai_platform_authorized(p_tenant uuid,p_component text)
returns boolean language sql stable security definer set search_path='' as $$
select auth.uid() is not null and public.is_active()
and (public.is_admin() or public.is_tenant_member(p_tenant))
and public.ainbox_ai_component_enabled(p_component)
and (public.is_admin() or p_component in ('platform_portfolio','platform_workboard','platform_knowledge','platform_content')
and exists(select 1 from public.tenant_feature_access t where t.tenant_id=p_tenant and t.enabled=true and t.feature=case p_component when 'platform_portfolio' then 'portfolio_management' when 'platform_workboard' then 'work_boards' when 'platform_knowledge' then 'knowledge_base' else 'content_studio' end));
$$;
revoke all on function public.ai_replay_source(uuid),public.ai_platform_authorized(uuid,text) from public,anon;
grant execute on function public.ai_replay_source(uuid),public.ai_platform_authorized(uuid,text) to authenticated;
commit;