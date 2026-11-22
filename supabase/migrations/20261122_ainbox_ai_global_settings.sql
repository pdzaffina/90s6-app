begin;
create table if not exists public.ainbox_ai_settings (
 id integer primary key default 1 check (id=1),
 model text not null default 'openai/gpt-oss-20b',
 timeout_ms integer not null default 20000 check(timeout_ms between 5000 and 60000),
 max_tokens integer not null default 300 check(max_tokens between 100 and 4096),
 updated_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id),
 constraint ainbox_ai_model_allowed check(model in ('openai/gpt-oss-20b','openai/gpt-oss-120b'))
);
alter table public.ainbox_ai_settings enable row level security;
revoke all on public.ainbox_ai_settings from public,anon,authenticated;
insert into public.ainbox_ai_settings(id) values (1) on conflict do nothing;
create or replace function public.ainbox_ai_get_settings()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_admin=true) then
 raise exception 'Global administrator required' using errcode='42501';
 end if;
 select jsonb_build_object('model',model,'timeout_ms',timeout_ms,'max_tokens',max_tokens,'updated_at',updated_at) into result from public.ainbox_ai_settings where id=1;
 return result;
end $$;
create or replace function public.ainbox_ai_save_settings(p_model text,p_timeout_ms integer,p_max_tokens integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_admin=true) then
 raise exception 'Global administrator required' using errcode='42501';
 end if;
 if p_model not in ('openai/gpt-oss-20b','openai/gpt-oss-120b') or p_timeout_ms not between 5000 and 60000 or p_max_tokens not between 100 and 4096 then
 raise exception 'Invalid AI configuration';
 end if;
 update public.ainbox_ai_settings set model=p_model,timeout_ms=p_timeout_ms,max_tokens=p_max_tokens,updated_at=now(),updated_by=auth.uid() where id=1;
 return public.ainbox_ai_get_settings();
end $$;
create or replace function public.ainbox_ai_runtime_settings(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ainbox_authorized(p_tenant,false) then raise exception 'Action Inbox access required' using errcode='42501'; end if;
 select jsonb_build_object('model',model,'timeout_ms',timeout_ms,'max_tokens',max_tokens) into result from public.ainbox_ai_settings where id=1;
 return result;
end $$;
revoke all on function public.ainbox_ai_get_settings() from public,anon;
revoke all on function public.ainbox_ai_save_settings(text,integer,integer) from public,anon;
revoke all on function public.ainbox_ai_runtime_settings(uuid) from public,anon;
grant execute on function public.ainbox_ai_get_settings() to authenticated;
grant execute on function public.ainbox_ai_save_settings(text,integer,integer) to authenticated;
grant execute on function public.ainbox_ai_runtime_settings(uuid) to authenticated;
commit;