create or replace function public.ai_platform_runtime_settings(p_tenant uuid,p_component text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ai_platform_authorized(p_tenant,p_component) then raise exception 'AI feature access required' using errcode='42501'; end if;
 select jsonb_build_object('model',model,'timeout_ms',timeout_ms,'max_tokens',max_tokens,'enabled',enabled) into result from public.ainbox_ai_settings where id=1;
 return result;
end $$;
revoke all on function public.ai_platform_runtime_settings(uuid,text) from public,anon;
grant execute on function public.ai_platform_runtime_settings(uuid,text) to authenticated;