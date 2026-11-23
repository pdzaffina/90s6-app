alter table public.ainbox_ai_components drop constraint if exists ainbox_ai_components_tokens_override_check;
alter table public.ainbox_ai_components add constraint ainbox_ai_components_tokens_override_check check(tokens_override between 100 and 32768);
do $$
declare fn text;
begin
 select pg_get_functiondef(p.oid) into fn from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='ainbox_ai_save_component_settings';
 fn:=replace(fn,'p_max_tokens not between 100 and 4096','p_max_tokens not between 100 and 32768');
 execute fn;
end $$;