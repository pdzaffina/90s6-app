-- Internal CRM foundation. Apply through the existing migration pipeline.
begin;
insert into public.application_registry(feature_key,display_name,sort_order)
values ('crm','Relationship Management',35)
on conflict(feature_key) do update set display_name=excluded.display_name,sort_order=excluded.sort_order,active=true;

alter table public.user_feature_access drop constraint if exists user_feature_access_feature_check;
alter table public.user_feature_access add constraint user_feature_access_feature_check
check (feature in ('action_inbox','portfolio_management','work_board','crm','training','prompt_library','content_studio','studio_courses','studio_prompts','studio_knowledge','knowledge_base','use_case_curator'));
alter table public.tenant_feature_access drop constraint if exists tenant_feature_access_feature_check;
alter table public.tenant_feature_access add constraint tenant_feature_access_feature_check check (feature in ('action_inbox','portfolio_management','work_board','crm','training','prompt_library','content_studio','studio_courses','studio_prompts','studio_knowledge','knowledge_base','use_case_curator'));
alter table public.tenant_user_feature_access drop constraint if exists tenant_user_feature_access_feature_check;
alter table public.tenant_user_feature_access add constraint tenant_user_feature_access_feature_check check (feature in ('action_inbox','portfolio_management','work_board','crm','training','prompt_library','content_studio','studio_courses','studio_prompts','studio_knowledge','knowledge_base','use_case_curator'));
-- CRM is opt-in for every organization.
insert into public.tenant_feature_access(tenant_id,feature,enabled)
select id,'crm',false from public.tenants on conflict do nothing;

create table public.crm_settings(
 org_id uuid primary key references public.tenants(id) on delete cascade,
 operating_mode text not null default 'internal' check (operating_mode in ('internal','commercial','hybrid')),
 engagements boolean not null default true,
 health boolean not null default true,
 commitments boolean not null default true,
 feedback boolean not null default true,
 sales boolean not null default false,
 forecast boolean not null default false,
 ai boolean not null default true,
 updated_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id),
 constraint crm_forecast_requires_sales check (not forecast or sales)
);
create table public.crm_accounts(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.tenants(id),
 name text not null check(length(trim(name))>0),description text not null default '',
 account_type text not null default 'department',parent_id uuid references public.crm_accounts(id),
 owner_id uuid references public.profiles(id),status text not null default 'active' check(status in ('active','archived')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(org_id,id)
);
create table public.crm_contacts(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.tenants(id),
 full_name text not null check(length(trim(full_name))>0),title text not null default '',
 email text,phone text,notes text not null default '',owner_id uuid references public.profiles(id),
 status text not null default 'active' check(status in ('active','archived')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(org_id,id)
);
create table public.crm_account_contacts(
 org_id uuid not null references public.tenants(id),account_id uuid not null,contact_id uuid not null,
 role text not null default 'stakeholder',is_primary boolean not null default false,
 created_at timestamptz not null default now(),primary key(account_id,contact_id),
 foreign key(org_id,account_id) references public.crm_accounts(org_id,id) on delete cascade,
 foreign key(org_id,contact_id) references public.crm_contacts(org_id,id) on delete cascade
);
create table public.crm_engagements(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.tenants(id),
 account_id uuid not null,title text not null check(length(trim(title))>0),
 description text not null default '',desired_outcome text not null default '',
 stage text not null default 'identified' check(stage in ('identified','discovery','evaluating','committed','in_progress','completed','on_hold','declined','cancelled')),
 priority text not null default 'medium' check(priority in ('low','medium','high','critical')),
 owner_id uuid references public.profiles(id),target_date date,completed_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(org_id,id),foreign key(org_id,account_id) references public.crm_accounts(org_id,id)
);
create table public.crm_commitments(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.tenants(id),
 account_id uuid not null,engagement_id uuid,description text not null check(length(trim(description))>0),
 accountable_user_id uuid references public.profiles(id),due_date date,
 status text not null default 'open' check(status in ('open','in_progress','at_risk','fulfilled','cancelled')),
 completed_at timestamptz,completion_notes text not null default '',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(org_id,account_id) references public.crm_accounts(org_id,id),
 foreign key(org_id,engagement_id) references public.crm_engagements(org_id,id)
);
create table public.crm_activities(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.tenants(id),
 account_id uuid,contact_id uuid,engagement_id uuid,
 kind text not null default 'note' check(kind in ('note','meeting','call','email','other')),
 subject text not null check(length(trim(subject))>0),details text not null default '',
 occurred_at timestamptz not null default now(),created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(org_id,account_id) references public.crm_accounts(org_id,id),
 foreign key(org_id,contact_id) references public.crm_contacts(org_id,id),
 foreign key(org_id,engagement_id) references public.crm_engagements(org_id,id)
);
create table public.crm_feedback(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.tenants(id),
 account_id uuid not null,engagement_id uuid,rating integer check(rating between 1 and 5),
 comments text not null default '',visibility text not null default 'team' check(visibility in ('team','restricted')),
 created_by uuid references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(org_id,account_id) references public.crm_accounts(org_id,id),
 foreign key(org_id,engagement_id) references public.crm_engagements(org_id,id)
);
create table public.crm_health(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.tenants(id),
 account_id uuid not null,dimension text not null check(dimension in ('engagement','responsiveness','commitments','satisfaction','alignment')),
 score integer check(score between 0 and 100),notes text not null default '',
 assessed_by uuid references public.profiles(id),assessed_at timestamptz not null default now(),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(org_id,account_id) references public.crm_accounts(org_id,id)
);
create index crm_accounts_org on public.crm_accounts(org_id,name);
create index crm_contacts_org on public.crm_contacts(org_id,full_name);
create index crm_engagements_org on public.crm_engagements(org_id,stage);
create index crm_commitments_org on public.crm_commitments(org_id,status,due_date);
create index crm_activities_org on public.crm_activities(org_id,occurred_at desc);
create index crm_feedback_org on public.crm_feedback(org_id,account_id);
create index crm_health_org on public.crm_health(org_id,account_id);

-- Server-side entitlement check; no client-provided authorization flags.
create function public.crm_allowed(p_org uuid,p_write boolean default false,p_feature text default null)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null
 and exists(select 1 from public.profiles p where p.id=auth.uid() and not p.disabled and
  (p.is_admin or exists(select 1 from public.tenant_members m where m.tenant_id=p_org and m.user_id=p.id and m.status='active'
   and (not p_write or m.role in ('tenant_admin','superuser')))))
 and exists(select 1 from public.tenant_feature_access t where t.tenant_id=p_org and t.feature='crm' and t.enabled)
 and not exists(select 1 from public.tenant_user_feature_access u where u.tenant_id=p_org and u.user_id=auth.uid() and u.feature='crm' and not u.enabled)
 and not exists(select 1 from public.user_feature_access u where u.user_id=auth.uid() and u.feature='crm' and not u.enabled)
 and (p_feature is null or exists(select 1 from public.crm_settings s where s.org_id=p_org and
  case p_feature when 'engagements' then s.engagements when 'commitments' then s.commitments
  when 'feedback' then s.feedback when 'health' then s.health when 'ai' then s.ai
  when 'sales' then s.sales else false end));
$$;
revoke all on function public.crm_allowed(uuid,boolean,text) from public,anon;
grant execute on function public.crm_allowed(uuid,boolean,text) to authenticated;

-- Every CRM table is tenant isolated. Only admins and superusers can mutate in this first release.
do $$
declare t text; feature text;
begin
 foreach t in array array['crm_settings','crm_accounts','crm_contacts','crm_account_contacts','crm_engagements','crm_commitments','crm_activities','crm_feedback','crm_health'] loop
  feature:=case t when 'crm_engagements' then 'engagements' when 'crm_commitments' then 'commitments' when 'crm_feedback' then 'feedback' when 'crm_health' then 'health' else null end;
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('create policy crm_read on public.%I for select to authenticated using (public.crm_allowed(org_id,false,%L))',t,feature);
  execute format('create policy crm_insert on public.%I for insert to authenticated with check (public.crm_allowed(org_id,true,%L))',t,feature);
  execute format('create policy crm_update on public.%I for update to authenticated using (public.crm_allowed(org_id,true,%L)) with check (public.crm_allowed(org_id,true,%L))',t,feature,feature);
  execute format('create policy crm_delete on public.%I for delete to authenticated using (public.crm_allowed(org_id,true,%L))',t,feature);
 end loop;
end $$;
-- CRM settings are managed by organization admins, and cannot be deleted.
drop policy crm_delete on public.crm_settings;
-- Confidential feedback is only visible to its author and organization administrators.
drop policy crm_read on public.crm_feedback;
create policy crm_read on public.crm_feedback for select to authenticated using (
 public.crm_allowed(org_id,false,'feedback') and
 (visibility='team' or created_by=auth.uid() or public.crm_allowed(org_id,true,'feedback'))
);
-- Set creator/owner fields in application requests; RLS remains authoritative.
commit;
