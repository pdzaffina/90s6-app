begin;
insert into public.application_registry(feature_key,display_name,sort_order) values ('news_watch','News Watch',36) on conflict(feature_key) do update set active=true;
do $$ declare t text; c text; old_expr text; begin
foreach t in array array['user_feature_access','tenant_feature_access','tenant_user_feature_access'] loop
c:=t||'_feature_check';
select pg_get_expr(conbin,conrelid) into old_expr from pg_constraint where conname=c and conrelid=to_regclass('public.'||t);
if old_expr is null then raise exception 'Missing feature constraint %',c; end if;
execute format('alter table public.%I drop constraint %I',t,c);
execute format('alter table public.%I add constraint %I check ((%s) or feature = %L)',t,c,old_expr,'news_watch');
end loop; end $$;
insert into public.tenant_feature_access(tenant_id,feature,enabled) select id,'news_watch',false from public.tenants on conflict do nothing;
create function public.news_watch_allowed(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.profiles p where p.id=auth.uid() and not p.disabled and (p.is_admin or exists(select 1 from public.tenant_members m where m.tenant_id=p_org and m.user_id=p.id and m.status='active')))
and exists(select 1 from public.tenant_feature_access t where t.tenant_id=p_org and t.feature='news_watch' and t.enabled)
and not exists(select 1 from public.tenant_user_feature_access u where u.tenant_id=p_org and u.user_id=auth.uid() and u.feature='news_watch' and not u.enabled)
and not exists(select 1 from public.user_feature_access u where u.user_id=auth.uid() and u.feature='news_watch' and not u.enabled);
$$;
revoke all on function public.news_watch_allowed(uuid) from public,anon;
grant execute on function public.news_watch_allowed(uuid) to authenticated;
create table public.sentinel_watches(
id uuid primary key default gen_random_uuid(), org_id uuid not null references public.tenants(id), owner_id uuid not null default auth.uid() references public.profiles(id),
name text not null check(length(trim(name)) between 1 and 300), kind text not null default 'company' check(kind in ('company','event','topic')), category text not null default 'Suppliers',
ticker text not null default '', exchange text not null default '', website text not null default '', vendor_id text not null default '', criticality text not null default 'Unclassified', objective text not null default '', frequency text not null default 'daily' check(frequency in ('manual','6h','daily','weekly','monthly')), recipients text not null default '', active boolean not null default true, shared boolean not null default false, created_at timestamptz not null default now(), unique(org_id,id));
create unique index sentinel_watch_identity on public.sentinel_watches(org_id,owner_id,kind,lower(trim(name)));
alter table public.sentinel_watches enable row level security;
revoke all on public.sentinel_watches from anon,authenticated;
grant select,insert,update on public.sentinel_watches to authenticated;
create policy sentinel_read on public.sentinel_watches for select to authenticated using(public.news_watch_allowed(org_id) and (owner_id=auth.uid() or shared));
create policy sentinel_insert on public.sentinel_watches for insert to authenticated with check(public.news_watch_allowed(org_id) and owner_id=auth.uid());
create policy sentinel_update on public.sentinel_watches for update to authenticated using(public.news_watch_allowed(org_id) and owner_id=auth.uid()) with check(public.news_watch_allowed(org_id) and owner_id=auth.uid());
create table public.sentinel_scan_runs(id uuid primary key default gen_random_uuid(),org_id uuid not null,watch_id uuid not null,status text not null default 'queued' check(status in ('queued','running','complete','partial','failed')),created_at timestamptz not null default now(),finished_at timestamptz,error text,evidence jsonb not null default '[]',assessment text,foreign key(org_id,watch_id) references public.sentinel_watches(org_id,id));
create unique index sentinel_one_pending on public.sentinel_scan_runs(watch_id) where status in ('queued','running');
alter table public.sentinel_scan_runs enable row level security;
revoke all on public.sentinel_scan_runs from anon,authenticated;
grant select on public.sentinel_scan_runs to authenticated;
create policy sentinel_run_read on public.sentinel_scan_runs for select to authenticated using(exists(select 1 from public.sentinel_watches w where w.id=watch_id and w.org_id=sentinel_scan_runs.org_id));
create function public.sentinel_queue(p_watch uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; w public.sentinel_watches; begin
select * into w from public.sentinel_watches where id=p_watch and active and owner_id=auth.uid() and public.news_watch_allowed(org_id);
if not found then raise exception 'Watch unavailable'; end if;
insert into public.sentinel_scan_runs(org_id,watch_id) values(w.org_id,w.id) on conflict do nothing returning id into result;
return result; end $$;
revoke all on function public.sentinel_queue(uuid) from public,anon;
grant execute on function public.sentinel_queue(uuid) to authenticated;
commit;
