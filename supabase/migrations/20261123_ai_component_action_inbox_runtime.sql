create or replace function public.ainbox_ai_runtime_settings(p_tenant uuid,p_component text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ainbox_authorized(p_tenant,false) then raise exception 'Action Inbox access required' using errcode='42501'; end if;
 if p_component not in ('assessment','communication','remediation_plan','history','verification','escalation') then raise exception 'Invalid component'; end if;
 select jsonb_build_object('model',coalesce(c.model_override,s.model),'timeout_ms',s.timeout_ms,'max_tokens',s.max_tokens,'enabled',s.enabled)
 into result from public.ainbox_ai_settings s join public.ainbox_ai_components c on c.component_key=p_component where s.id=1;
 return result;
end $$;
revoke all on function public.ainbox_ai_runtime_settings(uuid,text) from public,anon;
grant execute on function public.ainbox_ai_runtime_settings(uuid,text) to authenticated;