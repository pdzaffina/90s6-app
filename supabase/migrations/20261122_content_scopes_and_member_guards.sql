-- Additive content scopes and cross-tenant membership integrity.
alter table public.training_courses add column if not exists tenant_id uuid references public.tenants(id);
alter table public.training_courses add column if not exists content_scope text not null default 'platform' check(content_scope in ('platform','tenant'));
alter table public.prompt_library_items add column if not exists tenant_id uuid references public.tenants(id);
alter table public.prompt_library_items add column if not exists content_scope text not null default 'platform' check(content_scope in ('platform','tenant'));
alter table public.knowledge_articles add column if not exists tenant_id uuid references public.tenants(id);
alter table public.knowledge_articles add column if not exists content_scope text not null default 'platform' check(content_scope in ('platform','tenant'));
alter table public.training_courses add constraint training_content_scope_consistency check ((content_scope='platform' and tenant_id is null) or (content_scope='tenant' and tenant_id is not null));
alter table public.prompt_library_items add constraint prompt_content_scope_consistency check ((content_scope='platform' and tenant_id is null) or (content_scope='tenant' and tenant_id is not null));
alter table public.knowledge_articles add constraint knowledge_content_scope_consistency check ((content_scope='platform' and tenant_id is null) or (content_scope='tenant' and tenant_id is not null));
create or replace function public.enforce_resource_member_tenant() returns trigger language plpgsql security definer set search_path='' as $$
declare resource_tenant uuid;
begin
 if tg_table_name='board_members' then select tenant_id into resource_tenant from public.boards where id=new.board_id;
 elsif tg_table_name='pm_portfolio_members' then select tenant_id into resource_tenant from public.pm_portfolios where id=new.portfolio_id;
 else raise exception 'Unsupported membership table'; end if;
 if resource_tenant is null or not exists(select 1 from public.tenant_members m where m.tenant_id=resource_tenant and m.user_id=new.user_id and m.status='active') then
 raise exception 'Resource member must have active membership in the resource tenant' using errcode='42501';
 end if;
 return new;
end $$;
drop trigger if exists board_member_tenant_guard on public.board_members;
create trigger board_member_tenant_guard before insert or update on public.board_members for each row execute function public.enforce_resource_member_tenant();
drop trigger if exists portfolio_member_tenant_guard on public.pm_portfolio_members;
create trigger portfolio_member_tenant_guard before insert or update on public.pm_portfolio_members for each row execute function public.enforce_resource_member_tenant();
revoke all on function public.enforce_resource_member_tenant() from public,anon,authenticated;
