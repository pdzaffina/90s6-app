begin;

alter table public.sentinel_watches
  add column alternative_names text not null default '' check(length(alternative_names)<=500),
  add column custom_terms text not null default '' check(length(custom_terms)<=300),
  add column excluded_terms text not null default '' check(length(excluded_terms)<=300),
  add column lookback_days integer not null default 7 check(lookback_days between 1 and 90),
  add column feed_url text not null default '' check(length(feed_url)<=2000);

create table sentinel_private.evidence (
  org_id uuid not null,
  watch_id uuid not null,
  fingerprint text not null,
  first_run_id uuid not null references public.sentinel_scan_runs(id),
  first_seen_at timestamptz not null default now(),
  evidence jsonb not null,
  primary key(org_id,watch_id,fingerprint),
  foreign key(org_id,watch_id) references public.sentinel_watches(org_id,id)
);
revoke all on sentinel_private.evidence from public, anon, authenticated;
grant select, insert on sentinel_private.evidence to service_role;

create function public.sentinel_watch_context(p_run uuid, p_started_at timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('alternative_names',w.alternative_names,'custom_terms',w.custom_terms,
    'excluded_terms',w.excluded_terms,'lookback_days',w.lookback_days,'feed_url',w.feed_url)
  from public.sentinel_scan_runs r join public.sentinel_watches w
    on w.id=r.watch_id and w.org_id=r.org_id
  where r.id=p_run and r.started_at=p_started_at and r.status='running'
    and w.active and sentinel_private.watch_can_run(w.org_id,w.owner_id)
$$;
revoke all on function public.sentinel_watch_context(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.sentinel_watch_context(uuid,timestamptz) to service_role;

create function public.sentinel_checkpoint_evidence(p_run uuid,p_started_at timestamptz,p_evidence jsonb,p_error text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare job public.sentinel_scan_runs; result jsonb;
begin
  if jsonb_typeof(p_evidence) is distinct from 'array' or jsonb_array_length(p_evidence)>60
      or length(p_evidence::text)>125000 then raise exception 'Invalid evidence'; end if;
  select * into job from public.sentinel_scan_runs
    where id=p_run and started_at=p_started_at and status='running' for update;
  if not found then return null; end if;

  insert into sentinel_private.evidence(org_id,watch_id,fingerprint,first_run_id,evidence)
  select job.org_id,job.watch_id,encode(sha256(convert_to(item->>'url','UTF8')),'hex'),p_run,item
  from jsonb_array_elements(p_evidence) as items(item)
  where item->>'url' is not null
  on conflict do nothing;

  select coalesce(jsonb_agg(items.item||jsonb_build_object(
    'fingerprint',e.fingerprint,'new_development',e.first_run_id=p_run
  ) order by items.position),'[]'::jsonb) into result
  from jsonb_array_elements(p_evidence) with ordinality as items(item,position)
  join sentinel_private.evidence e on e.org_id=job.org_id and e.watch_id=job.watch_id
    and e.fingerprint=encode(sha256(convert_to(items.item->>'url','UTF8')),'hex');
  update public.sentinel_scan_runs set evidence=result,error=p_error where id=p_run;
  return result;
end $$;
revoke all on function public.sentinel_checkpoint_evidence(uuid,timestamptz,jsonb,text) from public, anon, authenticated;
grant execute on function public.sentinel_checkpoint_evidence(uuid,timestamptz,jsonb,text) to service_role;

create or replace function public.sentinel_provider_gate(p_provider text, p_cooldown_seconds integer default 0)
returns boolean language plpgsql security invoker set search_path='' as $$
declare current_time_utc timestamptz := clock_timestamp(); accepted boolean;
begin
  if p_provider not in ('gdelt','google-news-rss','configured-feed') or p_cooldown_seconds not between 0 and 86400 then
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

commit;
