create or replace function public.ai_platform_authorized(p_tenant uuid,p_component text)
returns boolean language sql stable security definer set search_path='' as $$
select auth.uid() is not null and public.is_active()
and (public.is_admin() or public.is_tenant_member(p_tenant))
and public.ainbox_ai_component_enabled(p_component)
and (public.is_admin() or p_component in ('platform_workboard','platform_knowledge','platform_content')
and exists(select 1 from public.tenant_feature_access t where t.tenant_id=p_tenant and t.enabled=true
 and t.feature=case p_component when 'platform_workboard' then 'work_board' when 'platform_knowledge' then 'knowledge_base' else 'content_studio' end)
 and coalesce((select enabled from public.tenant_user_feature_access u where u.tenant_id=p_tenant and u.user_id=auth.uid()
 and u.feature=case p_component when 'platform_workboard' then 'work_board' when 'platform_knowledge' then 'knowledge_base' else 'content_studio' end),true));
$$;
revoke all on function public.ai_platform_authorized(uuid,text) from public,anon;
grant execute on function public.ai_platform_authorized(uuid,text) to authenticated;