begin;

alter table sentinel_private.provider_cooldowns
  add column last_http_status integer,
  add column last_response_at timestamptz,
  add column rate_limit_events bigint not null default 0;

create function public.sentinel_note_provider_result(p_provider text, p_status integer)
returns void language sql security invoker set search_path='' as $$
  update sentinel_private.provider_cooldowns
  set last_http_status=p_status, last_response_at=clock_timestamp(),
      rate_limit_events=rate_limit_events+case when p_status=429 then 1 else 0 end
  where provider=p_provider and (p_status=0 or p_status between 100 and 599)
$$;
revoke all on function public.sentinel_note_provider_result(text,integer) from public, anon, authenticated;
grant execute on function public.sentinel_note_provider_result(text,integer) to service_role;

create function public.sentinel_operations()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare metrics jsonb; providers jsonb;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and is_admin and not disabled) then
    raise exception 'Access denied' using errcode='42501';
  end if;

  select jsonb_build_object(
    'queued',count(*) filter(where status='queued'),
    'running',count(*) filter(where status='running'),
    'oldest_queued_at',min(created_at) filter(where status='queued'),
    'complete',count(*) filter(where status='complete' and finished_at>=now()-interval '24 hours'),
    'partial',count(*) filter(where status='partial' and finished_at>=now()-interval '24 hours'),
    'failed',count(*) filter(where status='failed' and finished_at>=now()-interval '24 hours'),
    'average_seconds',round(avg(extract(epoch from finished_at-started_at))
      filter(where finished_at>=now()-interval '24 hours' and finished_at>=started_at),1),
    'last_complete_at',max(finished_at) filter(where status='complete'),
    'retries',coalesce(sum(greatest(0,attempt_count-1)) filter(where created_at>=now()-interval '24 hours'),0),
    'ai_failures',(select count(*) from public.ainbox_ai_request_audit
      where component_key='sentinel_assessment' and error_message is not null
        and response_at>=now()-interval '24 hours')
  ) into metrics from public.sentinel_scan_runs;

  select coalesce(jsonb_agg(jsonb_build_object(
    'provider',provider,'last_status',last_http_status,'observed_at',last_response_at,
    'next_request_at',next_request_at,'rate_limit_events',rate_limit_events
  ) order by provider),'[]'::jsonb) into providers from sentinel_private.provider_cooldowns;
  return metrics||jsonb_build_object('providers',providers);
end $$;
revoke all on function public.sentinel_operations() from public, anon;
grant execute on function public.sentinel_operations() to authenticated;

commit;
