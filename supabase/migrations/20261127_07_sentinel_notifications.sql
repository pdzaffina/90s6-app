begin;

create or replace function public.news_watch_allowed(p_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select sentinel_private.watch_can_run(p_org,auth.uid())
$$;

alter table public.sentinel_watches
  add column notification_threshold text not null default 'off'
    check(notification_threshold in ('off','moderate','high','critical')),
  add column recipients_cc text not null default '' check(length(recipients_cc)<=1000);

create table public.sentinel_notification_preferences (
  user_id uuid not null references public.profiles(id),
  org_id uuid not null references public.tenants(id),
  alerts boolean not null default true,
  digest text not null default 'off' check(digest in ('off','daily','weekly')),
  primary key(user_id,org_id)
);
alter table public.sentinel_notification_preferences enable row level security;
revoke all on public.sentinel_notification_preferences from anon,authenticated;
grant select,insert,update on public.sentinel_notification_preferences to authenticated;
create policy sentinel_preferences_owner on public.sentinel_notification_preferences
  for all to authenticated using(user_id=auth.uid() and public.news_watch_allowed(org_id))
  with check(user_id=auth.uid() and public.news_watch_allowed(org_id));

create table public.sentinel_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  org_id uuid not null references public.tenants(id),
  watch_id uuid,
  run_id uuid references public.sentinel_scan_runs(id),
  event_key text not null,
  event_type text not null check(event_type in ('alert','digest')),
  subject text not null,
  detail text not null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  unique(user_id,org_id,event_key),
  foreign key(org_id,watch_id) references public.sentinel_watches(org_id,id)
);
create index sentinel_notification_recipient on public.sentinel_notifications(user_id,org_id,created_at desc);
alter table public.sentinel_notifications enable row level security;
revoke all on public.sentinel_notifications from anon,authenticated;
grant select on public.sentinel_notifications to authenticated;
grant update(acknowledged_at) on public.sentinel_notifications to authenticated;
create policy sentinel_notification_read on public.sentinel_notifications
  for select to authenticated using(user_id=auth.uid() and public.news_watch_allowed(org_id)
    and (watch_id is null or exists(select 1 from public.sentinel_watches w where w.id=watch_id and w.org_id=sentinel_notifications.org_id)));
create policy sentinel_notification_ack on public.sentinel_notifications
  for update to authenticated using(user_id=auth.uid() and public.news_watch_allowed(org_id)
    and (watch_id is null or exists(select 1 from public.sentinel_watches w where w.id=watch_id and w.org_id=sentinel_notifications.org_id)))
  with check(user_id=auth.uid() and public.news_watch_allowed(org_id));

create function sentinel_private.parse_report(value text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare data jsonb;
begin
  if value is null or left(ltrim(value),1)<>'{' then return null; end if;
  data:=value::jsonb;
  if data->>'version'='1' and jsonb_typeof(data->'risks')='array' then return data; end if;
  return null;
exception when invalid_text_representation then return null;
end $$;

create function sentinel_private.risk_rank(severity text) returns integer
language sql immutable set search_path='' as $$
  select case severity when 'critical' then 4 when 'high' then 3
    when 'moderate' then 2 when 'low' then 1 else 0 end
$$;

create function sentinel_private.publish_alert() returns trigger
language plpgsql security definer set search_path='' as $$
declare report jsonb; previous jsonb; watch public.sentinel_watches; risk jsonb; earlier jsonb;
begin
  if new.status not in ('complete','partial') or new.assessment is null then return new; end if;
  report:=sentinel_private.parse_report(new.assessment);
  if report is null then return new; end if;
  select * into watch from public.sentinel_watches where id=new.watch_id and org_id=new.org_id and active;
  if not found or watch.notification_threshold='off'
      or not sentinel_private.watch_can_run(watch.org_id,watch.owner_id)
      or exists(select 1 from public.sentinel_notification_preferences p
        where p.user_id=watch.owner_id and p.org_id=watch.org_id and not p.alerts) then return new; end if;
  select sentinel_private.parse_report(r.assessment) into previous from public.sentinel_scan_runs r
  where r.watch_id=new.watch_id and r.id<>new.id and r.created_at<new.created_at
    and sentinel_private.parse_report(r.assessment) is not null
  order by r.created_at desc limit 1;
  for risk in select value from jsonb_array_elements(report->'risks') loop
    if sentinel_private.risk_rank(risk->>'severity')<sentinel_private.risk_rank(watch.notification_threshold) then continue; end if;
    select value into earlier from jsonb_array_elements(coalesce(previous->'risks','[]'::jsonb))
      where value->>'category'=risk->>'category' limit 1;
    if earlier is not null
      and sentinel_private.risk_rank(risk->>'severity')<=sentinel_private.risk_rank(earlier->>'severity')
      and ((risk->>'direction'<>'deteriorating') or earlier->>'direction'='deteriorating') then continue; end if;
    if not exists(
      select 1 from jsonb_array_elements(risk->'sources') as reference(value)
      where new.evidence->((reference.value::text)::integer-1)->>'new_development'='true'
    ) then continue; end if;
    insert into public.sentinel_notifications(user_id,org_id,watch_id,run_id,event_key,event_type,subject,detail)
    values(watch.owner_id,watch.org_id,watch.id,new.id,new.id::text||':'||(risk->>'category'),'alert',
      left(watch.name||' · '||initcap(replace(risk->>'category','_',' ')),350),
      left(initcap(risk->>'severity')||' severity · '||replace(risk->>'confidence','_',' ')||' confidence. '||(risk->>'text'),1100))
    on conflict do nothing;
  end loop;
  return new;
end $$;
revoke all on function sentinel_private.publish_alert() from public,anon,authenticated;
create trigger sentinel_publish_alert after update of assessment on public.sentinel_scan_runs
for each row when (new.assessment is distinct from old.assessment)
execute function sentinel_private.publish_alert();

create function sentinel_private.publish_digests() returns void
language sql security definer set search_path='' as $$
  insert into public.sentinel_notifications(user_id,org_id,event_key,event_type,subject,detail)
  select p.user_id,p.org_id,p.digest||':'||current_date::text,'digest',
    initcap(p.digest)||' Sentinel digest',
    count(*)||' scans finished · '||count(*) filter(where r.status='partial')||' partial · '||
       count(*) filter(where r.status='failed')||' failed · '||count(r.assessment)||' assessments available.'
  from public.sentinel_notification_preferences p
  join public.sentinel_watches w on w.owner_id=p.user_id and w.org_id=p.org_id and w.active
  join public.sentinel_scan_runs r on r.watch_id=w.id and r.org_id=w.org_id
  where sentinel_private.watch_can_run(p.org_id,p.user_id)
    and (p.digest='daily' or (p.digest='weekly' and extract(isodow from current_date)=1))
    and r.finished_at>=now()-case when p.digest='weekly' then interval '7 days' else interval '1 day' end
  group by p.user_id,p.org_id,p.digest
  on conflict do nothing
$$;
revoke all on function sentinel_private.publish_digests() from public,anon,authenticated;
select cron.schedule('sentinel-digests','0 14 * * *','select sentinel_private.publish_digests()');

commit;
