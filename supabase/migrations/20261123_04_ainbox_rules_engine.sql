-- Guarded configuration, evaluation, and reconciliation.
begin;
create or replace function public.ainbox_get_rules(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ainbox_authorized(p_tenant,true) then raise exception 'Access denied' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'rule_key',r.rule_key,'name',r.name,'evaluator_type',r.evaluator_type,'enabled',r.enabled,'scan_interval_minutes',r.scan_interval_minutes,'configuration',v.configuration,'version',v.version_number) order by r.rule_key),'[]'::jsonb)
 into result from public.ainbox_rules r left join public.ainbox_rule_versions v on v.id=r.current_version_id and v.tenant_id=r.tenant_id where r.tenant_id=p_tenant;
 return result;
end $$;
revoke all on function public.ainbox_get_rules(uuid) from public,anon;
grant execute on function public.ainbox_get_rules(uuid) to authenticated;

create or replace function public.ainbox_bootstrap(p_tenant uuid,p_owner uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; r uuid; v uuid; spec record;
begin
 if not public.ainbox_authorized(p_tenant,true) then raise exception 'Access denied' using errcode='42501'; end if;
 if not exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_owner and status='active') then raise exception 'Owner must be active organization member'; end if;
 for spec in select * from (values
  ('WORK-001','Work Execution','Overdue work','work_board','Work items are completed or replanned',jsonb_build_object('timezone','UTC')),
  ('KB-002','Knowledge Management','Stale knowledge drafts','knowledge_base','Knowledge is published or archived promptly',jsonb_build_object('threshold_days',5)),
  ('PORT-003','Portfolio Delivery','Unprioritized initiatives','portfolio','Active initiatives are assessed and ranked',jsonb_build_object('active_statuses',jsonb_build_array('active')))
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
revoke all on function public.ainbox_bootstrap(uuid,uuid) from public,anon;
grant execute on function public.ainbox_bootstrap(uuid,uuid) to authenticated;

create or replace function public.ainbox_configure_rule(p_tenant uuid,p_rule uuid,p_enabled boolean,p_interval integer,p_config jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.ainbox_rules; v uuid; n integer;
begin
 if not public.ainbox_authorized(p_tenant,true) then raise exception 'Access denied' using errcode='42501'; end if;
 select * into r from public.ainbox_rules where id=p_rule and tenant_id=p_tenant for update;
 if not found then raise exception 'Rule not found'; end if;
 if p_interval<15 or p_interval>10080 then raise exception 'Invalid interval'; end if;
 if jsonb_typeof(p_config)<>'object' then raise exception 'Configuration must be an object'; end if;
 if r.evaluator_type='KB-002' and (not (p_config ? 'threshold_days') or (p_config->>'threshold_days')::integer not between 1 and 365) then raise exception 'Invalid draft threshold'; end if;
 if r.evaluator_type='WORK-001' and (not (p_config ? 'timezone') or length(p_config->>'timezone')>80) then raise exception 'Invalid timezone'; end if;
 if r.evaluator_type='PORT-003' and (jsonb_typeof(p_config->'active_statuses')<>'array' or jsonb_array_length(p_config->'active_statuses')=0) then raise exception 'Active statuses required'; end if;
 select coalesce(max(version_number),0)+1 into n from public.ainbox_rule_versions where tenant_id=p_tenant and rule_id=p_rule;
 insert into public.ainbox_rule_versions(tenant_id,rule_id,version_number,configuration,configuration_hash,created_by)
 values(p_tenant,p_rule,n,p_config,md5(p_config::text),auth.uid()) returning id into v;
 update public.ainbox_rules set enabled=p_enabled,scan_interval_minutes=p_interval,current_version_id=v,
 next_scan_at=case when p_enabled then now() else null end,updated_at=now() where id=p_rule;
 return jsonb_build_object('rule_id',p_rule,'version',n,'enabled',p_enabled);
end $$;
revoke all on function public.ainbox_configure_rule(uuid,uuid,boolean,integer,jsonb) from public,anon;
grant execute on function public.ainbox_configure_rule(uuid,uuid,boolean,integer,jsonb) to authenticated;

-- The evaluator writes one row per explicitly evaluated source record.
-- Absence from a scan is never interpreted as compliance.
create or replace function ainbox_internal.record_result(p_tenant uuid,p_run uuid,p_rule uuid,p_version uuid,p_workstream uuid,p_source text,p_parent text,p_source_id text,p_result text,p_evidence jsonb,p_assignee uuid,p_priority numeric)
returns void language plpgsql security definer set search_path='' as $$
declare k text; e public.ainbox_exceptions; new_id uuid;
begin
 if p_result not in ('Violation','Compliant','Unknown') then raise exception 'Invalid evaluator outcome'; end if;
 k:=p_source||':'||p_parent||':'||p_source_id;
 select * into e from public.ainbox_exceptions where tenant_id=p_tenant and rule_id=p_rule and source_key=k and resolved_at is null for update;
 if p_result='Violation' then
   if e.id is null then
    insert into public.ainbox_exceptions(tenant_id,workstream_id,rule_id,rule_version_id,source_type,source_parent_id,source_id,source_key,assignee_id,priority_score,evidence,last_scan_run_id)
    values(p_tenant,p_workstream,p_rule,p_version,p_source,p_parent,p_source_id,k,p_assignee,p_priority,p_evidence,p_run) returning id into new_id;
    insert into public.ainbox_activity_events(tenant_id,exception_id,event_type,after_state,scan_run_id)
    values(p_tenant,new_id,'detected',jsonb_build_object('status','open'),p_run);
   else
    update public.ainbox_exceptions set last_detected_at=now(),last_scan_run_id=p_run,evidence=p_evidence,priority_score=p_priority,updated_at=now()
    where id=e.id;
   end if;
 elsif p_result='Compliant' and e.id is not null then
   update public.ainbox_exceptions set status='resolved',resolved_at=now(),resolution_reason='verified_compliant',last_scan_run_id=p_run,snoozed_until=null,revision=revision+1,updated_at=now() where id=e.id;
   insert into public.ainbox_activity_events(tenant_id,exception_id,event_type,after_state,scan_run_id)
   values(p_tenant,e.id,'verified_compliant',jsonb_build_object('status','resolved'),p_run);
 end if;
end $$;
revoke all on function ainbox_internal.record_result(uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid,numeric) from public,anon,authenticated;
commit;