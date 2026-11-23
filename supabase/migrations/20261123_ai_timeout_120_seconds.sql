alter table public.ainbox_ai_components drop constraint if exists ainbox_ai_components_timeout_override_ms_check;
alter table public.ainbox_ai_components add constraint ainbox_ai_components_timeout_override_ms_check check(timeout_override_ms between 5000 and 120000);
do $$
declare fn text;
begin
 select pg_get_functiondef(p.oid) into fn from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='ainbox_ai_save_component_settings';
 fn:=replace(fn,'p_timeout_ms not between 5000 and 60000','p_timeout_ms not between 5000 and 120000');
 execute fn;
 select pg_get_functiondef(p.oid) into fn from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='ainbox_ai_save_settings';
 if fn is not null then fn:=replace(fn,'p_timeout_ms not between 5000 and 60000','p_timeout_ms not between 5000 and 120000');execute fn;end if;
end $$;