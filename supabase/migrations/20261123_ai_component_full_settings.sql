alter table public.ainbox_ai_components add column if not exists timeout_override_ms integer check(timeout_override_ms between 5000 and 60000), add column if not exists tokens_override integer check(tokens_override between 100 and 4096);
create or replace function public.ainbox_ai_save_component_settings(p_key text,p_custom boolean,p_model text default null,p_timeout_ms integer default null,p_max_tokens integer default null) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 if p_custom is null then raise exception 'Choose global or custom'; end if;
 if p_custom and (p_model is null or length(p_model) not between 3 and 160 or p_model !~ '^[A-Za-z0-9_.:/-]+$' or p_timeout_ms not between 5000 and 60000 or p_max_tokens not between 100 and 4096) then raise exception 'Invalid custom settings'; end if;
 update public.ainbox_ai_components set model_override=case when p_custom then p_model else null end,timeout_override_ms=case when p_custom then p_timeout_ms else null end,tokens_override=case when p_custom then p_max_tokens else null end,updated_at=now(),updated_by=auth.uid() where component_key=p_key;
 if not found then raise exception 'Unknown AI component'; end if;
 return true;
end $$;
revoke all on function public.ainbox_ai_save_component_settings(text,boolean,text,integer,integer) from public,anon;
grant execute on function public.ainbox_ai_save_component_settings(text,boolean,text,integer,integer) to authenticated;
create or replace function public.ainbox_ai_list_components() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ai_platform_is_admin() then raise exception 'Global administrator required' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('key',component_key,'label',label,'description',description,'enabled',enabled,'model_override',model_override,'timeout_override_ms',timeout_override_ms,'tokens_override',tokens_override) order by component_key),'[]'::jsonb) from public.ainbox_ai_components);
end $$;
create or replace function public.ai_platform_runtime_settings(p_tenant uuid,p_component text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ai_platform_authorized(p_tenant,p_component) then raise exception 'AI feature access required' using errcode='42501'; end if;
 select jsonb_build_object('model',coalesce(c.model_override,s.model),'timeout_ms',coalesce(c.timeout_override_ms,s.timeout_ms),'max_tokens',coalesce(c.tokens_override,s.max_tokens),'enabled',s.enabled) into result from public.ainbox_ai_settings s join public.ainbox_ai_components c on c.component_key=p_component where s.id=1;
 return result;
end $$;
create or replace function public.ainbox_ai_runtime_settings(p_tenant uuid,p_component text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ainbox_authorized(p_tenant,false) then raise exception 'Action Inbox access required' using errcode='42501'; end if;
 if p_component not in ('assessment','communication','remediation_plan','history','verification','escalation') then raise exception 'Invalid component'; end if;
 select jsonb_build_object('model',coalesce(c.model_override,s.model),'timeout_ms',coalesce(c.timeout_override_ms,s.timeout_ms),'max_tokens',coalesce(c.tokens_override,s.max_tokens),'enabled',s.enabled) into result from public.ainbox_ai_settings s join public.ainbox_ai_components c on c.component_key=p_component where s.id=1;
 return result;
end $$;