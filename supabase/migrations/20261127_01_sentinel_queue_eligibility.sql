begin;

create function sentinel_private.watch_can_run(p_org uuid, p_owner uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from public.tenants where id=p_org and status='active')
    and exists(select 1 from public.application_registry where feature_key='news_watch' and active)
    and exists(select 1 from public.tenant_feature_access where tenant_id=p_org and feature='news_watch' and enabled)
    and exists(
      select 1 from public.profiles p where p.id=p_owner and not p.disabled
        and (p.is_admin or exists(
          select 1 from public.tenant_members where tenant_id=p_org and user_id=p_owner and status='active'
        ))
    )
    and not exists(select 1 from public.user_feature_access where user_id=p_owner and feature='news_watch' and not enabled)
    and not exists(select 1 from public.tenant_user_feature_access where tenant_id=p_org and user_id=p_owner and feature='news_watch' and not enabled);
$$;

revoke all on function sentinel_private.watch_can_run(uuid,uuid) from public, anon, authenticated;
grant usage on schema sentinel_private to service_role;
grant execute on function sentinel_private.watch_can_run(uuid,uuid) to service_role;

create or replace function public.sentinel_claim()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare job public.sentinel_scan_runs; watch public.sentinel_watches;
begin
  update public.sentinel_scan_runs
  set status='failed', finished_at=now(), error='Worker lease expired. Run another scan to retry.'
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
  where r.status='queued' and w.active and sentinel_private.watch_can_run(w.org_id,w.owner_id)
  order by (
    select max(recent.started_at) from public.sentinel_scan_runs recent
    where recent.org_id=r.org_id and recent.started_at is not null
  ) nulls first,r.created_at,r.id
  limit 1 for update of r skip locked;

  if not found then return null; end if;
  update public.sentinel_scan_runs set status='running',started_at=now() where id=job.id;
  select * into watch from public.sentinel_watches where id=job.watch_id;
  return jsonb_build_object('id',job.id,'name',watch.name,'ticker',watch.ticker,'kind',watch.kind,'category',watch.category);
end $$;

create or replace function public.sentinel_queue(p_watch uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; watch public.sentinel_watches;
begin
  select * into watch from public.sentinel_watches
  where id=p_watch and active and owner_id=auth.uid()
    and sentinel_private.watch_can_run(org_id,owner_id);
  if not found then raise exception 'Watch unavailable'; end if;

  insert into public.sentinel_scan_runs(org_id,watch_id)
  values(watch.org_id,watch.id) on conflict do nothing returning id into result;
  if result is not null then
    perform sentinel_private.dispatch();
  end if;
  return result;
end $$;

create index sentinel_run_watch_created on public.sentinel_scan_runs(watch_id,created_at desc);
create index sentinel_run_org_started on public.sentinel_scan_runs(org_id,started_at desc) where started_at is not null;

commit;
