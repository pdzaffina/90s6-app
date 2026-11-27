begin;
create table sentinel_private.gdelt_batches(slot timestamptz primary key, status text not null default 'queued', attempts int not null default 0, touched_at timestamptz default now(), records int default 0, error text);
create table sentinel_private.gdelt_articles(id text primary key, observed timestamptz not null, url text not null, source text, organizations text, themes text, search_doc tsvector generated always as (to_tsvector('simple',coalesce(organizations,'')||' '||replace(coalesce(themes,''),'_',' ')||' '||regexp_replace(url,'[^a-zA-Z0-9]+',' ','g'))) stored);
create index gdelt_search_idx on sentinel_private.gdelt_articles using gin(search_doc);
create index gdelt_observed_idx on sentinel_private.gdelt_articles(observed);
alter table sentinel_private.gdelt_batches enable row level security;
alter table sentinel_private.gdelt_articles enable row level security;
create function public.sentinel_gdelt_claim() returns timestamptz language plpgsql security definer set search_path='' as $$
declare slot_value timestamptz;
begin
 select slot into slot_value from sentinel_private.gdelt_batches where (status='queued' or (status='running' and touched_at<now()-interval '10 minutes')) and attempts<5 order by slot for update skip locked limit 1;
 if slot_value is not null then update sentinel_private.gdelt_batches set status='running',attempts=attempts+1,touched_at=now() where slot=slot_value; end if;
 return slot_value;
end $$;
create function public.sentinel_gdelt_store(p_rows jsonb) returns void language sql security definer set search_path='' as $$
insert into sentinel_private.gdelt_articles(id,observed,url,source,organizations,themes) select id,observed,url,source,organizations,themes from jsonb_to_recordset(p_rows) as x(id text,observed timestamptz,url text,source text,organizations text,themes text) on conflict(id) do nothing;
$$;
create function public.sentinel_gdelt_finish(p_slot timestamptz,p_records int,p_error text default null) returns void language sql security definer set search_path='' as $$
update sentinel_private.gdelt_batches set status=case when p_error is null then 'complete' when attempts>=5 then 'failed' else 'queued' end,records=p_records,error=p_error,touched_at=now() where slot=p_slot;
$$;
create function public.sentinel_gdelt_search(p_terms text[],p_days int) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('latest',(select max(slot) from sentinel_private.gdelt_batches where status='complete'),'articles',coalesce((select jsonb_agg(to_jsonb(a)) from (select url,source,observed as published,organizations,themes from sentinel_private.gdelt_articles where observed>=now()-make_interval(days=>least(30,greatest(1,p_days))) and exists(select 1 from unnest(p_terms) t where length(trim(t))>=3 and search_doc @@ phraseto_tsquery('simple',t)) order by observed desc limit 30) a),'[]'::jsonb));
$$;
revoke all on function public.sentinel_gdelt_claim(),public.sentinel_gdelt_store(jsonb),public.sentinel_gdelt_finish(timestamptz,int,text),public.sentinel_gdelt_search(text[],int) from public,anon,authenticated;
grant execute on function public.sentinel_gdelt_claim(),public.sentinel_gdelt_store(jsonb),public.sentinel_gdelt_finish(timestamptz,int,text),public.sentinel_gdelt_search(text[],int) to service_role;
commit;