begin;

alter table public.sentinel_scan_runs
  add column attempt_count integer not null default 0,
  add column next_attempt_at timestamptz;

create table sentinel_private.provider_cooldowns (
  provider text primary key,
  next_request_at timestamptz not null
);
revoke all on sentinel_private.provider_cooldowns from public, anon, authenticated;
grant select, insert, update on sentinel_private.provider_cooldowns to service_role;

create function public.sentinel_provider_gate(p_provider text, p_cooldown_seconds integer default 0)
returns boolean language plpgsql security invoker set search_path='' as $$
declare current_time_utc timestamptz := clock_timestamp(); accepted boolean;
begin
  if p_provider not in ('gdelt','google-news-rss') or p_cooldown_seconds not between 0 and 86400 then
    raise exception 'Invalid provider cooldown';
  end if;
  if p_cooldown_seconds>0 then
    insert into sentinel_private.provider_cooldowns as slot values
      (p_provider,current_time_utc+make_interval(secs=>p_cooldown_seconds))
    on conflict(provider) do update
      set next_request_at=greatest(slot.next_request_at,excluded.next_request_at);
    return true;
  end if;
  insert into sentinel_private.provider_cooldowns as slot values
    (p_provider,current_time_utc+make_interval(secs=>case p_provider when 'gdelt' then 6 else 2 end))
  on conflict(provider) do update set next_request_at=excluded.next_request_at
    where slot.next_request_at<=current_time_utc
  returning true into accepted;
  return coalesce(accepted,false);
end $$;
revoke all on function public.sentinel_provider_gate(text,integer) from public, anon, authenticated;
grant execute on function public.sentinel_provider_gate(text,integer) to service_role;

create or replace function public.sentinel_claim()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare job public.sentinel_scan_runs; watch public.sentinel_watches;
begin
  update public.sentinel_scan_runs
  set status=case when attempt_count<4 then 'queued' else 'failed' end,
      finished_at=case when attempt_count<4 then null else now() end,
      next_attempt_at=case when attempt_count<4 then now()+interval '1 minute' end,
      error='Worker lease expired.'
  where status='running' and coalesce(started_at,created_at)<now()-interval '15 minutes';

  update public.sentinel_scan_runs r
  set status='failed', finished_at=now(), error='Scan canceled because the watch or its access was disabled.'
  from public.sentinel_watches w
  where r.watch_id=w.id and r.status='queued'
    and (not w.active or not sentinel_private.watch_can_run(w.org_id,w.owner_id));

  with due as (
    select w.org_id,w.id,
           row_number() over(partition by w.org_id order by last_run.created_at nulls first,w.created_at,w.id) as position
    from public.sentinel_watches w
    left join lateral (
      select r.created_at from public.sentinel_scan_runs r
      where r.watch_id=w.id order by r.created_at desc limit 1
    ) last_run on true
    where w.active and w.frequency<>'manual'
      and sentinel_private.watch_can_run(w.org_id,w.owner_id)
      and (last_run.created_at is null or last_run.created_at<=now()-case w.frequency
        when '6h' then interval '6 hours'
        when 'weekly' then interval '7 days'
        when 'monthly' then interval '1 month'
        else interval '1 day'
      end)
  )
  insert into public.sentinel_scan_runs(org_id,watch_id)
  select org_id,id from due order by position,org_id limit 50 on conflict do nothing;

  select r.* into job
  from public.sentinel_scan_runs r
  join public.sentinel_watches w on w.id=r.watch_id
  where r.status='queued' and (r.next_attempt_at is null or r.next_attempt_at<=now()) and w.active and sentinel_private.watch_can_run(w.org_id,w.owner_id)
  order by (
    select max(recent.started_at) from public.sentinel_scan_runs recent
    where recent.org_id=r.org_id and recent.started_at is not null
  ) nulls first,r.created_at,r.id
  limit 1 for update of r skip locked;

  if not found then return null; end if;
  update public.sentinel_scan_runs set status='running',started_at=clock_timestamp(),next_attempt_at=null,attempt_count=attempt_count+1
  where id=job.id returning * into job;
  select * into watch from public.sentinel_watches where id=job.watch_id;
  return jsonb_build_object('id',job.id,'started_at',job.started_at,'attempt',job.attempt_count,'name',watch.name,'ticker',watch.ticker,'kind',watch.kind,'category',watch.category);
end $$;

create or replace function sentinel_private.dispatch() returns bigint language plpgsql set search_path='' as $$ declare t text; begin
delete from sentinel_private.tokens where expires_at<=now();
t:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
insert into sentinel_private.tokens values(t,now()+interval '2 minutes');
return net.http_post(url:='https://ohsrtfnlnlbipylyqpnh.supabase.co/functions/v1/sentinel-worker',headers:='{"Content-Type":"application/json"}'::jsonb,body:=jsonb_build_object('token',t),timeout_milliseconds:=130000);
end $$;

commit;
