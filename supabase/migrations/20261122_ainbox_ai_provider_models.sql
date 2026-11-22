begin;
alter table public.ainbox_ai_settings drop constraint if exists ainbox_ai_model_allowed;
alter table public.ainbox_ai_settings add constraint ainbox_ai_model_valid check (length(model) between 2 and 180 and model ~ '^[a-zA-Z0-9][a-zA-Z0-9_./:-]*$');
create or replace function public.ainbox_ai_save_settings(p_model text,p_timeout_ms integer,p_max_tokens integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_admin=true) then raise exception 'Global administrator required' using errcode='42501'; end if;
 if p_model is null or length(p_model) not between 2 and 180 or p_model !~ '^[a-zA-Z0-9][a-zA-Z0-9_./:-]*$' or p_timeout_ms not between 5000 and 60000 or p_max_tokens not between 100 and 4096 then raise exception 'Invalid AI configuration'; end if;
 update public.ainbox_ai_settings set model=p_model,timeout_ms=p_timeout_ms,max_tokens=p_max_tokens,updated_at=now(),updated_by=auth.uid() where id=1;
 return public.ainbox_ai_get_settings();
end $$;
commit;