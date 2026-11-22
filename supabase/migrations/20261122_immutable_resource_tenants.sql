-- Resource tenancy is immutable after creation. Transfers require a separate audited admin workflow.
create or replace function public.prevent_resource_tenant_change() returns trigger language plpgsql set search_path='' as $$
begin
 if new.tenant_id is distinct from old.tenant_id then
 raise exception 'Tenant ownership cannot be changed directly' using errcode='42501';
 end if;
 return new;
end $$;
drop trigger if exists boards_tenant_immutable on public.boards;
create trigger boards_tenant_immutable before update on public.boards for each row execute function public.prevent_resource_tenant_change();
drop trigger if exists portfolios_tenant_immutable on public.pm_portfolios;
create trigger portfolios_tenant_immutable before update on public.pm_portfolios for each row execute function public.prevent_resource_tenant_change();
drop trigger if exists courses_tenant_immutable on public.training_courses;
create trigger courses_tenant_immutable before update on public.training_courses for each row execute function public.prevent_resource_tenant_change();
drop trigger if exists prompts_tenant_immutable on public.prompt_library_items;
create trigger prompts_tenant_immutable before update on public.prompt_library_items for each row execute function public.prevent_resource_tenant_change();
drop trigger if exists articles_tenant_immutable on public.knowledge_articles;
create trigger articles_tenant_immutable before update on public.knowledge_articles for each row execute function public.prevent_resource_tenant_change();
revoke all on function public.prevent_resource_tenant_change() from public,anon,authenticated;
