begin;
create or replace function public.ainbox_save_remediation(p_tenant uuid,p_exception uuid,p_steps jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.ainbox_exceptions;p public.ainbox_remediation_plans; step jsonb; idx integer:=0;
begin
 if not public.ainbox_authorized(p_tenant,false) then raise exception 'Access denied' using errcode='42501';end if;
 select * into e from public.ainbox_exceptions where tenant_id=p_tenant and id=p_exception;
 if not found or (e.assignee_id is distinct from auth.uid() and not public.ainbox_authorized(p_tenant,true)) or not public.ainbox_source_visible(p_tenant,e.source_type,e.source_parent_id,e.source_id) then raise exception 'Access denied' using errcode='42501';end if;
 if jsonb_typeof(p_steps)<>'array' or jsonb_array_length(p_steps)>30 then raise exception 'Invalid steps';end if;
 select * into p from public.ainbox_remediation_plans where tenant_id=p_tenant and exception_id=p_exception order by updated_at desc limit 1 for update;
 if not found then insert into public.ainbox_remediation_plans(tenant_id,exception_id) values(p_tenant,p_exception) returning * into p;
 else
  update public.ainbox_remediation_plans set status='proposed',revision=revision+1,approved_revision=null,approved_snapshot=null,approved_by=null,approved_at=null,updated_at=now() where id=p.id returning * into p;
  delete from public.ainbox_remediation_steps where tenant_id=p_tenant and plan_id=p.id;
 end if;
 for step in select value from jsonb_array_elements(p_steps) loop
  if jsonb_typeof(step)<>'string' or length(trim(step #>> '{}')) not between 1 and 1000 then raise exception 'Invalid step';end if;
  idx:=idx+1;
  insert into public.ainbox_remediation_steps(tenant_id,plan_id,sequence,description) values(p_tenant,p.id,idx,trim(step #>> '{}'));
 end loop;
 insert into public.ainbox_activity_events(tenant_id,exception_id,actor_id,event_type,after_state)
 values(p_tenant,p_exception,auth.uid(),'remediation_saved',jsonb_build_object('revision',p.revision));
 return jsonb_build_object('plan_id',p.id,'revision',p.revision,'status',p.status);
end $$;
revoke all on function public.ainbox_save_remediation(uuid,uuid,jsonb) from public,anon;
grant execute on function public.ainbox_save_remediation(uuid,uuid,jsonb) to authenticated;
create or replace function public.ainbox_approve_remediation(p_tenant uuid,p_plan uuid,p_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.ainbox_remediation_plans;e public.ainbox_exceptions; snapshot jsonb;
begin
 select * into p from public.ainbox_remediation_plans where tenant_id=p_tenant and id=p_plan for update;
 if not found then raise exception 'Not found';end if;
 select * into e from public.ainbox_exceptions where tenant_id=p_tenant and id=p.exception_id;
 if not public.ainbox_authorized(p_tenant,true) or not public.ainbox_source_visible(p_tenant,e.source_type,e.source_parent_id,e.source_id) then raise exception 'Access denied' using errcode='42501';end if;
 if p.revision<>p_revision or p.status<>'proposed' then raise exception 'Stale or invalid plan';end if;
 select coalesce(jsonb_agg(jsonb_build_object('sequence',sequence,'description',description) order by sequence),'[]'::jsonb) into snapshot from public.ainbox_remediation_steps where tenant_id=p_tenant and plan_id=p.id;
 update public.ainbox_remediation_plans set status='approved',approved_revision=revision,approved_snapshot=snapshot,approved_by=auth.uid(),approved_at=now(),updated_at=now() where id=p.id;
 insert into public.ainbox_activity_events(tenant_id,exception_id,actor_id,event_type,after_state)
 values(p_tenant,p.exception_id,auth.uid(),'remediation_approved',jsonb_build_object('revision',p.revision));
 return jsonb_build_object('plan_id',p.id,'status','approved','revision',p.revision);
end $$;
revoke all on function public.ainbox_approve_remediation(uuid,uuid,integer) from public,anon;
grant execute on function public.ainbox_approve_remediation(uuid,uuid,integer) to authenticated;
create or replace function public.ainbox_complete_remediation_step(p_tenant uuid,p_step uuid,p_completed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.ainbox_remediation_steps;p public.ainbox_remediation_plans;e public.ainbox_exceptions;
begin
 select * into s from public.ainbox_remediation_steps where tenant_id=p_tenant and id=p_step for update;
 if not found then raise exception 'Not found';end if;
 select * into p from public.ainbox_remediation_plans where tenant_id=p_tenant and id=s.plan_id;
 select * into e from public.ainbox_exceptions where tenant_id=p_tenant and id=p.exception_id;
 if not public.ainbox_authorized(p_tenant,false) or (e.assignee_id is distinct from auth.uid() and not public.ainbox_authorized(p_tenant,true)) or not public.ainbox_source_visible(p_tenant,e.source_type,e.source_parent_id,e.source_id) then raise exception 'Access denied' using errcode='42501';end if;
 if p.status not in ('approved','in_progress','completed') then raise exception 'Plan not approved';end if;
 update public.ainbox_remediation_steps set completed_at=case when p_completed then now() else null end,completed_by=case when p_completed then auth.uid() else null end,updated_at=now() where id=p_step;
 update public.ainbox_remediation_plans set status=case when not exists(select 1 from public.ainbox_remediation_steps where tenant_id=p_tenant and plan_id=p.id and completed_at is null) then 'completed' else 'in_progress' end,updated_at=now() where id=p.id;
 insert into public.ainbox_activity_events(tenant_id,exception_id,actor_id,event_type,after_state)
 values(p_tenant,e.id,auth.uid(),'remediation_step_updated',jsonb_build_object('step_id',p_step,'completed',p_completed));
 return jsonb_build_object('step_id',p_step,'completed',p_completed);
end $$;
revoke all on function public.ainbox_complete_remediation_step(uuid,uuid,boolean) from public,anon;
grant execute on function public.ainbox_complete_remediation_step(uuid,uuid,boolean) to authenticated;
commit;