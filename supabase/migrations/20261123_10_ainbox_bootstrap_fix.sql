begin;
create or replace function public.ainbox_bootstrap(p_tenant uuid,p_owner uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; r uuid; v uuid; spec record;
begin
 if not public.ainbox_authorized(p_tenant,true) then raise exception 'Access denied' using errcode='42501'; end if;
 if not exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_owner and status='active') then raise exception 'Owner must be active organization member'; end if;
 for spec in select * from (values
  ('WORK-001','Work Execution','Overdue work','WORK-001','Work items are completed or replanned',jsonb_build_object('timezone','UTC')),
  ('KB-002','Knowledge Management','Stale knowledge drafts','KB-002','Knowledge is published or archived promptly',jsonb_build_object('threshold_days',5)),
  ('PORT-003','Portfolio Delivery','Unprioritized initiatives','PORT-003','Active initiatives are assessed and ranked',jsonb_build_object('active_statuses',jsonb_build_array('active')))
 ) as s(key,workstream,rule_name,evaluator,outcome,config)
 loop
  select id into w from public.ainbox_workstreams where tenant_id=p_tenant and name=spec.workstream limit 1;
  if w is null then insert into public.ainbox_workstreams(tenant_id,name,owner_id,status,desired_outcome)
   values(p_tenant,spec.workstream,p_owner,'active',spec.outcome) returning id into w; end if;
  select id into r from public.ainbox_rules where tenant_id=p_tenant and rule_key=spec.key;
  if r is null then
   insert into public.ainbox_rules(tenant_id,workstream_id,rule_key,name,evaluator_type,enabled)
   values(p_tenant,w,spec.key,spec.rule_name,spec.evaluator,false) returning id into r;
   insert into public.ainbox_rule_versions(tenant_id,rule_id,version_number,configuration,configuration_hash,created_by)
   values(p_tenant,r,1,spec.config,md5(spec.config::text),auth.uid()) returning id into v;
   update public.ainbox_rules set current_version_id=v where id=r;
  end if;
  w:=null;
 end loop;
 return public.ainbox_get_rules(p_tenant);
end $$;
commit;