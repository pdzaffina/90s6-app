begin;
create table if not exists public.ainbox_ai_components (
 component_key text primary key,
 label text not null,
 description text not null,
 enabled boolean not null default false,
 updated_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id)
);
alter table public.ainbox_ai_components enable row level security;
revoke all on public.ainbox_ai_components from public,anon,authenticated;
insert into public.ainbox_ai_components(component_key,label,description,enabled) values
 ('assessment','Exception assessments','AI interpretation of accessible exceptions',true),
 ('communication','Remediation communications','Draft remediation and follow-up messages',false),
 ('remediation_plan','Remediation planning','Suggest corrective actions',false),
 ('history','Exception history','Summarize recurring exceptions',false),
 ('escalation','Escalation drafting','Draft escalation messages',false),
 ('verification','Resolution verification','Evaluate closure evidence',false)
on conflict(component_key) do nothing;
create or replace function public.ainbox_ai_list_components()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_admin=true) then
 raise exception 'Global administrator required' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('key',component_key,'label',label,'description',description,'enabled',enabled) order by component_key),'[]'::jsonb) from public.ainbox_ai_components);
end $$;
create or replace function public.ainbox_ai_set_component(p_key text,p_enabled boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_admin=true) then
 raise exception 'Global administrator required' using errcode='42501'; end if;
 update public.ainbox_ai_components set enabled=p_enabled,updated_at=now(),updated_by=auth.uid() where component_key=p_key;
 if not found then raise exception 'Unknown AI component'; end if;
 return p_enabled;
end $$;
create or replace function public.ainbox_ai_component_enabled(p_key text)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select s.enabled from public.ainbox_ai_settings s where s.id=1),false)
 and coalesce((select c.enabled from public.ainbox_ai_components c where c.component_key=p_key),false)
$$;
revoke all on function public.ainbox_ai_list_components() from public,anon;
revoke all on function public.ainbox_ai_set_component(text,boolean) from public,anon;
revoke all on function public.ainbox_ai_component_enabled(text) from public,anon;
grant execute on function public.ainbox_ai_list_components() to authenticated;
grant execute on function public.ainbox_ai_set_component(text,boolean) to authenticated;
grant execute on function public.ainbox_ai_component_enabled(text) to authenticated;
commit;