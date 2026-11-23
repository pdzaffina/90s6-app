create table if not exists public.ai_exception_escalation_events(
 id bigint generated always as identity primary key,
 exception_id uuid not null references public.ainbox_exceptions(id) on delete cascade,
 tenant_id uuid not null,
 escalated_at timestamptz not null default now(),
 source text not null default 'status_transition'
);
create index if not exists ai_exception_escalation_events_exception_idx on public.ai_exception_escalation_events(exception_id,escalated_at);
alter table public.ai_exception_escalation_events enable row level security;
revoke all on public.ai_exception_escalation_events from public,anon,authenticated;
create or replace function public.ai_capture_exception_escalation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if lower(new.status) in ('escalated','escalation') and lower(coalesce(old.status,'')) not in ('escalated','escalation') then
 insert into public.ai_exception_escalation_events(exception_id,tenant_id) values(new.id,new.tenant_id);
 end if;
 return new;
end $$;
drop trigger if exists ai_capture_exception_escalation on public.ainbox_exceptions;
create trigger ai_capture_exception_escalation after update of status on public.ainbox_exceptions for each row execute function public.ai_capture_exception_escalation();
create or replace function public.ai_effectiveness_detail(p_days integer default 90) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 return (with exceptions as (
 select e.id,e.first_detected_at,e.resolved_at,
 exists(select 1 from public.ainbox_ai_request_audit a where a.context_exception_id=e.id and a.http_status between 200 and 299 and a.request_at<=coalesce(e.resolved_at,now())) as ai_assisted,
 exists(select 1 from public.ainbox_remediation_plans p where p.exception_id=e.id and p.approved_at is not null) as approved_plan,
 exists(select 1 from public.ai_exception_escalation_events ev where ev.exception_id=e.id) as escalated
 from public.ainbox_exceptions e where e.first_detected_at>=now()-least(greatest(p_days,1),365)*interval '1 day'
 ), groups as (
 select ai_assisted,count(*) as total,count(*) filter(where resolved_at is not null) as resolved,
 round(100.0*count(*) filter(where resolved_at is not null)/nullif(count(*),0),1) as resolution_pct,
 count(*) filter(where approved_plan) as approved_plans,
 count(*) filter(where escalated) as escalated,
 round(100.0*count(*) filter(where escalated)/nullif(count(*),0),1) as escalation_pct,
 round(avg(extract(epoch from(resolved_at-first_detected_at))/3600) filter(where resolved_at is not null)::numeric,2) as mean_resolution_hours,
 round((percentile_cont(0.5) within group(order by extract(epoch from(resolved_at-first_detected_at))/3600) filter(where resolved_at is not null))::numeric,2) as median_resolution_hours
 from exceptions group by ai_assisted
 )
 select coalesce(jsonb_agg(to_jsonb(groups) order by ai_assisted desc),'[]'::jsonb) from groups);
end $$;