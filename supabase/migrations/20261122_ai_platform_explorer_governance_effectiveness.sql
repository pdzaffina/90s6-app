begin;
create table if not exists public.ai_platform_policy(
 id integer primary key default 1 check(id=1),
 payload_retention_days integer not null default 90 check(payload_retention_days between 1 and 3650),
 redact_export boolean not null default true,
 updated_at timestamptz not null default now(),
 updated_by uuid
);
insert into public.ai_platform_policy(id) values(1) on conflict do nothing;
alter table public.ai_platform_policy enable row level security;
revoke all on public.ai_platform_policy from public,anon,authenticated;
create table if not exists public.ai_audit_access_log(
 id bigint generated always as identity primary key,
 audit_id uuid, actor_id uuid not null, action text not null,
 occurred_at timestamptz not null default now(),
 details jsonb not null default '{}'::jsonb
);
alter table public.ai_audit_access_log enable row level security;
revoke all on public.ai_audit_access_log from public,anon,authenticated;
create index if not exists ai_audit_access_log_time on public.ai_audit_access_log(occurred_at desc);
alter table public.ainbox_ai_request_audit add column if not exists context_exception_id uuid;
alter table public.ainbox_ai_request_audit add column if not exists replay_of uuid;
create index if not exists ai_audit_context on public.ainbox_ai_request_audit(context_exception_id);
create or replace function public.ai_platform_is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and is_admin=true)
$$;
revoke all on function public.ai_platform_is_admin() from public,anon;
grant execute on function public.ai_platform_is_admin() to authenticated;
create or replace function public.ai_policy_get() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 select to_jsonb(p) into v from public.ai_platform_policy p where id=1;
 return v;
end $$;
create or replace function public.ai_policy_set(p_days integer,p_redact boolean) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 if p_days not between 1 and 3650 or p_redact is null then raise exception 'Invalid retention policy'; end if;
 update public.ai_platform_policy set payload_retention_days=p_days,redact_export=p_redact,updated_by=auth.uid(),updated_at=now() where id=1;
 insert into public.ai_audit_access_log(actor_id,action,details) values(auth.uid(),'policy_change',jsonb_build_object('days',p_days,'redact_export',p_redact));
 return true;
end $$;
create or replace function public.ai_audit_search(p_limit integer default 100,p_component text default null,p_model text default null,p_status text default null,p_query text default null,p_since timestamptz default null)
returns table(usage_id uuid,tenant_id uuid,user_id uuid,component_key text,model text,request_at timestamptz,response_at timestamptz,http_status integer,input_tokens integer,output_tokens integer,total_tokens integer,estimated_usd numeric,error_message text,latency_ms bigint,replay_of uuid)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 return query select a.usage_id,a.tenant_id,a.user_id,a.component_key,a.model,a.request_at,a.response_at,a.http_status,a.input_tokens,a.output_tokens,a.total_tokens,a.estimated_usd,a.error_message,
 (extract(epoch from (a.response_at-a.request_at))*1000)::bigint,a.replay_of
 from public.ainbox_ai_request_audit a
 where (p_component is null or a.component_key=p_component)
 and (p_model is null or a.model ilike '%'||p_model||'%')
 and (p_status is null or case when p_status='success' then a.http_status between 200 and 299 when p_status='failed' then a.error_message is not null or a.http_status>=400 else a.response_at is null end)
 and (p_query is null or a.usage_id::text ilike '%'||p_query||'%' or a.model ilike '%'||p_query||'%' or a.component_key ilike '%'||p_query||'%')
 and (p_since is null or a.request_at>=p_since)
 order by a.request_at desc limit least(greatest(coalesce(p_limit,100),1),500);
end $$;
create or replace function public.ai_audit_inspect(p_usage uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 select to_jsonb(a) into v from public.ainbox_ai_request_audit a where a.usage_id=p_usage;
 if v is not null then insert into public.ai_audit_access_log(audit_id,actor_id,action) values(p_usage,auth.uid(),'inspect'); end if;
 return v;
end $$;
create or replace function public.ai_audit_export(p_limit integer default 200) returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;v_redact boolean;
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 select redact_export into v_redact from public.ai_platform_policy where id=1;
 select coalesce(jsonb_agg(case when v_redact then to_jsonb(z)-'request_payload'-'response_payload' else to_jsonb(z) end),'[]'::jsonb) into v from
 (select * from public.ainbox_ai_request_audit order by request_at desc limit least(greatest(coalesce(p_limit,200),1),500)) z;
 insert into public.ai_audit_access_log(actor_id,action,details) values(auth.uid(),'export',jsonb_build_object('redacted',v_redact,'limit',p_limit));
 return v;
end $$;
create or replace function public.ai_audit_access_recent(p_limit integer default 100) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(z)),'[]'::jsonb) into v from (select actor_id,audit_id,action,occurred_at,details from public.ai_audit_access_log order by occurred_at desc limit least(greatest(p_limit,1),200)) z;
 return v;
end $$;
create or replace function public.ai_effectiveness_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 with annotated as (
 select e.id,e.status,e.first_detected_at,e.resolved_at,
 exists(select 1 from public.ainbox_ai_request_audit a where a.context_exception_id=e.id and a.http_status between 200 and 299) as ai_assisted,
 exists(select 1 from public.ainbox_remediation_plans p where p.exception_id=e.id and p.approved_at is not null) as approved_plan
 from public.ainbox_exceptions e
 ), grouped as (
 select ai_assisted,count(*) as total,count(*) filter(where resolved_at is not null) as resolved,
 count(*) filter(where approved_plan) as approved_plans,
 round(avg(extract(epoch from (resolved_at-first_detected_at))/3600) filter(where resolved_at is not null)::numeric,2) as avg_resolution_hours
 from annotated group by ai_assisted
 )
 select coalesce(jsonb_agg(to_jsonb(grouped)),'[]'::jsonb) into v from grouped;
 return v;
end $$;
create or replace function public.ai_audit_link_context(p_usage uuid,p_exception uuid default null,p_replay uuid default null) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Unauthorized' using errcode='42501'; end if;
 if p_exception is not null and not exists(select 1 from public.ainbox_exceptions e join public.ainbox_ai_usage u on u.id=p_usage and u.tenant_id=e.tenant_id where e.id=p_exception and u.user_id=auth.uid()) then raise exception 'Exception access denied' using errcode='42501'; end if;
 update public.ainbox_ai_request_audit a set context_exception_id=p_exception,replay_of=p_replay where a.usage_id=p_usage and a.user_id=auth.uid();
 return found;
end $$;
create or replace function public.ai_audit_purge_due() returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 update public.ainbox_ai_request_audit a set request_payload='{"retained":false}'::jsonb,response_payload=null
 where a.request_at<now()-(select payload_retention_days*interval '1 day' from public.ai_platform_policy where id=1)
 and a.request_payload<>'{"retained":false}'::jsonb;
 get diagnostics n=row_count;
 insert into public.ai_audit_access_log(actor_id,action,details) values(auth.uid(),'retention_purge',jsonb_build_object('records',n));
 return n;
end $$;
revoke all on function public.ai_policy_get(),public.ai_policy_set(integer,boolean),public.ai_audit_search(integer,text,text,text,text,timestamptz),public.ai_audit_inspect(uuid),public.ai_audit_export(integer),public.ai_audit_access_recent(integer),public.ai_effectiveness_summary(),public.ai_audit_link_context(uuid,uuid,uuid),public.ai_audit_purge_due() from public,anon;
grant execute on function public.ai_policy_get(),public.ai_policy_set(integer,boolean),public.ai_audit_search(integer,text,text,text,text,timestamptz),public.ai_audit_inspect(uuid),public.ai_audit_export(integer),public.ai_audit_access_recent(integer),public.ai_effectiveness_summary(),public.ai_audit_link_context(uuid,uuid,uuid),public.ai_audit_purge_due() to authenticated;
commit;