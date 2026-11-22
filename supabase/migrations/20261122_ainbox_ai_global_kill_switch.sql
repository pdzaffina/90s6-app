begin;
alter table public.ainbox_ai_settings add column if not exists enabled boolean not null default true;
create or replace function public.ainbox_ai_set_enabled(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_admin=true) then
  raise exception 'Global administrator required' using errcode='42501';
 end if;
 update public.ainbox_ai_settings set enabled=p_enabled,updated_at=now(),updated_by=auth.uid() where id=1;
 return jsonb_build_object('enabled',p_enabled);
end $$;
revoke all on function public.ainbox_ai_set_enabled(boolean) from public,anon;
grant execute on function public.ainbox_ai_set_enabled(boolean) to authenticated;
create or replace function public.ainbox_ai_is_enabled()
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select enabled from public.ainbox_ai_settings where id=1),false)
$$;
revoke all on function public.ainbox_ai_is_enabled() from public,anon;
grant execute on function public.ainbox_ai_is_enabled() to authenticated;
create or replace function public.ainbox_ai_runtime_settings(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ainbox_authorized(p_tenant,false) then raise exception 'Action Inbox access required' using errcode='42501'; end if;
 select jsonb_build_object('model',model,'timeout_ms',timeout_ms,'max_tokens',max_tokens,'enabled',enabled) into result from public.ainbox_ai_settings where id=1;
 return result;
end $$;
commit;