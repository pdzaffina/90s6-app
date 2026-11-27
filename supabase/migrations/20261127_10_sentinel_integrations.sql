begin;

create function public.sentinel_integration_allowed(p_org uuid,p_feature text) returns boolean
language sql stable security definer set search_path='' as $$
  select p_feature in ('crm','portfolio_management','work_board','content_studio')
    and public.news_watch_allowed(p_org)
    and exists(select 1 from public.application_registry where feature_key=p_feature and active)
    and exists(select 1 from public.tenant_feature_access where tenant_id=p_org and feature=p_feature and enabled)
    and not exists(select 1 from public.user_feature_access where user_id=auth.uid() and feature=p_feature and not enabled)
    and not exists(select 1 from public.tenant_user_feature_access where user_id=auth.uid() and tenant_id=p_org and feature=p_feature and not enabled)
$$;
revoke all on function public.sentinel_integration_allowed(uuid,text) from public,anon;
grant execute on function public.sentinel_integration_allowed(uuid,text) to authenticated;

create table public.sentinel_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  watch_id uuid not null,
  run_id uuid references public.sentinel_scan_runs(id),
  account_id uuid references public.crm_accounts(id) on delete cascade,
  initiative_id uuid references public.pm_initiatives(id) on delete cascade,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  foreign key(org_id,watch_id) references public.sentinel_watches(org_id,id),
  check((run_id is null and account_id is not null and initiative_id is null)
      or (run_id is not null and account_id is null and initiative_id is not null))
);
create unique index sentinel_account_watch on public.sentinel_links(account_id,watch_id) where account_id is not null;
create unique index sentinel_initiative_run on public.sentinel_links(initiative_id,run_id) where initiative_id is not null;

alter table public.sentinel_links enable row level security;
revoke all on public.sentinel_links from anon,authenticated;
grant select,insert,delete on public.sentinel_links to authenticated;

create policy sentinel_links_read on public.sentinel_links for select to authenticated using(
  exists(select 1 from public.sentinel_watches w where w.id=sentinel_links.watch_id and w.org_id=sentinel_links.org_id)
  and case when account_id is not null then
    public.sentinel_integration_allowed(org_id,'crm')
    and exists(select 1 from public.crm_accounts a where a.id=sentinel_links.account_id and a.org_id=sentinel_links.org_id)
  else
    public.sentinel_integration_allowed(org_id,'portfolio_management')
    and exists(select 1 from public.pm_initiatives i join public.pm_portfolios p on p.id=i.portfolio_id
      where i.id=sentinel_links.initiative_id and p.tenant_id=sentinel_links.org_id and public.pm_access(p.id))
    and exists(select 1 from public.sentinel_scan_runs r where r.id=sentinel_links.run_id
      and r.org_id=sentinel_links.org_id and r.watch_id=sentinel_links.watch_id and r.assessment is not null)
  end
);

create policy sentinel_links_insert on public.sentinel_links for insert to authenticated with check(
  created_by=auth.uid()
  and exists(select 1 from public.sentinel_watches w where w.id=sentinel_links.watch_id and w.org_id=sentinel_links.org_id)
  and case when account_id is not null then
    public.sentinel_integration_allowed(org_id,'crm') and public.crm_allowed(org_id,true,null)
    and exists(select 1 from public.crm_accounts a where a.id=sentinel_links.account_id and a.org_id=sentinel_links.org_id)
  else
    public.sentinel_integration_allowed(org_id,'portfolio_management')
    and exists(select 1 from public.pm_initiatives i join public.pm_portfolios p on p.id=i.portfolio_id
      where i.id=sentinel_links.initiative_id and p.tenant_id=sentinel_links.org_id and public.pm_access(p.id,'editor'))
    and exists(select 1 from public.sentinel_scan_runs r where r.id=sentinel_links.run_id
      and r.org_id=sentinel_links.org_id and r.watch_id=sentinel_links.watch_id and r.assessment is not null)
  end
);

create policy sentinel_links_delete on public.sentinel_links for delete to authenticated using(
  created_by=auth.uid() and public.news_watch_allowed(org_id)
);

commit;
