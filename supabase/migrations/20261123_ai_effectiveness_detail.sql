create or replace function public.ai_effectiveness_detail(p_days integer default 90) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ai_platform_is_admin() then raise exception 'Global admin required' using errcode='42501'; end if;
 return (with exceptions as (
 select e.id,e.tenant_id,e.first_detected_at,e.resolved_at,
 exists(select 1 from public.ainbox_ai_request_audit a where a.context_exception_id=e.id and a.http_status between 200 and 299 and a.request_at<=coalesce(e.resolved_at,now())) as ai_assisted,
 exists(select 1 from public.ainbox_remediation_plans p where p.exception_id=e.id and p.approved_at is not null) as approved_plan
 from public.ainbox_exceptions e where e.first_detected_at>=now()-least(greatest(p_days,1),365)*interval '1 day'
 ), groups as (
 select ai_assisted,count(*) as total,count(*) filter(where resolved_at is not null) as resolved,
 round(100.0*count(*) filter(where resolved_at is not null)/nullif(count(*),0),1) as resolution_pct,
 count(*) filter(where approved_plan) as approved_plans,
 round(avg(extract(epoch from(resolved_at-first_detected_at))/3600) filter(where resolved_at is not null)::numeric,2) as mean_resolution_hours,
 round((percentile_cont(0.5) within group(order by extract(epoch from(resolved_at-first_detected_at))/3600) filter(where resolved_at is not null))::numeric,2) as median_resolution_hours
 from exceptions group by ai_assisted
 )
 select coalesce(jsonb_agg(to_jsonb(groups) order by ai_assisted desc),'[]'::jsonb) from groups);
end $$;
revoke all on function public.ai_effectiveness_detail(integer) from public,anon;
grant execute on function public.ai_effectiveness_detail(integer) to authenticated;