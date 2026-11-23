alter table public.ainbox_ai_components drop constraint if exists ainbox_ai_components_tokens_override_check;
alter table public.ainbox_ai_components add constraint ainbox_ai_components_tokens_override_check check(tokens_override between 100 and 262144);
do $$ declare fn text; name text; begin
 foreach name in array array['ainbox_ai_save_component_settings','ainbox_ai_save_settings'] loop
 select pg_get_functiondef(oid) into fn from pg_proc where pronamespace='public'::regnamespace and proname=name;
 fn:=replace(replace(fn,'p_max_tokens not between 100 and 32768','p_max_tokens not between 100 and 262144'),'p_max_tokens not between 100 and 4096','p_max_tokens not between 100 and 262144');
 execute fn;
 end loop;
end $$;