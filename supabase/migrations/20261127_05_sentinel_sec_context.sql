begin;

alter table public.sentinel_watches
  add column sec_cik text not null default '' check(sec_cik='' or sec_cik~'^[0-9]{1,10}$'),
  add column relationship_type text not null default 'general_topic' check(relationship_type in
    ('supplier','customer','competitor','strategic_partner','technology_provider','industry','general_topic','event'));

create or replace function public.sentinel_watch_context(p_run uuid, p_started_at timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('alternative_names',w.alternative_names,'custom_terms',w.custom_terms,
    'excluded_terms',w.excluded_terms,'lookback_days',w.lookback_days,'feed_url',w.feed_url,
    'sec_cik',w.sec_cik,'relationship_type',w.relationship_type)
  from public.sentinel_scan_runs r join public.sentinel_watches w
    on w.id=r.watch_id and w.org_id=r.org_id
  where r.id=p_run and r.started_at=p_started_at and r.status='running'
    and w.active and sentinel_private.watch_can_run(w.org_id,w.owner_id)
$$;

create or replace function public.sentinel_provider_gate(p_provider text, p_cooldown_seconds integer default 0)
returns boolean language plpgsql security invoker set search_path='' as $$
declare current_time_utc timestamptz := clock_timestamp(); accepted boolean;
begin
  if p_provider not in ('gdelt','google-news-rss','configured-feed','sec-edgar') or p_cooldown_seconds not between 0 and 86400 then
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
