create table sentinel_private.developments (
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null,
 watch_id uuid not null references public.sentinel_watches(id) on delete cascade,
 story_key text not null,
 title text not null,
 first_seen_at timestamptz not null,
 last_seen_at timestamptz not null,
 unique(org_id,watch_id,story_key)
);
alter table sentinel_private.developments enable row level security;
create table sentinel_private.development_evidence (
 development_id uuid not null references sentinel_private.developments(id) on delete cascade,
 fingerprint text not null,
 evidence jsonb not null,
 primary key(development_id,fingerprint)
);
alter table sentinel_private.development_evidence enable row level security;
create function sentinel_private.story_key(p_title text,p_source text) returns text language sql immutable set search_path='' as $$
 select trim(regexp_replace(lower(case when coalesce(p_source,'')<>'' and right(lower(p_title),length(p_source)+3)=' - '||lower(p_source) then left(p_title,length(p_title)-length(p_source)-3) else p_title end),'[^[:alnum:]]+',' ','g'))
$$;
create function sentinel_private.correlate_evidence() returns trigger language plpgsql security definer set search_path='' as $$
declare k text; d uuid;
begin
 k:=sentinel_private.story_key(new.evidence->>'title',new.evidence->>'source');
 if coalesce(length(k),0)<20 then k:='url:'||new.fingerprint; end if;
 insert into sentinel_private.developments(org_id,watch_id,story_key,title,first_seen_at,last_seen_at)
 values(new.org_id,new.watch_id,k,coalesce(nullif(new.evidence->>'title',''),'Untitled evidence'),new.first_seen_at,new.first_seen_at)
 on conflict(org_id,watch_id,story_key) do update set first_seen_at=least(sentinel_private.developments.first_seen_at,excluded.first_seen_at),last_seen_at=greatest(sentinel_private.developments.last_seen_at,excluded.last_seen_at)
 returning id into d;
 insert into sentinel_private.development_evidence values(d,new.fingerprint,new.evidence) on conflict do nothing;
 return new;
end $$;
revoke all on function sentinel_private.correlate_evidence() from public,anon,authenticated;
create trigger sentinel_correlate_evidence after insert on sentinel_private.evidence for each row execute function sentinel_private.correlate_evidence();
insert into sentinel_private.developments(org_id,watch_id,story_key,title,first_seen_at,last_seen_at)
select org_id,watch_id,k,min(coalesce(nullif(evidence->>'title',''),'Untitled evidence')),min(first_seen_at),max(first_seen_at)
from (select e.*,case when coalesce(length(sentinel_private.story_key(evidence->>'title',evidence->>'source')),0)<20 then 'url:'||fingerprint else sentinel_private.story_key(evidence->>'title',evidence->>'source') end k from sentinel_private.evidence e) s group by org_id,watch_id,k on conflict do nothing;
insert into sentinel_private.development_evidence
select d.id,e.fingerprint,e.evidence from sentinel_private.evidence e join sentinel_private.developments d on d.org_id=e.org_id and d.watch_id=e.watch_id and d.story_key=case when coalesce(length(sentinel_private.story_key(e.evidence->>'title',e.evidence->>'source')),0)<20 then 'url:'||e.fingerprint else sentinel_private.story_key(e.evidence->>'title',e.evidence->>'source') end on conflict do nothing;
create function public.sentinel_developments(p_org uuid,p_watch uuid default null) returns table(id uuid,watch_id uuid,title text,first_seen_at timestamptz,last_seen_at timestamptz,evidence_count bigint,evidence jsonb) language sql stable security definer set search_path='' as $$
 select d.id,d.watch_id,d.title,d.first_seen_at,d.last_seen_at,(select count(*) from sentinel_private.development_evidence e where e.development_id=d.id),coalesce((select jsonb_agg(x.evidence) from (select e.evidence from sentinel_private.development_evidence e where e.development_id=d.id order by e.fingerprint limit 30) x),'[]'::jsonb)
 from sentinel_private.developments d join public.sentinel_watches w on w.id=d.watch_id and w.org_id=d.org_id
 where auth.uid() is not null and d.org_id=p_org and public.news_watch_allowed(p_org) and (w.owner_id=auth.uid() or w.shared) and (p_watch is null or d.watch_id=p_watch)
 order by d.last_seen_at desc,d.id limit 100
$$;
revoke all on function public.sentinel_developments(uuid,uuid) from public,anon;
grant execute on function public.sentinel_developments(uuid,uuid) to authenticated;
