create or replace function public.ai_model_config_capture() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if row(old.model_override,old.timeout_override_ms,old.tokens_override) is distinct from row(new.model_override,new.timeout_override_ms,new.tokens_override) then
 insert into public.ai_model_config_history(component_key,old_settings,new_settings,changed_by) values(new.component_key,jsonb_build_object('model',old.model_override,'timeout_ms',old.timeout_override_ms,'tokens',old.tokens_override),jsonb_build_object('model',new.model_override,'timeout_ms',new.timeout_override_ms,'tokens',new.tokens_override),auth.uid());
 end if;
 return new;
end $$;