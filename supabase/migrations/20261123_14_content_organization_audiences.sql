create table if not exists public.content_organization_access (
 content_type text not null check (content_type in ('training','prompt','knowledge')),
 content_id uuid not null,
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 primary key(content_type,content_id,tenant_id)
);
create index if not exists content_org_access_lookup on public.content_organization_access(content_type,content_id);
alter table public.content_organization_access enable row level security;
revoke all on public.content_organization_access from public,anon;
grant select on public.content_organization_access to authenticated;
create policy content_org_access_admin_read on public.content_organization_access for select to authenticated using(public.is_admin());
alter table public.training_courses add column if not exists audience_mode text not null default 'all' check(audience_mode in ('all','selected'));
alter table public.prompt_library_items add column if not exists audience_mode text not null default 'all' check(audience_mode in ('all','selected'));
alter table public.knowledge_articles add column if not exists audience_mode text not null default 'all' check(audience_mode in ('all','selected'));
create or replace function public.can_read_content_audience(p_type text,p_id uuid,p_scope text,p_tenant uuid,p_mode text)
returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active() and (public.is_admin() or
 (p_scope='tenant' and p_tenant is not null and public.is_tenant_member(p_tenant)) or
 (p_scope='platform' and p_tenant is null and
 (p_mode='all' or exists(select 1 from public.content_organization_access a where a.content_type=p_type and a.content_id=p_id and public.is_tenant_member(a.tenant_id)))))
$$;
revoke all on function public.can_read_content_audience(text,uuid,text,uuid,text) from public,anon;
grant execute on function public.can_read_content_audience(text,uuid,text,uuid,text) to authenticated;
drop policy if exists training_courses_read on public.training_courses;
create policy training_courses_read on public.training_courses for select to authenticated using(
 public.can_read_content_audience('training',id,content_scope,tenant_id,audience_mode) and public.has_feature('training') and public.can_view_training(id) and (deleted_at is null or public.can_manage_content(content_scope,tenant_id)));
drop policy if exists prompt_library_read on public.prompt_library_items;
create policy prompt_library_read on public.prompt_library_items for select to authenticated using(
 public.can_read_content_audience('prompt',id,content_scope,tenant_id,audience_mode) and
 ((not coalesce(admin_only,false) and ((public.has_feature('prompt_library') and archived_at is null) or (public.has_feature('content_studio') and public.can_manage_content(content_scope,tenant_id)))) or public.is_admin()));
drop policy if exists knowledge_articles_read on public.knowledge_articles;
create policy knowledge_articles_read on public.knowledge_articles for select to authenticated using(
 public.can_read_content_audience('knowledge',id,content_scope,tenant_id,audience_mode) and
 ((public.has_feature('knowledge_base') and status='published' and archived_at is null) or
 (public.has_feature('content_studio') and public.has_feature('studio_knowledge') and public.can_manage_content(content_scope,tenant_id))));
create or replace function public.set_content_audience(p_type text,p_id uuid,p_mode text,p_tenants uuid[])
returns boolean language plpgsql security definer set search_path='' as $$
declare v_table text;
begin
 if not public.is_active() or not public.is_admin() then raise exception 'Global administrator required' using errcode='42501'; end if;
 if p_type not in ('training','prompt','knowledge') or p_mode not in ('all','selected') then raise exception 'Invalid audience'; end if;
 if p_mode='selected' and (coalesce(array_length(p_tenants,1),0)=0 or exists(select 1 from unnest(p_tenants) x where x is null or not exists(select 1 from public.tenants t where t.id=x))) then raise exception 'Select valid organizations'; end if;
 v_table:=case p_type when 'training' then 'training_courses' when 'prompt' then 'prompt_library_items' else 'knowledge_articles' end;
 execute format('update public.%I set audience_mode=$1 where id=$2 and content_scope=''platform''',v_table) using p_mode,p_id;
 if not found then raise exception 'Global content not found'; end if;
 delete from public.content_organization_access where content_type=p_type and content_id=p_id;
 if p_mode='selected' then
 insert into public.content_organization_access(content_type,content_id,tenant_id)
 select p_type,p_id,x from (select distinct unnest(p_tenants) x) s;
 end if;
 return true;
end $$;
revoke all on function public.set_content_audience(text,uuid,text,uuid[]) from public,anon;
grant execute on function public.set_content_audience(text,uuid,text,uuid[]) to authenticated;
create or replace function public.get_content_audience(p_type text,p_id uuid)
returns uuid[] language sql stable security definer set search_path='' as $$
 select case when public.is_admin() then coalesce(array_agg(a.tenant_id),array[]::uuid[]) else array[]::uuid[] end
 from public.content_organization_access a where a.content_type=p_type and a.content_id=p_id
$$;
revoke all on function public.get_content_audience(text,uuid) from public,anon;
grant execute on function public.get_content_audience(text,uuid) to authenticated;
