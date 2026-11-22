-- Storage attachment access follows board tenant authorization.
drop policy if exists att_read on storage.objects;
create policy att_read on storage.objects for select to authenticated using (
 bucket_id='attachments' and exists(
 select 1 from public.boards b where b.id=((storage.foldername(name))[1])::uuid
 and (public.is_admin() or public.is_tenant_admin(b.tenant_id) or
 (public.is_tenant_member(b.tenant_id) and
 (b.owner_id=(select auth.uid()) and public.tenant_role(b.tenant_id)='superuser'
 or public.is_member(b.id)))))
);
drop policy if exists att_delete on storage.objects;
create policy att_delete on storage.objects for delete to authenticated using (
 bucket_id='attachments' and public.can_edit(((storage.foldername(name))[1])::uuid)
);
drop policy if exists att_write on storage.objects;
create policy att_write on storage.objects for insert to authenticated with check (
 bucket_id='attachments' and public.can_edit(((storage.foldername(name))[1])::uuid)
);
