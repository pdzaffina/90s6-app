begin;
create or replace function public.ainbox_get_scan_coverage(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ainbox_authorized(p_tenant,true) then
  return '[]'::jsonb;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'workstream_id',r.workstream_id,'rule_key',r.rule_key,'enabled',r.enabled,
  'interval_minutes',r.scan_interval_minutes,
  'scan_status',s.status,'scanned_at',s.completed_at,
  'evaluated',s.evaluated_count,'unknown',s.unknown_count,
  'violations',s.violation_count
 ) order by r.rule_key),'[]'::jsonb) into result
 from public.ainbox_rules r
 left join lateral (
  select status,completed_at,evaluated_count,unknown_count,violation_count
  from public.ainbox_scan_runs
  where tenant_id=p_tenant and rule_id=r.id
  order by started_at desc,id desc limit 1
 ) s on true
 where r.tenant_id=p_tenant;
 return result;
end $$;
revoke all on function public.ainbox_get_scan_coverage(uuid) from public,anon;
grant execute on function public.ainbox_get_scan_coverage(uuid) to authenticated;
commit;