create table if not exists public.ainbox_ai_advisories(
 tenant_id uuid not null,exception_id uuid not null,component_key text not null,user_id uuid not null,
 subject text not null,body text not null,generated_at timestamptz not null default now(),
 primary key(exception_id,component_key,user_id)
);
alter table public.ainbox_ai_advisories enable row level security;
revoke all on public.ainbox_ai_advisories from public,anon,authenticated;
create or replace function public.ainbox_ai_advisory_get(p_tenant uuid,p_exception uuid,p_component text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
 if not public.ainbox_authorized(p_tenant,false) or not exists(select 1 from public.ainbox_exceptions where id=p_exception and tenant_id=p_tenant and (assignee_id=auth.uid() or source_owner_id=auth.uid())) then return null; end if;
 select jsonb_build_object('subject',subject,'body',body,'generated_at',generated_at) into v from public.ainbox_ai_advisories where tenant_id=p_tenant and exception_id=p_exception and component_key=p_component and user_id=auth.uid();
 return v;
end $$;
create or replace function public.ainbox_ai_advisory_save(p_tenant uuid,p_exception uuid,p_component text,p_subject text,p_body text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.ainbox_authorized(p_tenant,false) or not exists(select 1 from public.ainbox_exceptions where id=p_exception and tenant_id=p_tenant and (assignee_id=auth.uid() or source_owner_id=auth.uid())) then raise exception 'Access denied' using errcode='42501'; end if;
 if p_component not in ('history','verification') or length(p_body)>20000 then raise exception 'Invalid advisory'; end if;
 insert into public.ainbox_ai_advisories(tenant_id,exception_id,component_key,user_id,subject,body)
 values(p_tenant,p_exception,p_component,auth.uid(),left(p_subject,300),p_body)
 on conflict(exception_id,component_key,user_id) do update set subject=excluded.subject,body=excluded.body,generated_at=now();
 return true;
end $$;
revoke all on function public.ainbox_ai_advisory_get(uuid,uuid,text),public.ainbox_ai_advisory_save(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.ainbox_ai_advisory_get(uuid,uuid,text),public.ainbox_ai_advisory_save(uuid,uuid,text,text,text) to authenticated;