alter table public.ainbox_ai_components add column if not exists model_override text;
alter table public.ainbox_ai_components add constraint ai_component_model_override_valid check(model_override is null or (length(model_override) between 3 and 160 and model_override ~ '^[A-Za-z0-9_.:/-]+$'));
update public.ainbox_ai_components set model_override='meta/llama-3.1-8b-instruct' where component_key='evaluation_judge' and model_override is null;
create or replace function public.ainbox_ai_list_components() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ai_platform_is_admin() then raise exception 'Global administrator required' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('key',component_key,'label',label,'description',description,'enabled',enabled,'model_override',model_override) order by component_key),'[]'::jsonb) from public.ainbox_ai_components);
end $$;
create or replace function public.ainbox_ai_set_component_model(p_key text,p_model text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.ai_platform_is_admin() then raise exception 'Global administrator required' using errcode='42501'; end if;
 if p_model is not null and (length(p_model) not between 3 and 160 or p_model !~ '^[A-Za-z0-9_.:/-]+$') then raise exception 'Invalid model ID'; end if;
 update public.ainbox_ai_components set model_override=p_model,updated_at=now(),updated_by=auth.uid() where component_key=p_key;
 if not found then raise exception 'Unknown AI component'; end if;
 return true;
end $$;
create or replace function public.ainbox_ai_component_model(p_key text) returns text language plpgsql stable security definer set search_path='' as $$
declare v_model text;
begin
 if auth.uid() is null or not public.is_active() then raise exception 'Authentication required' using errcode='42501'; end if;
 select coalesce(c.model_override,s.model) into v_model from public.ainbox_ai_components c cross join public.ainbox_ai_settings s where c.component_key=p_key and s.id=1;
 if v_model is null then raise exception 'Unknown AI component'; end if;
 return v_model;
end $$;
revoke all on function public.ainbox_ai_set_component_model(text,text),public.ainbox_ai_component_model(text) from public,anon;
grant execute on function public.ainbox_ai_set_component_model(text,text),public.ainbox_ai_component_model(text) to authenticated;
create or replace function public.ai_platform_runtime_settings(p_tenant uuid,p_component text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ai_platform_authorized(p_tenant,p_component) then raise exception 'AI feature access required' using errcode='42501'; end if;
 select jsonb_build_object('model',coalesce(c.model_override,s.model),'timeout_ms',s.timeout_ms,'max_tokens',s.max_tokens,'enabled',s.enabled)
 into result from public.ainbox_ai_settings s join public.ainbox_ai_components c on c.component_key=p_component where s.id=1;
 return result;
end $$;
create or replace function public.ainbox_ai_runtime_settings(p_tenant uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ainbox_authorized(p_tenant,false) then raise exception 'Action Inbox access required' using errcode='42501'; end if;
 select jsonb_build_object('model',coalesce(c.model_override,s.model),'timeout_ms',s.timeout_ms,'max_tokens',s.max_tokens,'enabled',s.enabled) into result from public.ainbox_ai_settings s join public.ainbox_ai_components c on c.component_key='assessment' where s.id=1;
 return result;
end $$;
revoke all on function public.ainbox_ai_list_components(),public.ai_platform_runtime_settings(uuid,text),public.ainbox_ai_runtime_settings(uuid) from public,anon;
grant execute on function public.ainbox_ai_list_components(),public.ai_platform_runtime_settings(uuid,text),public.ainbox_ai_runtime_settings(uuid) to authenticated;