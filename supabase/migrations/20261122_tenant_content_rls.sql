-- Enforce global platform vs private tenant content authorization.
create or replace function public.can_read_content(p_scope text,p_tenant uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active() and (public.is_admin() or
 (p_scope='platform' and p_tenant is null) or
 (p_scope='tenant' and p_tenant is not null and public.is_tenant_member(p_tenant))) $$;
create or replace function public.can_manage_content(p_scope text,p_tenant uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active() and (public.is_admin() or
 (p_scope='tenant' and p_tenant is not null and public.is_tenant_admin(p_tenant))) $$;
revoke all on function public.can_read_content(text,uuid),public.can_manage_content(text,uuid) from public,anon;
grant execute on function public.can_read_content(text,uuid),public.can_manage_content(text,uuid) to authenticated;
drop policy if exists training_courses_read on public.training_courses;
create policy training_courses_read on public.training_courses for select to authenticated using(
 public.can_read_content(content_scope,tenant_id) and public.has_feature('training') and public.can_view_training(id) and (deleted_at is null or public.can_manage_content(content_scope,tenant_id)));
drop policy if exists training_courses_insert on public.training_courses;
create policy training_courses_insert on public.training_courses for insert to authenticated with check(
 public.can_manage_content(content_scope,tenant_id) and public.has_feature('training') and public.has_feature('content_studio') and public.has_feature('studio_courses') and created_by=(select auth.uid()));
drop policy if exists training_courses_update on public.training_courses;
create policy training_courses_update on public.training_courses for update to authenticated using(
 public.can_manage_content(content_scope,tenant_id) and public.has_feature('training') and public.has_feature('content_studio') and public.has_feature('studio_courses'))
 with check(public.can_manage_content(content_scope,tenant_id) and public.has_feature('training') and public.has_feature('content_studio') and public.has_feature('studio_courses'));
drop policy if exists training_courses_delete on public.training_courses;
create policy training_courses_delete on public.training_courses for delete to authenticated using(public.can_manage_content(content_scope,tenant_id) and public.has_feature('training') and public.has_feature('content_studio') and public.has_feature('studio_courses'));
drop policy if exists prompt_library_read on public.prompt_library_items;
create policy prompt_library_read on public.prompt_library_items for select to authenticated using(
 public.can_read_content(content_scope,tenant_id) and
 ((not coalesce(admin_only,false) and ((public.has_feature('prompt_library') and archived_at is null) or (public.has_feature('content_studio') and public.can_manage_content(content_scope,tenant_id)))) or public.is_admin()));
drop policy if exists prompt_library_insert on public.prompt_library_items;
create policy prompt_library_insert on public.prompt_library_items for insert to authenticated with check(
 public.can_manage_content(content_scope,tenant_id) and public.has_feature('content_studio') and public.has_feature('studio_prompts') and created_by=(select auth.uid()) and (not admin_only or public.is_admin()));
drop policy if exists prompt_library_update on public.prompt_library_items;
create policy prompt_library_update on public.prompt_library_items for update to authenticated using(
 public.can_manage_content(content_scope,tenant_id) and public.has_feature('content_studio') and public.has_feature('studio_prompts') and (not admin_only or public.is_admin()))
 with check(public.can_manage_content(content_scope,tenant_id) and public.has_feature('content_studio') and public.has_feature('studio_prompts') and (not admin_only or public.is_admin()));
drop policy if exists knowledge_articles_read on public.knowledge_articles;
create policy knowledge_articles_read on public.knowledge_articles for select to authenticated using(
 public.can_read_content(content_scope,tenant_id) and
 ((public.has_feature('knowledge_base') and status='published' and archived_at is null) or
 (public.has_feature('content_studio') and public.has_feature('studio_knowledge') and public.can_manage_content(content_scope,tenant_id))));
drop policy if exists knowledge_articles_insert on public.knowledge_articles;
create policy knowledge_articles_insert on public.knowledge_articles for insert to authenticated with check(
 public.can_manage_content(content_scope,tenant_id) and public.has_feature('content_studio') and public.has_feature('studio_knowledge') and created_by=(select auth.uid()));
drop policy if exists knowledge_articles_update on public.knowledge_articles;
create policy knowledge_articles_update on public.knowledge_articles for update to authenticated using(
 public.can_manage_content(content_scope,tenant_id) and public.has_feature('content_studio') and public.has_feature('studio_knowledge'))
 with check(public.can_manage_content(content_scope,tenant_id) and public.has_feature('content_studio') and public.has_feature('studio_knowledge'));
