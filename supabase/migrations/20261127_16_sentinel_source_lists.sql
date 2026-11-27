begin;

create table sentinel_private.source_lists (
 scope_key text primary key,
 domains text[] not null default '{}',
 updated_at timestamptz not null default now(),
 updated_by uuid not null references public.profiles(id)
);

create function public.sentinel_admin_sources(p_org uuid,p_domains text[] default null)
returns text[] language plpgsql security definer set search_path='' as $$
declare scope text:=coalesce(p_org::text,'global'); cleaned text[];
begin
 if not (public.is_admin() or (p_org is not null and public.is_tenant_admin(p_org)))
    or not public.is_active() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_domains is null then
  return coalesce((select domains from sentinel_private.source_lists where scope_key=scope),'{}');
 end if;
 if cardinality(p_domains)>8 or exists(select 1 from unnest(p_domains) d
   where d is null or length(d)>100 or d !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$') then
  raise exception 'Enter up to eight valid source domains';
 end if;
 select coalesce(array_agg(domain order by position),'{}') into cleaned
 from (select d as domain,min(n) as position from unnest(p_domains) with ordinality a(d,n) group by d) unique_domains;
 insert into sentinel_private.source_lists(scope_key,domains,updated_by) values(scope,cleaned,auth.uid())
 on conflict(scope_key) do update set domains=excluded.domains,updated_at=now(),updated_by=excluded.updated_by;
 return cleaned;
end $$;
revoke all on function public.sentinel_admin_sources(uuid,text[]) from public,anon;
grant execute on function public.sentinel_admin_sources(uuid,text[]) to authenticated;

create function public.sentinel_scan_sources(p_run uuid,p_started_at timestamptz)
returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array(
   select distinct d from sentinel_private.source_lists s cross join lateral unnest(s.domains) d
   where s.scope_key in ('global',r.org_id::text) order by d
 ),'{}')
 from public.sentinel_scan_runs r join public.sentinel_watches w on w.id=r.watch_id and w.org_id=r.org_id
 where r.id=p_run and r.started_at=p_started_at and r.status='running'
   and w.active and sentinel_private.watch_can_run(w.org_id,w.owner_id)
$$;
revoke all on function public.sentinel_scan_sources(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.sentinel_scan_sources(uuid,timestamptz) to service_role;
commit;
