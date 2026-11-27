begin;
create table sentinel_private.source_settings(id boolean primary key default true check(id),source_limit integer not null default 250 check(source_limit between 1 and 1000));
alter table sentinel_private.source_settings enable row level security;
insert into sentinel_private.source_settings default values;
create function public.sentinel_source_limit(p_limit integer default null) returns integer language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active() or auth.uid() is null then raise exception 'Active account required' using errcode='42501'; end if;
 if p_limit is not null then
  if not public.is_admin() then raise exception 'Global administrator required' using errcode='42501'; end if;
  if exists(select 1 from sentinel_private.source_lists where cardinality(domains)>p_limit) then raise exception 'Existing source lists exceed proposed limit'; end if;
  update sentinel_private.source_settings set source_limit=p_limit where id=true;
 end if;
 return (select source_limit from sentinel_private.source_settings where id=true);
end $$;
revoke all on function public.sentinel_source_limit(integer) from public,anon;
grant execute on function public.sentinel_source_limit(integer) to authenticated;
create or replace function public.sentinel_admin_sources(p_org uuid,p_domains text[] default null)
returns text[] language plpgsql security definer set search_path='' as $$
declare scope text:=coalesce(p_org::text,'global'); cleaned text[];
begin
 if not (public.is_admin() or (p_org is not null and public.is_tenant_admin(p_org)))
    or not public.is_active() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_domains is null then
  return coalesce((select domains from sentinel_private.source_lists where scope_key=scope),'{}');
 end if;
 if cardinality(p_domains)>1000 or exists(select 1 from unnest(p_domains) d
   where d is null or length(d)>100 or d !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$') then
  raise exception 'Enter valid source domains (maximum 1000 submitted)';
 end if;
 select coalesce(array_agg(domain order by position),'{}') into cleaned
 from (select d as domain,min(n) as position from unnest(p_domains) with ordinality a(d,n) group by d) unique_domains;
 if cardinality(cleaned)>(select source_limit from sentinel_private.source_settings where id=true) then raise exception 'Source list exceeds configured limit'; end if;
 insert into sentinel_private.source_lists(scope_key,domains,updated_by) values(scope,cleaned,auth.uid())
 on conflict(scope_key) do update set domains=excluded.domains,updated_at=now(),updated_by=excluded.updated_by;
 return cleaned;
end $$;
revoke all on function public.sentinel_admin_sources(uuid,text[]) from public,anon;
grant execute on function public.sentinel_admin_sources(uuid,text[]) to authenticated;


commit;