begin;
alter table public.sentinel_scan_runs add column started_at timestamptz;
create function public.sentinel_claim() returns jsonb language plpgsql security invoker set search_path='' as $$
declare job public.sentinel_scan_runs; watch public.sentinel_watches;
begin
update public.sentinel_scan_runs set status='failed',finished_at=now(),error='Worker lease expired' where status='running' and started_at<now()-interval '15 minutes';
insert into public.sentinel_scan_runs(org_id,watch_id)
select w.org_id,w.id from public.sentinel_watches w
where w.active and w.frequency<>'manual'
and exists(select 1 from public.tenant_feature_access t where t.tenant_id=w.org_id and t.feature='news_watch' and t.enabled)
and not exists(select 1 from public.sentinel_scan_runs r where r.watch_id=w.id and r.created_at>now()-case w.frequency when '6h' then interval '6 hours' when 'weekly' then interval '7 days' when 'monthly' then interval '30 days' else interval '1 day' end)
order by w.created_at limit 50 on conflict do nothing;
select r.* into job from public.sentinel_scan_runs r join public.sentinel_watches w on w.id=r.watch_id
where r.status='queued' and w.active
and exists(select 1 from public.tenant_feature_access t where t.tenant_id=w.org_id and t.feature='news_watch' and t.enabled)
and exists(select 1 from public.profiles p where p.id=w.owner_id and not p.disabled and (p.is_admin or exists(select 1 from public.tenant_members m where m.tenant_id=w.org_id and m.user_id=p.id and m.status='active')))
and not exists(select 1 from public.user_feature_access u where u.user_id=w.owner_id and u.feature='news_watch' and not u.enabled)
and not exists(select 1 from public.tenant_user_feature_access u where u.tenant_id=w.org_id and u.user_id=w.owner_id and u.feature='news_watch' and not u.enabled)
order by r.created_at for update of r skip locked limit 1;
if not found then return null; end if;
update public.sentinel_scan_runs set status='running',started_at=now() where id=job.id;
select * into watch from public.sentinel_watches where id=job.watch_id;
return jsonb_build_object('id',job.id,'name',watch.name,'ticker',watch.ticker,'kind',watch.kind,'category',watch.category);
end $$;
revoke all on function public.sentinel_claim() from public,anon,authenticated;
grant execute on function public.sentinel_claim() to service_role;
grant select,insert,update on public.sentinel_scan_runs to service_role;
grant select on public.sentinel_watches to service_role;
commit;
