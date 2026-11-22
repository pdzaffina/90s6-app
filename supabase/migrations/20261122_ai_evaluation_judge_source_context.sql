create or replace function public.ai_evaluation_pair(p_a uuid,p_b uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a record;b record;v_original jsonb;
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 select * into a from public.ainbox_ai_request_audit where usage_id=p_a and component_key='evaluation' and http_status between 200 and 299;
 select * into b from public.ainbox_ai_request_audit where usage_id=p_b and component_key='evaluation' and http_status between 200 and 299;
 if a.usage_id is null or b.usage_id is null or a.usage_id=b.usage_id or a.tenant_id<>b.tenant_id or a.replay_of is null or a.replay_of is distinct from b.replay_of then raise exception 'Two successful evaluations of the same source required'; end if;
 select request_payload->'messages' into v_original from public.ainbox_ai_request_audit where usage_id=a.replay_of and tenant_id=a.tenant_id;
 return jsonb_build_object('tenant_id',a.tenant_id,'source_usage_id',a.replay_of,'original_messages',v_original,'a',jsonb_build_object('usage_id',a.usage_id,'model',a.model,'content',a.response_payload #>> '{choices,0,message,content}'),'b',jsonb_build_object('usage_id',b.usage_id,'model',b.model,'content',b.response_payload #>> '{choices,0,message,content}'));
end $$;
revoke all on function public.ai_evaluation_pair(uuid,uuid) from public,anon;
grant execute on function public.ai_evaluation_pair(uuid,uuid) to authenticated;